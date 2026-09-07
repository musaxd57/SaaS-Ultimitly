import "server-only";

import { prisma } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import {
  getHospitableOAuthConfig,
  refreshAccessToken,
  HospitableOAuthError,
  type HospitableTokenSet,
} from "@/lib/hospitable-oauth";
import { reportError } from "@/lib/report-error";

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
// ---------------------------------------------------------------------------

let primaryOrgIdCache: string | null | undefined;

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
 * PAT connections (hospitableTokenExpiresAt is null) are returned as-is, same
 * as always. OAuth connections carry an expiry; when it's due this
 * transparently refreshes (using the stored refresh token) before returning,
 * so every existing caller keeps working with zero changes on their end.
 */
export async function getOrgHospitableToken(orgId: string): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { hospitableTokenEnc: true, hospitableRefreshTokenEnc: true, hospitableTokenExpiresAt: true },
  });
  if (!org) return null;

  if (org.hospitableTokenEnc) {
    let accessToken: string;
    try {
      accessToken = decryptSecret(org.hospitableTokenEnc);
    } catch (err) {
      // ⚠️ SESSİZ DEĞİL (denetim, 07-31). Bu dala düşmek "şifreleme anahtarı
      // yanlış/eksik ya da satır bozuk" demektir ve etkisi tek org'la sınırlı
      // olmayabilir: hatalı bir `ENCRYPTION_KEY` ile HER kiracı aynı anda
      // "Hospitable bağlı değil" olur, senkron ve oto-yanıt durur — ama
      // `/api/health` 200 kalır (zamanlayıcı koşmaya devam eder) ve hiçbir yere
      // TEK bir olay düşmezdi. Kardeş yollar (2FA gizli anahtarı, takvim feed
      // URL'i) bunu baştan doğru yapıyordu; ürünün en kritik kimlik bilgisi
      // istisnaydı. Context org'a göre SABİT → 10 dk'lık throttle çalışır.
      void reportError(
        `hospitable-token-undecryptable org:${orgId}`,
        err instanceof Error ? err : new Error(String(err)),
      );
      return null; // corrupt/under a rotated key → treat as disconnected
    }

    // PAT (no expiry tracked) — unchanged legacy path.
    if (!org.hospitableTokenExpiresAt) return accessToken;

    const dueForRefresh = org.hospitableTokenExpiresAt.getTime() - TOKEN_REFRESH_BUFFER_MS <= Date.now();
    if (!dueForRefresh) return accessToken;

    return refreshOrgOAuthToken(orgId, org.hospitableRefreshTokenEnc, {
      currentAccessToken: accessToken,
      expiresAt: org.hospitableTokenExpiresAt,
    });
  }

  // Primary org only: fall back to the global env token (legacy single-tenant).
  const env = process.env.HOSPITABLE_API_TOKEN;
  if (env && (await primaryOrgId()) === orgId) return env;
  return null;
}

/**
 * Refresh an expired OAuth access token and persist the new token set. Returns
 * the fresh access token, or null when the org can't currently be refreshed
 * (never throws — this sits on the hot sync/send path, a hiccup here must
 * degrade to "not connected this cycle", not crash the caller).
 */
