import "server-only";

import { createHash, randomBytes } from "crypto";
import { appCanonicalOrigin, canonicalHosts } from "@/lib/app-config";
import { identityEmailShell, plainLinkFallback } from "@/lib/email-shell";

// ---------------------------------------------------------------------------
// E-mail verification for self-serve sign-ups (anti-bot / valid-inbox check).
//
// A new registrant gets a one-time link; clicking it marks the account verified
// and logs them in. The raw token travels in the URL; only its sha256 hash is
// stored (deterministic → lookup-by-hash). NOT bcrypt: a 256-bit random token is
// uniformly distributed, and bcrypt's random salt would make hash-lookup
// impossible.
//
// SAFETY: existing accounts (created before EMAIL_VERIFY_REQUIRED_FROM) are NEVER
// gated at login — see the login route — so adding this can't lock anyone out
// (the founder keeps signing in normally).
// ---------------------------------------------------------------------------

/** Accounts created at/after this instant must verify their e-mail to sign in.
 *  Set just before the feature shipped so every pre-existing user is exempt. */
export const EMAIL_VERIFY_REQUIRED_FROM = new Date("2026-06-15T18:00:00Z");

/** True when this user must verify before logging in (new account + unverified). */
export function needsEmailVerification(user: {
  createdAt: Date;
  emailVerifiedAt: Date | null;
}): boolean {
  return user.createdAt >= EMAIL_VERIFY_REQUIRED_FROM && user.emailVerifiedAt == null;
}

export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // link valid for 24h

/** Generate a fresh verification token: the raw token (for the URL) + its hash. */
export function makeVerifyToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex"); // 256-bit, URL-safe
  return { raw, hash: hashVerifyToken(raw) };
}

export function hashVerifyToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// The canonical origin is NOT a constant here any more — it is this deployment's
// identity and lives in app-config (appCanonicalOrigin, a closed allowlist driven
// by APP_URL). Same code, different env: a .eu deployment gets .eu bases for every
// outbound link instead of silently mailing people to .com. On .com, with APP_URL
// unset or set to the .com origin, both resolve to exactly the previous constants.
const CANONICAL_BASE = () => appCanonicalOrigin();
const CANONICAL_HOSTS = () => canonicalHosts();
// `new URL(...).hostname` renders IPv6 WITH brackets — match secure-url.ts.
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** May this APP_URL value serve as the OUTBOUND-link base (Codex 07-23 #2)?
 *  E-mail verification links carry the RAW token, so the base must be beyond
 *  doubt: production accepts ONLY the exact canonical origin — not merely
 *  https (a foreign https origin would receive the tokens). The accepted origin
 *  is THIS deployment's canonical (appCanonicalOrigin — a closed allowlist), so
 *  a .eu deployment trusts .eu and NOT .com, and vice versa. Dev/test also
 *  accept the localhost family (http OK) so local flows work. Origin-based:
 *  a path/trailing slash on the canonical origin is fine (the base is rebuilt
 *  from protocol+host anyway). Unparseable / non-http(s) → false (fail closed).
 *  Never log the value from here. */
export function isTrustedAppUrl(rawUrl: string | undefined | null): boolean {
  if (!rawUrl) return false;
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (`${u.protocol}//${u.host}`.toLowerCase() === CANONICAL_BASE()) return true;
  if (process.env.NODE_ENV === "production") return false;
  return LOCAL_HOSTNAMES.has(u.hostname.toLowerCase());
}

let warnedUntrustedAppUrl = false;

/** The FIXED, trusted public base URL — never derived from a request. A TRUSTED
 *  `APP_URL` (see isTrustedAppUrl) or the canonical default. Use this for
 *  anything that leaves our trust boundary (email links, OAuth redirect_uri):
 *  the Host header is attacker-controllable, so a verify link built from it
 *  could carry the raw token to an attacker's domain (host-header injection).
 *  An UNTRUSTED APP_URL fails CLOSED to the canonical (and the boot gate in
 *  scripts/env-check.mjs already refuses to start production with one) — the
 *  value itself is never logged. */
export function appBaseUrl(): string {
  const env = process.env.APP_URL?.trim();
  if (env) {
    if (isTrustedAppUrl(env)) {
      const u = new URL(env);
      return `${u.protocol}//${u.host}`;
    }
    if (!warnedUntrustedAppUrl) {
      warnedUntrustedAppUrl = true;
      // Value-free by design: an APP_URL can be hostile/typo'd — name the field, never echo it.
      console.warn("[app-url] APP_URL güvenilir değil — canonical base'e düşüldü (değer loglanmaz).");
    }
  }
  return CANONICAL_BASE();
}

/** Is this exact host one we trust to build an in-browser absolute URL from?
 *  Allowlist only — dev localhost/127.* + the canonical domains + the APP_URL
 *  host. A forged/unknown Host is rejected (→ appBaseUrl). Exact match: a
 *  "www.lixusai.com.evil.com" suffix trick does NOT pass. */
function isAllowedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.startsWith("localhost:")) return true;
  if (h === "127.0.0.1" || h.startsWith("127.0.0.1:")) return true;
  if (CANONICAL_HOSTS().has(h)) return true;
  try {
    // Only a TRUSTED APP_URL may extend the allowlist (Codex 07-23 #2): before
    // this check, a hostile APP_URL both fed appBaseUrl AND opened this host
    // gate for in-browser redirects.
    if (process.env.APP_URL && isTrustedAppUrl(process.env.APP_URL) && new URL(process.env.APP_URL).host.toLowerCase() === h)
      return true;
  } catch {
    // ignore
  }
  return false;
}

