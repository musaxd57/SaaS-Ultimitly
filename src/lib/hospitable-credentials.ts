import "server-only";

import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import {
  getHospitableOAuthConfig,
  refreshAccessToken,
  HospitableOAuthError,
  type HospitableTokenSet,
} from "@/lib/hospitable-oauth";
import { reportError } from "@/lib/report-error";
import { writeAudit } from "@/lib/audit";
import {
  getConnection,
  upsertActiveConnection,
  markConnectionDisconnected,
  markConnectionRevoked,
  casRotateConnectionTokens,
  forceConnectionRefresh,
  type ActiveConnection,
  type RevokedReason,
} from "@/lib/channels/connections";

// ---------------------------------------------------------------------------
// Per-organization Hospitable credentials (multi-tenant).
//
// Each customer organization connects its OWN Hospitable account; the Personal
// Access Token is stored ENCRYPTED on the Organization row. This is what keeps
// customers isolated — one org can never read another's Airbnb data.
//
// Backwards compatibility: the founder's original ("primary") org may fall back
// to the global HOSPITABLE_API_TOKEN env var, so the original single-tenant
// deployment keeps working without re-connecting. The primary org is the one
// named by PRIMARY_ORG_ID, or — if unset — simply the OLDEST org (which, before
// any customers are onboarded, is the founder's). New customer orgs are created
// later, are never "oldest", and so NEVER fall back to the shared token.
//
// V0.3 (migration 49) — DUAL-WRITE to `ChannelConnection`. Every credential write
// (connect / reconnect / refresh / disconnect / revoke) writes the org columns AND
// the connection row in ONE transaction, with the SAME ciphertext (encrypted once).
// Reads come from the org columns unless CHANNEL_CONNECTION_READ=1 (read-switch;
// default off), in which case an existing connection row is authoritative and the
// org columns are only a fallback for orgs the backfill has not reached yet.
// The refresh race is fenced TWICE: the org refresh-token blob (F04) and the
// connection `generation` — a stale refresh matches 0 rows on either and is dropped.
// ---------------------------------------------------------------------------

let primaryOrgIdCache: string | null | undefined;

const PROVIDER = "hospitable" as const;

/** Read-switch: an existing ChannelConnection row is the credential authority. */
function readFromConnection(): boolean {
  return process.env.CHANNEL_CONNECTION_READ === "1";
}

/** Id of the org allowed to fall back to the global env token (see file header). */
async function primaryOrgId(): Promise<string | null> {
  if (process.env.PRIMARY_ORG_ID) return process.env.PRIMARY_ORG_ID;
  // In PRODUCTION the primary org MUST be set explicitly. The "oldest org"
  // fallback is convenient in dev/demo (single-tenant), but once real customers
  // exist it could bind the shared env token to the WRONG org — so refuse to guess
  // in production (→ no env-token fallback rather than a wrong one; fail-safe).
  if (process.env.NODE_ENV === "production") return null;
  if (primaryOrgIdCache !== undefined) return primaryOrgIdCache;
  const oldest = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  primaryOrgIdCache = oldest?.id ?? null;
  return primaryOrgIdCache;
}

/** Test/maintenance hook: forget the cached primary-org id. */
export function resetPrimaryOrgCache(): void {
  primaryOrgIdCache = undefined;
}

/** True only for the org allowed to use the global env token (the founder's). */
export async function isPrimaryOrg(orgId: string): Promise<boolean> {
  return (await primaryOrgId()) === orgId;
}

// Refresh this many seconds before actual expiry, so a slow request never
// races past the real deadline (Hospitable access tokens live 12h — this
// buffer is tiny relative to that, just a safety margin).
const TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1000;

/**
 * The Hospitable Personal Access Token (or current OAuth access token) to use
 * for an organization, or null when the org has no usable connection. Callers
 * MUST treat null as "not connected" and skip syncing/sending for that org
 * (never fall back to another org's token).
 *
 * PAT connections (no expiry) are returned as-is. OAuth connections carry an
 * expiry; when it's due this transparently refreshes (using the stored refresh
 * token) before returning, so every existing caller keeps working unchanged.
 */
export type CredentialSource = "connection" | "org_columns" | "env";
export type CredentialDenial = "no_credential" | "connection_inactive" | "connection_tenant_mismatch";
export interface ResolvedHospitableCredential {
  token: string | null;
  /** Token'ın geldiği yer: bağlantı satırı (okuma anahtarı açık) · org kolonları · env fallback. */
  source: CredentialSource | null;
  /** Kimlik bilgisinin ait olduğu AKTİF bağlantı satırı (env → null; satır yoksa null). */
  connectionId: string | null;
  reason: CredentialDenial | null;
}

/**
 * V0.7 — TEK kimlik çözümleyici. `getOrgHospitableToken` bunun sarmalayıcısıdır.
 *
 * Kaynak sırası: (okuma anahtarı açıksa) bağlantı satırı → org kolonları → env fallback
 * (yalnız kurucu org). Satır varsa `connectionId` her zaman onun id'sidir (dual-write kolon
 * ve satırı aynı TX'te yazar; okuma anahtarı kapalıyken kolon okunur ama kimlik satırındır).
 *
 * `forConnectionId` (kuyruk yönlendirmesi): damgalı satır YALNIZ damgalandığı bağlantıdan
 * gider — başka org'un satırı → `connection_tenant_mismatch`; satır silinmiş/aktif değil →
 * `connection_inactive` ve ENV FALLBACK'E DÜŞÜLMEZ (revoked bir bağlantının mesajı kurucu
 * env token'ıyla sessizce gitmesin). Damgasız satır (env altında kuyruklanan) env ile gider.
 */
