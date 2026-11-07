import { createHmac, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Meta web kancası imzası (`X-Hub-Signature-256: sha256=<hex>`): HAM gövdenin uygulama gizli anahtarıyla HMAC-SHA256'sı. Gövde JSON'a
// çevrilip yeniden yazılmadan, gelen baytlar üzerinde doğrulanır; karşılaştırma sabit sürelidir. Eksik / bozuk başlık, boş anahtar → RET.
// ---------------------------------------------------------------------------

export function verifyMetaSignature(rawBody: string | Buffer, header: string | null | undefined, appSecret: string | undefined): boolean {
  if (!appSecret || !header) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(m[1].toLowerCase(), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