/** Public base URL for an IN-BROWSER redirect back to our own site. Behind
 *  Railway/Cloudflare, req.nextUrl.origin is the INTERNAL origin — the Host
 *  carries the real public domain. But the Host is client-controllable, so it's
 *  ALLOWLISTED here: a recognized host is used as-is; anything else (or missing)
 *  falls back to the fixed trusted base, so a forged Host can't open-redirect the
 *  browser to an attacker domain. NOT for email/OAuth links — use appBaseUrl. */
export function baseUrlFromHost(host: string | null): string {
  const h = host?.trim();
  if (h && isAllowedHost(h)) {
    const proto = h.startsWith("localhost") || h.startsWith("127.") ? "http" : "https";
    return `${proto}://${h}`;
  }
  return appBaseUrl();
}

/** Absolute verify URL for an e-mailed link — built from the FIXED trusted base,
 *  NEVER the request Host, so the token can't be redirected to an attacker's
 *  domain via a forged Host header. */
/**
 * E-posta doğrulama bağlantısı.
 *
 * 🚨 TOKEN **FRAGMENT**'TE (`#t=`), QUERY'DE DEĞİL — GERİ TAŞIMA. `m47`'de
 * şifre sıfırlamada verilen kararın AYNISI, üstelik burada bahis daha yüksek:
 * o token'ın yanında ikinci bir faktör (8 haneli kod) vardı, BU token tek
 * başına OTURUM BASIYOR (`verify-email/route.ts`). Query, HTTP istek satırının
 * parçasıdır — Railway edge log'u, Next istek log'u, araya giren vekiller ve
 * e-posta güvenlik tarayıcılarının ön-ısıtma istekleri onu görür; bu
 * katmanların token'ı saklamadığını KANITLAYAMAYIZ (üçüncü taraf platform).
 * Fragment sunucuya HİÇ gitmez ve `Referer`'dan spec gereği çıkarılır.
 *
 * ⚠️ Bağlantı artık bir API ucuna değil bir SAYFAYA gidiyor: fragment yalnız
 * istemcide görülebildiği için token'ı okuyup POST eden bir adım gerekiyor
 * (`components/auth/verify-email-form.tsx`). Kabul edilen artık risk, m47'deki
 * ile aynı: fragment tarayıcı geçmişinde kalır — istemci onu okur okumaz
 * `history.replaceState` ile siler.
 */
export function verifyUrl(rawToken: string): string {
  return `${appBaseUrl()}/e-posta-dogrula#t=${encodeURIComponent(rawToken)}`;
}

/**
 * 🚨 KİŞİSELLEŞTİRME YOK (09-23, güvenlik ajanı): bu e-posta KİMLİKSİZ bir istekle
 * (kayıt / yeniden gönder) HERHANGİ bir adrese gönderilebilir ve eskiden kayıtta yazılan
 * AD selamlamaya kalın basılıyordu. HTML kaçışlı olduğu için XSS değildi ama İÇERİK
 * ENJEKSİYONUYDU: saldırgan kurbanın adresiyle kayıt olup ad alanına "Hesabınız askıya
 * alındı, 0850… arayın" yazınca kurbana `noreply@lixusai.com`dan, gerçek bir doğrulama
 * bağlantısının yanında o metin gidiyordu. `account_exists` e-postası aynı gerekçeyle
 * zaten kişiselleştirilmiyordu; bu ikisi artık aynı kuralda.
 */
export function verifyEmailHtml(url: string): string {
  return identityEmailShell({
    heading: "E-postanızı doğrulayın",
    intro: `Merhaba, Lixus AI hesabınız oluşturuldu. Doğrulamayı tamamlamak için aşağıdaki butona tıklayın ve <strong style="color:#0f172a">kayıt olurken belirlediğiniz şifreyi</strong> girin.`,
    action: { label: "E-postamı doğrula", url },
    footnote: `${plainLinkFallback(url)}<br><br>Bu bağlantı <strong>24 saat</strong> geçerlidir. Bu hesabı siz oluşturmadıysanız bu e-postayı yok sayabilirsiniz: doğrulama şifre olmadan tamamlanamaz, yani sizin adresinizle açılmış bir hesap doğrulanmadan kullanılamaz.`,
  });
}