export async function resolveHospitableCredential(
  orgId: string,
  opts: { forConnectionId?: string | null } = {},
): Promise<ResolvedHospitableCredential> {
  const deny = (reason: CredentialDenial, connectionId: string | null = null): ResolvedHospitableCredential => ({
    token: null,
    source: null,
    connectionId,
    reason,
  });
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { hospitableTokenEnc: true, hospitableRefreshTokenEnc: true, hospitableTokenExpiresAt: true },
  });
  if (!org) return deny("no_credential");

  const conn = await getConnection(orgId, PROVIDER);
  const pinned = opts.forConnectionId ?? null;
  if (pinned !== null) {
    if (!conn || conn.id !== pinned) {
      const other = await prisma.channelConnection.findUnique({ where: { id: pinned }, select: { organizationId: true } });
      if (other && other.organizationId !== orgId) return deny("connection_tenant_mismatch");
      return deny("connection_inactive");
    }
    if (conn.status !== "active") return deny("connection_inactive", conn.id);
  }

  // Credential SOURCE: org columns (default) or the connection row (read-switch).
  let sourceKind: CredentialSource = "org_columns";
  let source: { accessTokenEnc: string | null; refreshTokenEnc: string | null; tokenExpiresAt: Date | null } = {
    accessTokenEnc: org.hospitableTokenEnc,
    refreshTokenEnc: org.hospitableRefreshTokenEnc,
    tokenExpiresAt: org.hospitableTokenExpiresAt,
  };
  if (readFromConnection() && conn) {
    // Row exists → it is the authority. A non-active row means "not connected",
    // whatever the (not-yet-contracted) org columns still say.
    sourceKind = "connection";
    source =
      conn.status === "active"
        ? { accessTokenEnc: conn.accessTokenEnc, refreshTokenEnc: conn.refreshTokenEnc, tokenExpiresAt: conn.tokenExpiresAt }
        : { accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null };
  }
  const activeConnectionId = conn && conn.status === "active" ? conn.id : null;

  if (source.accessTokenEnc) {
    let accessToken: string;
    try {
      accessToken = decryptSecret(source.accessTokenEnc);
    } catch (err) {
      // ⚠️ SESSİZ DEĞİL (denetim, 07-31): hatalı bir ENCRYPTION_KEY ile HER kiracı
      // aynı anda "bağlı değil" olur; sync ve oto-yanıt durur ama /api/health 200
      // kalır. Context org'a göre SABİT → 10 dk'lık throttle çalışır.
      void reportError(
        `hospitable-token-undecryptable org:${orgId}`,
        err instanceof Error ? err : new Error(String(err)),
      );
      return deny("no_credential", activeConnectionId); // corrupt/under a rotated key → treat as disconnected
    }

    // PAT (no expiry tracked) — unchanged legacy path.
    if (!source.tokenExpiresAt) return { token: accessToken, source: sourceKind, connectionId: activeConnectionId, reason: null };

    const dueForRefresh = source.tokenExpiresAt.getTime() - TOKEN_REFRESH_BUFFER_MS <= Date.now();
    if (!dueForRefresh) return { token: accessToken, source: sourceKind, connectionId: activeConnectionId, reason: null };

    // Refresh CAS anchors are read NOW (before the provider round-trip): the org
    // refresh blob and the connection generation. Either changing underneath us
    // (disconnect / reconnect / winning refresh) discards the late result.
    const refreshed = await refreshOrgOAuthToken(orgId, source.refreshTokenEnc, org.hospitableRefreshTokenEnc, conn, {
      currentAccessToken: accessToken,
      expiresAt: source.tokenExpiresAt,
    });
    return refreshed
      ? { token: refreshed, source: sourceKind, connectionId: activeConnectionId, reason: null }
      : deny("no_credential", activeConnectionId);
  }

  // Damgalı satır: aktif bağlantının token'ı yoksa (olmaması gereken durum) env'e DÜŞME.
  if (pinned !== null) return deny("connection_inactive", activeConnectionId);

  // Primary org only: fall back to the global env token (legacy single-tenant).
  const env = process.env.HOSPITABLE_API_TOKEN;
  if (env && (await primaryOrgId()) === orgId) return { token: env, source: "env", connectionId: null, reason: null };
  return deny("no_credential");
}

/**
 * The Hospitable Personal Access Token (or current OAuth access token) to use
 * for an organization, or null when the org has no usable connection. Callers
 * MUST treat null as "not connected" and skip syncing/sending for that org
 * (never fall back to another org's token). V0.7: `resolveHospitableCredential` sarmalayıcısı.
 */
export async function getOrgHospitableToken(orgId: string): Promise<string | null> {
  return (await resolveHospitableCredential(orgId)).token;
}

/** Thrown inside the persist transaction when a CAS anchor no longer matches. */
class StaleRefresh extends Error {}

