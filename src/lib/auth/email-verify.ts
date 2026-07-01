import "server-only";

import { createHash, randomBytes } from "crypto";

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

/** Public base URL from the request Host header. Behind Railway/Cloudflare,
 *  req.nextUrl.origin is the INTERNAL origin (localhost:8080) — the Host header
 *  carries the real public domain, so always build absolute URLs from it. */
export function baseUrlFromHost(host: string | null): string {
  const h = host || "www.lixusai.com";
  const proto = h.startsWith("localhost") || h.startsWith("127.") ? "http" : "https";
  return `${proto}://${h}`;
}

/** Build the absolute verify URL from the request host (canonical www works too). */
export function verifyUrlFromHost(host: string | null, rawToken: string): string {
  return `${baseUrlFromHost(host)}/api/auth/verify-email?token=${rawToken}`;
}

export function verifyEmailHtml(name: string, url: string): string {
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] as string));
  return `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#111">Lixus AI — E-postanı doğrula</h2>
      <p>Merhaba ${esc(name)}, Lixus AI hesabın oluşturuldu. Girişi tamamlamak için
      e-postanı doğrula:</p>
      <p style="margin:24px 0">
        <a href="${url}" style="background:#1e293b;color:#fff;text-decoration:none;
        padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">
        E-postamı doğrula</a>
      </p>
      <p style="color:#555;font-size:13px">Buton çalışmazsa bu bağlantıyı tarayıcına yapıştır:<br>
      <span style="word-break:break-all">${url}</span></p>
      <p style="color:#555;font-size:13px">Bu bağlantı <strong>24 saat</strong> geçerlidir.
      Bu hesabı sen oluşturmadıysan bu e-postayı yok say.</p>
    </div>`;
}