async function refreshOrgOAuthToken(
  orgId: string,
  refreshTokenEnc: string | null,
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
    // ⚠️ PERSIST KENDİ TRY'INDA (denetim, 08-01 — dördüncü tur, ajan bulgusu).
    // Refresh token'ları ROTASYONLUDUR: bu çağrı başarılı döndüyse eski token
    // sağlayıcıda ARTIK HARCANMIŞTIR. Persist düşerse yeni token yalnız BELLEKTE
    // kalır, DB'de harcanmış eski token durur → bir sonraki tur `invalid_grant`
    // → `authFailure` dalı → kiracının bağlantısı SİLİNİR (2 dk gecikmeli ama
    // kesin). Persist'i `refreshAccessToken` ile aynı `catch`e bırakmak bu
    // KALICI kaybı geçici bir ağ hatasıyla aynı kovaya koyuyordu.
    // Bir kez ANINDA yeniden dene; yine düşerse AYRI ve yüksek-sinyalli bir
    // alarm bas ve TAZE access token'ı döndür — bu tur hiç değilse tam çalışsın
    // (eski `fallback` token'ı en fazla birkaç dakikalıktı).
    // 🚨 BAŞARI YOLU DA SAHİPLİĞE BAĞLI (Codex F04, P1). Persist artık CAS:
    // yalnız satırdaki refresh blob'u HÂLÂ bu refresh'in BAŞLARKEN okuduğu blob
    // ise yazar. Refresh sağlayıcıda beklerken host bağlantıyı KALDIRDIYSA
    // (`clearOrgHospitableToken`) ya da BAŞKA hesapla yeniden bağlandıysa
    // (`setOrgHospitableOAuthTokens`) blob değişmiştir → 0 satır → gecikmiş
    // sonuç ne DB'ye yazılır ne çağırana "aktif token" diye verilir. Eskiden
    // `update({where:{id}})` koşulsuzdu: kaldırılmış bağlantı DİRİLİYOR, seçilen
    // yeni hesap eskisiyle EZİLİYORDU (hata dalı #6'da koşulluydu, başarı dalı
    // değildi). Generation kolonu YOK: blob'u değiştiren her yazma generation'ı
    // ilerletmiş sayılır; DB-düzeyinde olduğu için çoklu instance'ta da geçerli.
    let persisted: boolean;
    try {
      persisted = await persistOAuthTokenSet(orgId, tokens, refreshTokenEnc);
    } catch {
      try {
        persisted = await persistOAuthTokenSet(orgId, tokens, refreshTokenEnc);
      } catch (persistErr) {
        void reportError(
          `hospitable-oauth-persist org:${orgId}`,
          new Error(
            "Rotasyonlu refresh token ALINDI ama KAYDEDİLEMEDİ — eski token sağlayıcıda " +
              "harcandı, bu bağlantı bir sonraki yenilemede kopacak (host yeniden bağlanmalı).",
            { cause: persistErr },
          ),
        );
        // DB yazılamadı (geçici arıza) — sahiplik BİLİNMİYOR ama sözleşme değişmedi:
        // bu tur hiç değilse çalışsın (eski davranış, ↑gerekçe). CAS kaybıyla KARIŞTIRMA.
        return tokens.accessToken;
      }
    }
    if (!persisted) {
      // Bağlantı bu refresh sürerken değişti (disconnect / reconnect / kazanan
      // refresh). Gecikmiş token AKTİF DEĞİLDİR; bir sonraki tur güncel satırı okur.
      // Beklenen, zararsız bir yarış → alarm değil, izli log (sır yok).
      console.warn(`[hospitable-credentials] stale refresh result discarded (connection changed mid-refresh) org:${orgId}`);
      return null;
    }
    return tokens.accessToken;
  } catch (err) {
    void reportError(`hospitable-oauth-refresh org:${orgId}`, err);

    if (err instanceof HospitableOAuthError && err.authFailure) {
      // The refresh token itself is dead (expired/reused/revoked) — the
      // connection cannot self-heal. Clear it so Settings correctly shows
      // "not connected" and the host is prompted to reconnect.
      //
      // BUT only if the STORED refresh token is still the exact one we just
      // failed with. Two overlapping refreshes both send the SAME old token;
      // Hospitable rotates refresh tokens (single-use), so the winner persists
      // a fresh token and the loser gets invalid_grant on the now-spent old one.
      // An unconditional clear here would wipe the winner's just-saved valid token.
      //
      // ATOMIC: a findUnique-then-clear (check-then-act) still races the winner's
      // persist — the winner can rotate in a fresh token BETWEEN our read and our
      // clear, and we'd then wipe it (lost update). Putting the blob in the
      // updateMany WHERE makes the clear a no-op the instant the winner has rotated
      // (0 rows matched) — no read-then-act window. Mirrors clearOrgHospitableToken's
      // field set, gated on the token still being ours.
      const cleared = await prisma.organization.updateMany({
        where: { id: orgId, hospitableRefreshTokenEnc: refreshTokenEnc },
        data: {
          hospitableTokenEnc: null,
          hospitableRefreshTokenEnc: null,
          hospitableTokenExpiresAt: null,
          hospitableLabel: null,
          hospitableConnectedAt: null,
        },
      });
      // ⚠️ SİLME AYRI VE YÜKSEK-SİNYALLİ RAPORLANIR (denetim, 08-01 — dördüncü tur).
      // Yukarıdaki genel `reportError` GEÇİCİ hatalarla AYNI context'i kullanıyor;
      // operatör "ağ hıçkırığı" ile "kiracının bağlantısı KOPTU"yu ayırt edemiyordu.
      // Bağlantı silinince o org'un senkronu sessizce atlanır (`getOrgHospitableToken`
      // null döner) — hiçbir 401/403 uyarısı bile tetiklenmez, çünkü çağrı yapılmaz.
      // ⚠️ HOST'A BİLDİRİM GİTMİYOR: yeni bir müşteri e-postası ürün/e-posta akışı
      //    kararıdır, tek başıma eklemiyorum → `docs/MIGRATION-BEKLEYEN-ISLER.md`.
      if (cleared.count === 1) {
        void reportError(
          `hospitable-oauth-disconnected org:${orgId}`,
          new Error("Refresh token ölü — kiracının Hospitable bağlantısı kaldırıldı, yeniden bağlanmalı."),
        );
      }
      return null;
    }

    // Transient failure (network/5xx) — leave the stored refresh token alone and
    // let the next cycle retry. We only refresh inside a small pre-expiry buffer,
    // so if the current access token hasn't ACTUALLY expired yet, hand it back so
    // this sync/send cycle still works instead of going dark for a transient blip.
    if (fallback && fallback.expiresAt.getTime() > Date.now()) {
      return fallback.currentAccessToken;
    }
    return null;
  }
}