/**
 * Refresh an expired OAuth access token and persist the new token set. Returns
 * the fresh access token, or null when the org can't currently be refreshed
 * (never throws — this sits on the hot sync/send path, a hiccup here must
 * degrade to "not connected this cycle", not crash the caller).
 */
// ---------------------------------------------------------------------------
// 🚨 YENİLEME TEK UÇUŞ (OAuth O1, Codex 11-10). Yenileme anahtarları ROTASYONLU: aynı anahtarla iki eşzamanlı istek gidince biri yeni
// anahtarı alır, öteki "bu anahtar geçersiz" cevabını alır. Kazanan yeni anahtarı VERİTABANINA YAZMADAN önce kaybeden o cevabı görürse
// (saklanan anahtar hâlâ eskisi) bağlantıyı "anahtar ölü" diye DÜŞÜRÜYORDU — elde geçerli anahtar varken ev sahibi yeniden bağlanmak
// zorunda kalıyordu. Artık bir işletmenin yenilemesini aynı anda TEK istek yapar:
//  · aynı süreçte: eşzamanlı çağrılar tek isteği paylaşır (`refreshInFlight`);
//  · süreçler / kopyalar arasında: kısa ömürlü kilit (`SystemLock`). Kilidi alamayan sağlayıcıya HİÇ gitmez; kazananın yazdığı anahtarı
//    bekleyip okur. Kilit deposu okunamazsa istek yine yapılır (yenileme kilit yüzünden durmasın).
//  · kilit alındıktan SONRA saklanan anahtar yeniden okunur: bu çağrı beklerken başka biri yenilediyse sağlayıcıya (artık tüketilmiş
//    eski anahtarla) hiç gidilmez, yazılmış yeni anahtar kullanılır;
//  · 🚨 BAĞLANTIYI DÜŞÜRMEK MÜNHASIRLIK İSTER: "anahtar ölü" cevabı ancak bu çağrı kilidi deneme boyunca GERÇEKTEN elinde tuttuysa
//    bağlantıyı kaldırır. Kilit alınamadıysa (depo arızası) ya da deneme sırasında elden çıktıysa (süresi doldu, başkası devraldı)
//    cevap belirsizdir — aynı anda başka bir yenileme eski anahtarı tüketmiş olabilir — bağlantıya DOKUNULMAZ; anahtar gerçekten ölüyse
//    bir sonraki (münhasır) deneme aynı cevabı alır ve o zaman kaldırır (Haiku incelemesi 11-11).
// ---------------------------------------------------------------------------
const refreshInFlight = new Map<string, Promise<string | null>>();
const REFRESH_LOCK_TTL_MS = 60_000; // sağlayıcı zaman aşımı (15 sn) + iki yazım denemesi; çöken süreç en geç bu kadar sonra yol verir
let refreshWaitMs = 8_000;
let refreshPollMs = 250;
/** Yalnız test: bekleme sürelerini kısaltır. */
export function __setOAuthRefreshWaitForTests(waitMs: number, pollMs: number): void {
  refreshWaitMs = waitMs;
  refreshPollMs = pollMs;
}
export function oauthRefreshLockName(orgId: string): string {
  return `hospitable-oauth-refresh:${orgId}`;
}

/** `claimed`: kilit bizde (münhasır) · `busy`: başka bir yenileme sürüyor · `unknown`: kilit deposu okunamadı (münhasırlık bilinmiyor). */
async function claimRefreshLock(orgId: string, owner: string): Promise<"claimed" | "busy" | "unknown"> {
  const name = oauthRefreshLockName(orgId);
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + REFRESH_LOCK_TTL_MS);
  try {
    const created = await prisma.systemLock.createMany({ data: [{ name, lockedUntil, holder: owner }], skipDuplicates: true });
    if (created.count === 1) return "claimed";
    const taken = await prisma.systemLock.updateMany({ where: { name, lockedUntil: { lte: now } }, data: { lockedUntil, holder: owner } });
    return taken.count === 1 ? "claimed" : "busy";
  } catch {
    return "unknown";
  }
}

/** Kilit HÂLÂ bu çağrıda mı (sahip aynı, süresi dolmamış)? Okunamazsa "hayır" — münhasırlık kanıtlanamıyor. */
async function stillHoldsRefreshLock(orgId: string, owner: string): Promise<boolean> {
  const row = await prisma.systemLock.findUnique({ where: { name: oauthRefreshLockName(orgId) }, select: { holder: true, lockedUntil: true } }).catch(() => null);
  return row !== null && row.holder === owner && row.lockedUntil > new Date();
}

