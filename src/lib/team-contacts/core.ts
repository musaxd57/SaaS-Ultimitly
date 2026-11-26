// EKİP KİŞİSİ — saf kurallar (T3; tasarım docs/TASARIM-2026-11-13-temizlikci-akisi-whatsapp-yedek.md §9 İ3 / İ5). YAPRAK modül (yalnız
// node:crypto). Veritabanı katmanı `./service.ts`.
//
//  · Ekip kişisi = giriş yapamayan personel kullanıcısı: yapay e-posta `team-<rastgele>@team.invalid` (RFC 2606 `.invalid` alan adı hiçbir
//    zaman çözülmez → e-posta yanlışlıkla gidemez) + `loginDisabled`. Kimlik / iz kuralları (görev ataması, "kim başladı") olduğu gibi çalışır.
//  · Kanal bağı kişinin KENDİ ilk WhatsApp mesajıyla kurulur: ev sahibi ekranında kişiye özel kod + `wa.me` bağlantısı; numara Meta'dan gelir
//    (yazım hatası / yanlış kişi yok), ilk mesaj izin kaydıdır. Kod öneki `EKIP-` — ev sahibi bağının `LIXUS-` kodundan AYRI, iki numara
//    aynı olsa da kod yanlış akışa düşmez.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TEAM_EMAIL_DOMAIN = "team.invalid";
export const STAFF_CODE_PREFIX = "EKIP-";
export const STAFF_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const STAFF_CODE_LEN = 6;
/** Kişi kodu ev sahibinden alıp kendi telefonundan gönderir (yüz yüze ya da mesajla) → ev sahibi bağının 15 dakikasından uzun. */
export const STAFF_CODE_TTL_MS = 72 * 60 * 60_000;
export const TEAM_CONTACT_NAME_MAX = 80;

/** Yapay e-posta. `rand` yalnız test için. */
export function teamContactEmail(rand: (n: number) => Uint8Array = randomBytes): string {
  return `team-${Buffer.from(rand(12)).toString("hex")}@${TEAM_EMAIL_DOMAIN}`;
}

/** Adres gerçekten ulaşılamaz mı (`.invalid` ve alt alan adları). Görev e-postası bu adreslere hiç denenmez. */
export function isUndeliverableEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return true;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
  return domain === "invalid" || domain.endsWith(".invalid");
}

/** Ekranda gösterilecek ad: kenar boşluğu + iç boşluk dizileri tek boşluk, görünmez / denetim karakteri yok, tavan. Boşsa null. */
export function normalizeTeamContactName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned) return null;
  return [...cleaned].slice(0, TEAM_CONTACT_NAME_MAX).join("");
}

/** Yeni kod. Modulo sapması yok: 256 = 8 × 32. */
export function newStaffCode(rand: (n: number) => Uint8Array = randomBytes): string {
  const bytes = rand(STAFF_CODE_LEN);
  let out = "";
  for (let i = 0; i < STAFF_CODE_LEN; i++) out += STAFF_CODE_ALPHABET[bytes[i]! % 32];
  return `${STAFF_CODE_PREFIX}${out}`;
}

/**
 * Gelen metinde personel kodu (`EKIP-7F3K2Q`, `ekip 7f3k2q`, `ekip7f3k2q`, önünde / ardında başka sözcük). Elle yazımda karışan harfler
 * kanonik biçime döner (O→0, I/L→1). Doğrusal: tek kalıp, sınırlı tekrar, metnin ilk 2.000 karakteri.
 */
export function extractStaffCode(text: string): string | null {
  const m = /(?<![\p{L}\p{N}])ek[iıİ]p[\s-]?([0-9a-z]{6})(?![\p{L}\p{N}])/iu.exec(text.slice(0, 2_000));
  if (!m) return null;
  const body = m[1]!.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
  if ([...body].some((c) => !STAFF_CODE_ALPHABET.includes(c))) return null;
  return `${STAFF_CODE_PREFIX}${body}`;
}

const hmacHex = (secret: string, value: string) => createHmac("sha256", secret).update(value, "utf8").digest("hex");

/** Kodun saklanan biçimi (anahtarlı; ev sahibi kodundan ayrı alan adı). */
export function staffCodeHash(code: string, secret: string): string {
  return hmacHex(secret, `staff-code:${code}`);
}

export function hashesEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** `wa.me` bağlantısı: numara yalnız rakam, metin kodun kendisi. Numara geçersizse null (ekran yalnız kodu gösterir). */
export function staffWaMeLink(teamNumberRaw: string | undefined, code: string): string | null {
  const digits = (teamNumberRaw ?? "").replace(/[\s()+-]/g, "");
  if (!/^\d{8,15}$/.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(code)}`;
}

export type StaffCodeVerdict = "ok" | "not_pending" | "expired";

/** Bulunan bekleyen satıra gelen kodun hükmü (satır özetle bulundu; burada yalnız durum + süre). */
export function judgeStaffCode(state: { status: string; codeHash: string | null; codeExpiresAt: Date | null }, now: Date): StaffCodeVerdict {
  if (state.status !== "pending" || !state.codeHash || !state.codeExpiresAt) return "not_pending";
  if (state.codeExpiresAt.getTime() <= now.getTime()) return "expired";
  return "ok";
}