/**
 * Persist a rotated token set — ONLY if the stored refresh blob is still the one this
 * refresh started from (compare-and-set on the ciphertext, F04). Returns whether the
 * write landed; `false` = the connection changed underneath (cleared / reconnected /
 * rotated by a concurrent winner) and NOTHING was written. Throws on a DB error.
 */
async function persistOAuthTokenSet(
  orgId: string,
  tokens: HospitableTokenSet,
  expectedRefreshTokenEnc: string,
): Promise<boolean> {
  const res = await prisma.organization.updateMany({
    where: { id: orgId, hospitableRefreshTokenEnc: expectedRefreshTokenEnc },
    data: {
      hospitableTokenEnc: encryptSecret(tokens.accessToken),
      hospitableRefreshTokenEnc: encryptSecret(tokens.refreshToken),
      hospitableTokenExpiresAt: tokens.expiresAt,
    },
  });
  return res.count === 1;
}

/**
 * Store the initial token set from a completed OAuth connect flow. Unlike the
 * PAT path (setOrgHospitableToken), this also tracks the refresh token +
 * expiry, so getOrgHospitableToken knows to refresh instead of treating it as
 * a permanent token.
 */
export async function setOrgHospitableOAuthTokens(
  orgId: string,
  tokens: HospitableTokenSet,
  label: string | null,
): Promise<void> {
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      hospitableTokenEnc: encryptSecret(tokens.accessToken),
      hospitableRefreshTokenEnc: encryptSecret(tokens.refreshToken),
      hospitableTokenExpiresAt: tokens.expiresAt,
      hospitableLabel: label,
      hospitableConnectedAt: new Date(),
    },
  });
}

/** True when the org can talk to Hospitable (own token or primary env fallback). */
export async function hasOrgHospitable(orgId: string): Promise<boolean> {
  return (await getOrgHospitableToken(orgId)) !== null;
}

export interface HospitableConnectionInfo {
  connected: boolean;
  /** True when this org is connected via its OWN stored token (not env fallback). */
  ownToken: boolean;
  /** True when the global env token exists and this org may claim/use it. */
  envAvailable: boolean;
  label: string | null;
  connectedAt: Date | null;
}

/** Describe an org's Hospitable connection for the settings UI. */
export async function getConnectionInfo(orgId: string): Promise<HospitableConnectionInfo> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { hospitableTokenEnc: true, hospitableLabel: true, hospitableConnectedAt: true },
  });
  // A stored token only counts as "connected" if it still DECRYPTS. After a key
  // rotation it won't — and getOrgHospitableToken treats it as disconnected — so
  // the UI must agree (otherwise it shows "connected" while sync/send silently
  // no-op, with no prompt to reconnect).
  let ownToken = false;
  if (org?.hospitableTokenEnc) {
    try {
      decryptSecret(org.hospitableTokenEnc);
      ownToken = true;
    } catch {
      ownToken = false;
    }
  }
  const isPrimary = (await primaryOrgId()) === orgId;
  const envAvailable = Boolean(process.env.HOSPITABLE_API_TOKEN) && isPrimary;
  return {
    connected: ownToken || envAvailable,
    ownToken,
    envAvailable,
    label: org?.hospitableLabel ?? null,
    connectedAt: org?.hospitableConnectedAt ?? null,
  };
}

/**
 * Store (encrypted) the Hospitable PAT an org will use from now on. Explicitly
 * clears any OAuth refresh/expiry fields — a PAT never expires, so if an org
 * previously connected via OAuth and now pastes a PAT instead (or an operator
 * resets it), getOrgHospitableToken must treat it as the non-expiring legacy
 * path, not try to "refresh" a manually-entered token.
 */
export async function setOrgHospitableToken(
  orgId: string,
  token: string,
  label: string | null,
): Promise<void> {
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      hospitableTokenEnc: encryptSecret(token),
      hospitableRefreshTokenEnc: null,
      hospitableTokenExpiresAt: null,
      hospitableLabel: label,
      hospitableConnectedAt: new Date(),
    },
  });
}

/** Remove an org's stored Hospitable token (disconnect) — PAT or OAuth alike. */
export async function clearOrgHospitableToken(orgId: string): Promise<void> {
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      hospitableTokenEnc: null,
      hospitableRefreshTokenEnc: null,
      hospitableTokenExpiresAt: null,
      hospitableLabel: null,
      hospitableConnectedAt: null,
    },
  });
}