/** Başka bir süreç yeniliyor: sağlayıcıya gitmeden, kazananın yazdığı anahtarı bekle. Yazılmadıysa bu tur elde ne varsa onunla biter. */
async function awaitOtherRefresh(
  orgId: string,
  orgRefreshBlobAtStart: string | null,
  fallback?: { currentAccessToken: string; expiresAt: Date },
): Promise<string | null> {
  const deadline = Date.now() + refreshWaitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, refreshPollMs));
    const org = await prisma.organization
      .findUnique({ where: { id: orgId }, select: { hospitableTokenEnc: true, hospitableRefreshTokenEnc: true } })
      .catch(() => undefined);
    if (org === null) return null;
    if (org && org.hospitableRefreshTokenEnc !== orgRefreshBlobAtStart) {
      // Kazanan yeni anahtarları yazdı (ya da bağlantı bu arada kaldırıldı / değişti).
      if (!org.hospitableTokenEnc) return null;
      try {
        return decryptSecret(org.hospitableTokenEnc);
      } catch {
        return null;
      }
    }
    const lock = await prisma.systemLock.findUnique({ where: { name: oauthRefreshLockName(orgId) }, select: { lockedUntil: true } }).catch(() => undefined);
    if (lock === null || (lock && lock.lockedUntil <= new Date())) break; // öteki yenileme bitti ama anahtar değişmedi (başarısız)
  }
  return fallback && fallback.expiresAt.getTime() > Date.now() ? fallback.currentAccessToken : null;
}

async function refreshOrgOAuthToken(
  orgId: string,
  refreshTokenEnc: string | null,
  orgRefreshBlobAtStart: string | null,
  connAtStart: ActiveConnection | null,
  fallback?: { currentAccessToken: string; expiresAt: Date },
): Promise<string | null> {
  if (!getHospitableOAuthConfig() || !refreshTokenEnc) return null; // OAuth not configured / no refresh token stored
  const key = `${orgId}:${refreshTokenEnc}`;
  const running = refreshInFlight.get(key);
  if (running) return running;
  const flight = (async () => {
    const owner = randomBytes(9).toString("base64url");
    const claim = await claimRefreshLock(orgId, owner);
    if (claim === "busy") return awaitOtherRefresh(orgId, orgRefreshBlobAtStart, fallback);
    try {
      // Kilidi beklerken / alırken başka bir yenileme bitmiş olabilir: saklanan anahtar değiştiyse elimizdeki eski anahtar TÜKETİLMİŞTİR —
      // sağlayıcıya onunla gidilmez (boşuna "geçersiz" cevabı; bazı sağlayıcılar yeniden kullanımı görünce yeni anahtarı da iptal eder).
      const stored = await prisma.organization
        .findUnique({ where: { id: orgId }, select: { hospitableTokenEnc: true, hospitableRefreshTokenEnc: true } })
        .catch(() => undefined);
      if (stored === null) return null;
      if (stored && stored.hospitableRefreshTokenEnc !== orgRefreshBlobAtStart) {
        if (!stored.hospitableTokenEnc) return null;
        try {
          return decryptSecret(stored.hospitableTokenEnc);
        } catch {
          return null;
        }
      }
      const exclusive = async () => claim === "claimed" && (await stillHoldsRefreshLock(orgId, owner));
      return await refreshOrgOAuthTokenOnce(orgId, refreshTokenEnc, orgRefreshBlobAtStart, connAtStart, fallback, exclusive);
    } finally {
      await prisma.systemLock.deleteMany({ where: { name: oauthRefreshLockName(orgId), holder: owner } }).catch(() => {});
    }
  })().finally(() => refreshInFlight.delete(key));
  refreshInFlight.set(key, flight);
  return flight;
}

