import "server-only";

import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
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
async function refreshOrgOAuthToken(
  orgId: string,
  refreshTokenEnc: string | null,
  orgRefreshBlobAtStart: string | null,
  connAtStart: ActiveConnection | null,
  fallback?: { currentAccessToken: string; expiresAt: Date },
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
): Promise<void> {
  const accessTokenEnc = encryptSecret(tokens.accessToken);
  const refreshTokenEnc = encryptSecret(tokens.refreshToken);
  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: orgId },
      data: {
        hospitableTokenEnc: accessTokenEnc,
        hospitableRefreshTokenEnc: refreshTokenEnc,
        hospitableTokenExpiresAt: tokens.expiresAt,
        hospitableLabel: label,
        hospitableConnectedAt: new Date(),
      },
    });
    await upsertActiveConnection(orgId, PROVIDER, { accessTokenEnc, refreshTokenEnc, tokenExpiresAt: tokens.expiresAt, label }, tx);
  });
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
    await markConnectionDisconnected(orgId, PROVIDER, tx);
  });
}

export type ProviderAuthFailureOutcome = "refresh_forced" | "revoked" | "noop";

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
export async function handleProviderAuthFailure(orgId: string, status: 401 | 403): Promise<ProviderAuthFailureOutcome> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { hospitableTokenEnc: true, hospitableRefreshTokenEnc: true },
  });
  if (!org || !org.hospitableTokenEnc) return "noop"; // already disconnected

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
