import { createHmac, randomBytes, timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// TOTP (RFC 6238) + HOTP (RFC 4226) — the standard used by Google Authenticator,
// Authy, 1Password, etc. Dependency-free (Node crypto only). The shared secret
// is a base32 string; the authenticator and the server both derive the same
// 6-digit code from it every 30 seconds.
// ---------------------------------------------------------------------------

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // RFC 4648 base32
const PERIOD = 30; // seconds per code
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** One HOTP code for a given counter (RFC 4226 dynamic truncation). */
export function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(buf).digest();
  const offset = h[h.length - 1] & 0x0f;
  const bin =
    ((h[offset] & 0x7f) << 24) |
    ((h[offset + 1] & 0xff) << 16) |
    ((h[offset + 2] & 0xff) << 8) |
    (h[offset + 3] & 0xff);
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/** The current TOTP code for a base32 secret. */
export function totp(secretB32: string, atMs: number = Date.now()): string {
  return hotp(base32Decode(secretB32), Math.floor(atMs / 1000 / PERIOD));
}

/**
 * Verify a user-entered code against the secret, tolerating ±`window` time
 * steps (clock skew / a code typed just after it rolled). Default ±1 = ~90s.
 */
export function verifyTotp(secretB32: string, token: string, window = 1, atMs: number = Date.now()): boolean {
  return verifyTotpStep(secretB32, token, window, atMs) !== null;
}

/**
 * Like {@link verifyTotp} but returns the matched time-step (counter) so the
 * caller can record it and reject reuse of the same code (replay protection).
 * Returns null when the code is invalid.
 */
export function verifyTotpStep(
  secretB32: string,
  token: string,
  window = 1,
  atMs: number = Date.now(),
): number | null {
  const clean = token.replace(/\D/g, "");
  if (clean.length !== DIGITS) return null;
  const secret = base32Decode(secretB32);
  const counter = Math.floor(atMs / 1000 / PERIOD);
  // Both operands are always exactly DIGITS chars (clean is length-checked above;
  // hotp() pads to DIGITS), so a constant-time compare is safe and removes even a
  // theoretical timing oracle on the code digits.
  const cleanBuf = Buffer.from(clean, "utf8");
  for (let i = -window; i <= window; i++) {
    const candidate = Buffer.from(hotp(secret, counter + i), "utf8");
    if (candidate.length === cleanBuf.length && timingSafeEqual(candidate, cleanBuf)) {
      return counter + i;
    }
  }
  return null;
}

/** A fresh random base32 secret (160 bits) for a new enrollment. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** otpauth:// URI an authenticator app imports (via QR or manual key entry). */
export function otpauthUri(secretB32: string, account: string, issuer = "Lixus AI"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