async function refreshOrgOAuthTokenOnce(
  orgId: string,
  refreshTokenEnc: string | null,
  orgRefreshBlobAtStart: string | null,
  connAtStart: ActiveConnection | null,
  fallback?: { currentAccessToken: string; expiresAt: Date },
  /** Bu deneme kilidi baştan sona elinde tuttu mu (↑ başlık)? Verilmezse münhasır sayılır (yalnız doğrudan çağrılar). */
  exclusive?: () => Promise<boolean>,
): Promise<string | null> {
  const config = getHospitableOAuthConfig();
  if (!config || !refreshTokenEnc) return null; // OAuth not configured / no refresh token stored

  let refreshToken: string;
  try {
    refreshToken = decryptSecret(refreshTokenEnc);
  } catch {
    return null;
  }

  try {
    const tokens = await refreshAccessToken(config, refreshToken);
    // ⚠️ PERSIST KENDİ TRY'INDA (denetim, 08-01). Refresh token'ları ROTASYONLUDUR:
    // bu çağrı başarılı döndüyse eski token sağlayıcıda HARCANMIŞTIR. Persist
    // düşerse bir kez ANINDA yeniden dene; yine düşerse ayrı alarm + taze token
    // döndür (bu tur hiç değilse çalışsın). CAS kaybı (0 satır) ise ayrı: bağlantı
    // bu refresh sürerken değişti → gecikmiş token ne yazılır ne verilir (F04).
    let persisted: boolean;
    try {
      persisted = await persistOAuthTokenSet(orgId, tokens, orgRefreshBlobAtStart, connAtStart);
    } catch {
      try {
        persisted = await persistOAuthTokenSet(orgId, tokens, orgRefreshBlobAtStart, connAtStart);
      } catch (persistErr) {
        void reportError(
          `hospitable-oauth-persist org:${orgId}`,
          new Error(
            "Rotasyonlu refresh token ALINDI ama KAYDEDİLEMEDİ — eski token sağlayıcıda " +
              "harcandı, bu bağlantı bir sonraki yenilemede kopacak (host yeniden bağlanmalı).",
            { cause: persistErr },
          ),
        );
        return tokens.accessToken;
      }
    }
    if (!persisted) {
      console.warn(`[hospitable-credentials] stale refresh result discarded (connection changed mid-refresh) org:${orgId}`);
      return null;
    }
    return tokens.accessToken;
  } catch (err) {
    void reportError(`hospitable-oauth-refresh org:${orgId}`, err);

    if (err instanceof HospitableOAuthError && err.authFailure) {
      // Münhasırlık kanıtlanamıyorsa cevap belirsizdir (eşzamanlı bir yenileme anahtarı tüketmiş olabilir): bağlantıya dokunulmaz, bu tur
      // anahtarsız biter; gerçekten ölü anahtar bir sonraki münhasır denemede kaldırılır.
      if (exclusive && !(await exclusive())) {
        void reportError(`hospitable-oauth-refresh-unverified org:${orgId}`, new Error("Yenileme reddedildi ama deneme münhasır değildi — bağlantı korunuyor, sonraki tur yeniden denenecek."));
        return null;
      }
      // The refresh token itself is dead (expired/reused/revoked) — the connection
      // cannot self-heal. Clear it so Settings correctly shows "not connected" and
      // the host is prompted to reconnect. ATOMIC + CONDITIONAL (F04): only if the
      // stored blob is still the one we failed with (a concurrent winner may have
      // rotated a fresh token in); the connection row is revoked in the SAME
      // transaction so the two records can never disagree.
      const cleared = await prisma.$transaction(async (tx) => {
        const c = await tx.organization.updateMany({
          where: { id: orgId, hospitableRefreshTokenEnc: refreshTokenEnc },
          data: {
            hospitableTokenEnc: null,
            hospitableRefreshTokenEnc: null,
            hospitableTokenExpiresAt: null,
            hospitableLabel: null,
            hospitableConnectedAt: null,
          },
        });
        if (c.count === 1) await markConnectionRevoked(orgId, PROVIDER, "refresh_invalid_grant", tx);
        return c.count;
      });
      if (cleared === 1) {
        await auditConnectionRevoked(orgId, "refresh_invalid_grant");
        void reportError(
          `hospitable-oauth-disconnected org:${orgId}`,
          new Error("Refresh token ölü — kiracının Hospitable bağlantısı kaldırıldı, yeniden bağlanmalı."),
        );
      }
      return null;
    }

    // Transient failure (network/5xx) — leave the stored refresh token alone and
    // let the next cycle retry. If the current access token hasn't ACTUALLY
    // expired yet, hand it back so this cycle still works.
    if (fallback && fallback.expiresAt.getTime() > Date.now()) {
      return fallback.currentAccessToken;
    }
    return null;
  }
}

/**
 * Persist a rotated token set — ONLY if BOTH CAS anchors still hold: the org
 * refresh blob read at refresh start (F04) and the connection generation read at
 * refresh start (V0.3). Returns whether the write landed; `false` = the connection
 * changed underneath (cleared / reconnected / rotated by a concurrent winner) and
 * NOTHING was written. Throws on a DB error (the caller retries once).
 */
