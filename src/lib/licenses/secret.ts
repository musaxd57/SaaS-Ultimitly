// ---------------------------------------------------------------------------
// ANAHTAR + ÖZET (Faz 1a). Özellik iki şartla açılır: `BUSINESS_LICENSES_ENABLED=1` VE ayrı bir `LICENSE_HMAC_SECRET` (en az 32 karakter).
// Sır yoksa özellik KAPALI — eksik sırla zayıf özet üretilmez (HOST_CHANNEL_HMAC_SECRET emsali). Bu sır `ENCRYPTION_KEY || AUTH_SECRET`
// sırasına BIRAKILMAZ (Opus P2-14): o anahtarlar döndürülürse bütün eşsizlik araması sessizce kırılırdı. Sır HİÇ döndürülmez.
// ---------------------------------------------------------------------------

import { createHmac } from "node:crypto";

export function licenseSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.LICENSE_HMAC_SECRET?.trim();
  return s && s.length >= 32 ? s : null;
}

/** Özellik açık mı: anahtar "1" ve sır geçerli. */
export function licensesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.BUSINESS_LICENSES_ENABLED === "1" && licenseSecret(env) !== null;
}

/** Vergi numarasının anahtarlı özeti (tür katılmaz: aynı numara şirket ya da şahıs yazılsa da aynı hak sahibidir). */
export function taxIdHash(secret: string, digits: string): string {
  return createHmac("sha256", secret).update(`license-holder:v1:${digits}`, "utf8").digest("hex");
}

/** Şifreli VKN'nin bağlamı: işletme + özet (satır kimliği yazmadan önce bilinmez). */
export const taxIdAad = (organizationId: string, hash: string) => `license-holder-taxid:v1:${organizationId}:${hash}`;