async function persistOAuthTokenSet(
  orgId: string,
  tokens: HospitableTokenSet,
  expectedOrgRefreshBlob: string | null,
  connAtStart: ActiveConnection | null,
): Promise<boolean> {
  const accessTokenEnc = encryptSecret(tokens.accessToken);
  const refreshTokenEnc = encryptSecret(tokens.refreshToken);
  try {
    await prisma.$transaction(async (tx) => {
      const org = await tx.organization.updateMany({
        where: { id: orgId, hospitableRefreshTokenEnc: expectedOrgRefreshBlob },
        data: { hospitableTokenEnc: accessTokenEnc, hospitableRefreshTokenEnc: refreshTokenEnc, hospitableTokenExpiresAt: tokens.expiresAt },
      });
      if (org.count !== 1) throw new StaleRefresh();
      if (connAtStart) {
        const ok = await casRotateConnectionTokens(
          connAtStart.id,
          connAtStart.generation,
          { accessTokenEnc, refreshTokenEnc, tokenExpiresAt: tokens.expiresAt },
          tx,
        );
        if (!ok) throw new StaleRefresh();
      } else {
        // Backfill has not reached this org yet → converge now. `create` (not upsert):
        // a row appearing meanwhile (reconnect race) is a P2002 → stale.
        try {
          await tx.channelConnection.create({
            data: { organizationId: orgId, provider: PROVIDER, status: "active", accessTokenEnc, refreshTokenEnc, tokenExpiresAt: tokens.expiresAt, generation: 1, connectedAt: new Date() },
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new StaleRefresh();
          throw err;
        }
      }
    });
    return true;
  } catch (err) {
    if (err instanceof StaleRefresh) return false;
    throw err;
  }
}

async function auditConnectionRevoked(orgId: string, reason: RevokedReason): Promise<void> {
  await writeAudit({
    organizationId: orgId,
    actorUserId: null,
    action: "channel.connection_revoked",
    metadata: { provider: PROVIDER, reason },
  });
}

/**
 * Store the initial token set from a completed OAuth connect flow. Unlike the
 * PAT path (setOrgHospitableToken), this also tracks the refresh token +
 * expiry, so getOrgHospitableToken knows to refresh instead of treating it as
 * a permanent token. Dual-writes the ChannelConnection row (same ciphertext).
 */
export async function setOrgHospitableOAuthTokens(
  orgId: string,
  tokens: HospitableTokenSet,
  label: string | null,
  /**
   * 🚨 KOŞULLU YAZIM (OAuth O2, Codex 11-10): dönüşün (callback) TÜKETTİĞİ niyetin sahiplik değeri (`consumeOAuthConnectIntent`). Yazım
   * yalnız o niyet satırı hâlâ yerindeyse yapılır — yetki kodu anahtara çevrilirken (ağ) ev sahibi bağlantıyı kaldırdıysa, elle anahtar
   * girdiyse ya da akışı yeniden başlattıysa satır silinmiş / değişmiştir ve geç gelen sonuç onların üstüne YAZILMAZ (dönüş `false`).
   * Satır silme ile anahtar yazımı AYNI işlemdedir; öteki işlemler de satırı kendi işlemlerinde siler → sıra hangisi olursa olsun
   * SON karar kazanır. Verilmezse koşulsuz (iç çağrılar / testler).
   */
  expected?: { claim: string },
): Promise<boolean> {
  const accessTokenEnc = encryptSecret(tokens.accessToken);
  const refreshTokenEnc = encryptSecret(tokens.refreshToken);
  return prisma.$transaction(async (tx) => {
    if (expected) {
      const own = await tx.systemLock.deleteMany({ where: { name: connectIntentLockName(orgId), holder: expected.claim } });
      if (own.count !== 1) return false;
    } else {
      await tx.systemLock.deleteMany({ where: { name: connectIntentLockName(orgId) } }); // bekleyen başka bir dönüş bu kararı ezemez
    }
    const written = await tx.organization.updateMany({
      where: { id: orgId },
      data: {
        hospitableTokenEnc: accessTokenEnc,
        hospitableRefreshTokenEnc: refreshTokenEnc,
        hospitableTokenExpiresAt: tokens.expiresAt,
        hospitableLabel: label,
        hospitableConnectedAt: new Date(),
      },
    });
    if (written.count !== 1) throw new Error("hospitable-oauth-save: organization not found"); // işlem geri alınır (niyet satırı da)
    await upsertActiveConnection(orgId, PROVIDER, { accessTokenEnc, refreshTokenEnc, tokenExpiresAt: tokens.expiresAt, label }, tx);
    return true;
  });
}

// ---------------------------------------------------------------------------
// BAĞLANTI NİYETİ (OAuth O2 + O5, Codex 11-10). "Hospitable ile Bağlan" akışı tarayıcıda dakikalarca açık kalabilir; dönüş geldiğinde
// işletmenin bağlantısı çoktan değişmiş olabilir (ev sahibi başka sekmede bağlantıyı kaldırdı / elle anahtar girdi / akışı yeniden
// başlattı). Eskiden geciken dönüş koşulsuz yazıyor, daha YENİ kararı eziyordu; aynı imzalı durum değeriyle dönüş adresi tekrar tekrar
// çağrılabiliyor, her çağrı sağlayıcıya bir yetki kodu isteği gönderiyordu. Artık işletme başına TEK bekleyen niyet var (`SystemLock`
// satırı, sahibi akışın durum değeri):
//  · akış başlarken yazılır (öncekinin yerine geçer);
//  · dönüş onu SAHİPLENİR (tek kullanımlık: süresi dolmuş / başkasıyla değiştirilmiş / zaten kullanılmış → reddedilir, sağlayıcıya
//    istek gitmez); sahiplenilen satır yazım anına kadar yerinde kalır;
//  · yazım (`setOrgHospitableOAuthTokens`) satırı AYNI işlemde siler — satır yoksa yazmaz;
//  · EV SAHİBİNİN bağlantı kararı olan her işlem (elle anahtar, kaldırma, başarılı OAuth) satırı kendi işleminde siler. Arka plandaki
//    "yenileme anahtarı öldü → bağlantı düştü" olayı satırı SİLMEZ: o bir karar değildir, yeniden bağlanmakta olan ev sahibinin akışı sürmeli.
// ---------------------------------------------------------------------------
export function connectIntentLockName(orgId: string): string {
  return `hospitable-connect-intent:${orgId}`;
}

/** OAuth akışı BAŞLARKEN: bu işletmenin bekleyen tek bağlantı niyeti bu akış olur. */
export async function registerOAuthConnectIntent(orgId: string, state: string, ttlSeconds: number, now: Date = new Date()): Promise<void> {
  const name = connectIntentLockName(orgId);
  const lockedUntil = new Date(now.getTime() + ttlSeconds * 1000);
  await prisma.systemLock.upsert({ where: { name }, create: { name, lockedUntil, holder: state }, update: { lockedUntil, holder: state } });
}

/**
 * Dönüşte: bekleyen niyet hâlâ BU akışsa ve süresi dolmadıysa onu SAHİPLENİR (tek kullanımlık) ve yazımın sunacağı sahiplik değerini
 * döndürür. Değilse null — akış geçersiz (yeniden başlatılmalı). Sahiplik değeri durum değerinden FARKLIDIR: aynı dönüş ikinci kez
 * çağrılınca satır artık durum değerini taşımaz → reddedilir.
 */
export async function consumeOAuthConnectIntent(orgId: string, state: string, now: Date = new Date()): Promise<{ claim: string } | null> {
  const claim = `${state}#${randomBytes(9).toString("base64url")}`;
  const consumed = await prisma.systemLock.updateMany({
    where: { name: connectIntentLockName(orgId), holder: state, lockedUntil: { gt: now } },
    data: { holder: claim },
  });
  return consumed.count === 1 ? { claim } : null;
}

/** True when the org can talk to Hospitable (own token or primary env fallback). */
export async function hasOrgHospitable(orgId: string): Promise<boolean> {
  return (await getOrgHospitableToken(orgId)) !== null;
}

/** Bağlantı yaşam döngüsü durumu — SAKLI veriden; sağlayıcı sağlığı DEĞİL. */
export type ConnectionState = "connected" | "env_fallback" | "disconnected" | "revoked" | "never_connected";

export interface HospitableConnectionInfo {
  /** Kimlik bilgisi çözülebiliyor (kendi ya da env). Sağlayıcının sağlıklı çalıştığı anlamına GELMEZ. */
  connected: boolean;
  ownToken: boolean;
  envAvailable: boolean;
  label: string | null;
  connectedAt: Date | null;
  /** V0.7: kendi bağlantısının durumu (env fallback'ten bağımsız gösterilir). */
  state: ConnectionState;
  credentialSource: "db" | "env" | null;
  /** Bağlantı satırı (durumu ne olursa olsun — tarihçe); satır yoksa null. */
  connectionId: string | null;
  revokedReason: RevokedReason | null;
  disconnectedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * V0.7 — bağlantı bilgisi ChannelConnection satırından (otorite); satır yoksa org kolonları
 * (backfill öncesi). Sağlayıcıya ÇAĞRI YOK: "bağlantı var" ile "sağlayıcı sağlıklı" karışmaz.
 * Kurucu org'un env fallback'i ayrı bir gerçek olarak taşınır: kendi bağlantısı revoked/
 * disconnected olsa da `connected` env ile true, `state` kendi bağlantısının durumudur.
 */
export async function getConnectionInfo(orgId: string): Promise<HospitableConnectionInfo> {
  const [org, row] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { hospitableTokenEnc: true, hospitableLabel: true, hospitableConnectedAt: true },
    }),
    prisma.channelConnection.findUnique({
      where: { organizationId_provider: { organizationId: orgId, provider: PROVIDER } },
      select: {
        id: true,
        status: true,
        label: true,
        accessTokenEnc: true,
        connectedAt: true,
        disconnectedAt: true,
        revokedAt: true,
        revokedReason: true,
      },
    }),
  ]);
  const decryptable = (blob: string | null | undefined): boolean => {
    if (!blob) return false;
    try {
      decryptSecret(blob);
      return true;
    } catch {
      return false;
    }
  };
  const ownToken = row ? row.status === "active" && decryptable(row.accessTokenEnc) : decryptable(org?.hospitableTokenEnc);
  const isPrimary = (await primaryOrgId()) === orgId;
  const envAvailable = Boolean(process.env.HOSPITABLE_API_TOKEN) && isPrimary;
  const state: ConnectionState =
    row?.status === "revoked"
      ? "revoked"
      : ownToken
        ? "connected"
        : row?.status === "disconnected"
          ? "disconnected"
          : envAvailable
            ? "env_fallback"
            : "never_connected";
  return {
    connected: ownToken || envAvailable,
    ownToken,
    envAvailable,
    label: row ? row.label : (org?.hospitableLabel ?? null),
    connectedAt: row ? row.connectedAt : (org?.hospitableConnectedAt ?? null),
    state,
    credentialSource: ownToken ? "db" : envAvailable ? "env" : null,
    connectionId: row?.id ?? null,
    revokedReason: (row?.revokedReason as RevokedReason | null | undefined) ?? null,
    disconnectedAt: row?.disconnectedAt ?? null,
    revokedAt: row?.revokedAt ?? null,
  };
}

/**
 * Store (encrypted) the Hospitable PAT an org will use from now on. Explicitly
 * clears any OAuth refresh/expiry fields — a PAT never expires, so if an org
 * previously connected via OAuth and now pastes a PAT instead (or an operator
 * resets it), getOrgHospitableToken must treat it as the non-expiring legacy
 * path, not try to "refresh" a manually-entered token. Dual-writes the connection.
 */
export async function setOrgHospitableToken(
  orgId: string,
  token: string,
  label: string | null,
): Promise<void> {
  const accessTokenEnc = encryptSecret(token);
  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: orgId },
      data: {
        hospitableTokenEnc: accessTokenEnc,
        hospitableRefreshTokenEnc: null,
        hospitableTokenExpiresAt: null,
        hospitableLabel: label,
        hospitableConnectedAt: new Date(),
      },
    });
    await tx.systemLock.deleteMany({ where: { name: connectIntentLockName(orgId) } }); // bekleyen OAuth dönüşü bu kararı ezemez (O2)
    await upsertActiveConnection(orgId, PROVIDER, { accessTokenEnc, refreshTokenEnc: null, tokenExpiresAt: null, label }, tx);
  });
}

/** Remove an org's stored Hospitable token (disconnect) — PAT or OAuth alike. */
export async function clearOrgHospitableToken(orgId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: orgId },
      data: {
        hospitableTokenEnc: null,
        hospitableRefreshTokenEnc: null,
        hospitableTokenExpiresAt: null,
        hospitableLabel: null,
        hospitableConnectedAt: null,
      },
    });
    await tx.systemLock.deleteMany({ where: { name: connectIntentLockName(orgId) } }); // bekleyen OAuth dönüşü bağlantıyı geri getiremez (O2)
    await markConnectionDisconnected(orgId, PROVIDER, tx);
  });
}

/**
 * `env_rejected` (Tur 7 T7-OB-2): reddedilen token kayıtlı bir org token'ı DEĞİL, kurucu org'un ortam yedeği (`HOSPITABLE_API_TOKEN`).
 * Ne yenilenebilir ne iptal edilebilir — "noop" demek kuyruğun her geçişte ölü anahtarla yeniden göndermesine yol açıyordu.
 */
export type ProviderAuthFailureOutcome = "refresh_forced" | "revoked" | "noop" | "env_rejected";

/**
 * The provider rejected this org's credential on an authenticated call (HTTP
 * 401/403 on a send — V0.3 `auth_revoked`). Lifecycle decision, mirroring what the
 * refresh path already does for a dead refresh token:
 *   · OAuth (refresh token present) and NOT freshly refreshed → force a refresh on
 *     the next read (the access token may simply be stale); the row waits.
 *   · OAuth freshly refreshed (< 10 min) and STILL rejected, or PAT → the credential
 *     is dead: clear the org columns (conditionally — a just-reconnected token is
 *     never wiped), mark the connection `revoked`, audit + alarm. Settings shows
 *     "not connected"; queued rows park (no provider call) until the host reconnects.
 * Never throws — callers are on the worker hot path.
 */
export async function handleProviderAuthFailure(
  orgId: string,
  status: 401 | 403,
  /** 401 / 403'ü ALAN isteğin kullandığı token (düz). Kayıttaki token artık bu değilse hüküm verilmez. */
  failedToken: string,
): Promise<ProviderAuthFailureOutcome> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { hospitableTokenEnc: true, hospitableRefreshTokenEnc: true },
  });
  if (!org || !org.hospitableTokenEnc) {
    // Kayıtlı token yok: reddedilen token ortam yedeğiyse (yalnız PRIMARY_ORG_ID kullanır) çağıran bunu KALICI ret sayar (T7-OB-2).
    const env = process.env.HOSPITABLE_API_TOKEN;
    return env && failedToken === env ? "env_rejected" : "noop"; // aksi hâlde zaten bağlantısız
  }
  // 🚨 GEÇ GELEN RED YENİ BAĞLANTIYI DÜŞÜRMEZ (Codex 09-30, A5). Aşağıdaki koşullu yazma işleyicinin O AN okuduğu token'a
  // göreydi: gönderim sürerken ev sahibi yeniden bağlandıysa (ya da token yenilendiyse) ESKİ token'ın geç gelen 401'i YENİ
  // bağlantıyı iptal ediyordu. Hüküm yalnız reddedilen token HÂLÂ kayıttaki token ise verilir.
  let current: string | null = null;
  try {
    current = decryptSecret(org.hospitableTokenEnc);
  } catch {
    current = null;
  }
  if (current !== failedToken) return "noop";

  const conn = await getConnection(orgId, PROVIDER);
  const lastRefreshAt = conn
    ? (await prisma.channelConnection.findUnique({ where: { id: conn.id }, select: { lastRefreshAt: true } }))?.lastRefreshAt ?? null
    : null;
  const freshlyRefreshed = lastRefreshAt != null && Date.now() - lastRefreshAt.getTime() < 10 * 60_000;

  if (org.hospitableRefreshTokenEnc && !freshlyRefreshed) {
    await prisma.$transaction(async (tx) => {
      await tx.organization.updateMany({
        where: { id: orgId, hospitableTokenEnc: org.hospitableTokenEnc },
        data: { hospitableTokenExpiresAt: new Date(0) },
      });
      await forceConnectionRefresh(orgId, PROVIDER, tx);
    });
    return "refresh_forced";
  }

  const reason: RevokedReason = status === 403 ? "send_403" : "send_401";
  const cleared = await prisma.$transaction(async (tx) => {
    const c = await tx.organization.updateMany({
      where: { id: orgId, hospitableTokenEnc: org.hospitableTokenEnc }, // CAS: yeni bağlanmış token silinmez
      data: {
        hospitableTokenEnc: null,
        hospitableRefreshTokenEnc: null,
        hospitableTokenExpiresAt: null,
        hospitableLabel: null,
        hospitableConnectedAt: null,
      },
    });
    if (c.count === 1) await markConnectionRevoked(orgId, PROVIDER, reason, tx);
    return c.count;
  });
  if (cleared !== 1) return "noop";
  await auditConnectionRevoked(orgId, reason);
  void reportError(
    `hospitable-auth-revoked org:${orgId}`,
    new Error(`Sağlayıcı kimlik bilgisini reddetti (HTTP ${status}) — kiracının Hospitable bağlantısı kaldırıldı, yeniden bağlanmalı.`),
  );
  return "revoked";
}
