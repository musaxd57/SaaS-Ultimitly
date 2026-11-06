import { createHash, createHmac, timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// QR SOHBETİ İMZALI CİHAZ GEÇİŞİ (kurucu / Codex 11-06 K-5; tasarım docs/TASARIM-2026-11-06-qr-imzali-cihaz-gecisi.md).
//
// Sorun (ölçüldü, 11-05 gece belgesi): bağlı cihazın doğrulanması bir VERİTABANI okumasıdır (`bindOrCheckStay`), o yüzden kaba IP tavanından
// SONRA yapılabiliyordu. Aynı IP'den (bina Wi-Fi'si, operatör NAT'ı) dakikada 240+ geçersiz istek kaba tavanı doldurunca o IP'deki BÜTÜN
// misafirlerin sohbeti donuyordu — doğrulanmış cihaz dahil.
//
// Çözüm YENİ BİR MEKANİZMA DEĞİL, var olan cihaz çerezinin uzantısı (Codex: "mevcut yeterliyse ikinci mekanizma yok"): `gcs_<daire>`
// çerezinin değeri `<cihaz sırrı>.<geçiş>.<imza>` olur. Cihaz sırrı ve veritabanındaki bağ (`chatBoundHash` = sırrın sha256'sı) AYNEN durur;
// geçiş, veritabanına gitmeden (yalnız HMAC) "bu istek, bu QR anahtarı için bizim bağladığımız bir cihazdan" bilgisini verir → istek kaba IP
// tavanına girmeden CİHAZIN KENDİ kovasına gider (cihaz başı sınır).
//
// Geçiş ERİŞİM VERMEZ: konaklama açık mı, cihaz bağı hâlâ bu sır mı — sonra veritabanından AYNEN denetlenir. Tutmazsa (süresi geçmemiş ama
// ev sahibi bağı sıfırladı / konaklama değişti) geçiş bir şey kazandırmamış sayılır: istek doğrulanmamış istek gibi kaba tavandan da geçer.
// Süresi dolmuş, başka QR anahtarına ait ya da imzası tutmayan geçiş hiç yokmuş gibidir. Eski biçimli çerez (yalnız sır) aynen çalışır;
// sunucu onu bağ doğrulandığı ilk yanıtta geçişli biçime yükseltir.
// ---------------------------------------------------------------------------

/** İmza alanı ayrımı: aynı `AUTH_SECRET` ile imzalanan başka belirteç (uyarı adresi, ödeme dönüşü…) burada geçmez. */
const DOMAIN = "lixus/guest-chat-pass/v1";
export const STAY_COOKIE_PREFIX = "gcs_";
/** Bir istekte en çok bu kadar `gcs_` çerezi denenir (her biri tek HMAC) — uzun çerez başlığıyla işlemci harcatılamaz. */
const MAX_COOKIES_TRIED = 6;
const MAX_PASS_LENGTH = 400;

type Payload = { r: string; t: string; s: string; x: number };

export interface DevicePass {
  reservationId: string;
  /** Cihaz sırrının özetinin ilk 16 hanesi — geçişin hangi BAĞ için verildiği. */
  secretTag: string;
  expiresAt: number;
}

function key(): string {
  return process.env.AUTH_SECRET ?? "";
}

/** Geçiş verilebilir mi (sır tanımlı değilse hiç üretilmez — imzasız geçiş yok, çerez eski biçimde kalır). */
export function devicePassAvailable(): boolean {
  return key().length > 0;
}

const tag16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
export const secretTagOf = tag16;

function mac(body: string): string {
  return createHmac("sha256", key()).update(`${DOMAIN}.${body}`).digest("base64url");
}

/** Çerez değeri → cihaz sırrı + (varsa) geçiş. Eski biçim (noktasız, yalnız sır) olduğu gibi sır döner. */
export function splitStayCookie(value: string | null): { secret: string | null; pass: string | null } {
  if (!value) return { secret: null, pass: null };
  const parts = value.split(".");
  if (parts.length === 3 && parts[0] && parts[1] && parts[2]) return { secret: parts[0], pass: `${parts[1]}.${parts[2]}` };
  return { secret: value, pass: null };
}

/** Cihaz çerezinin değeri: sır + (sır tanımlıysa) bu konaklama, bu QR anahtarı ve bu bağ için imzalı geçiş. */
export function stayCookieValue(deviceSecret: string, reservationId: string, chatToken: string, expiresAt: Date): string {
  if (!devicePassAvailable()) return deviceSecret;
  const payload: Payload = { r: reservationId, t: tag16(chatToken), s: tag16(deviceSecret), x: expiresAt.getTime() };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${deviceSecret}.${body}.${mac(body)}`;
}

/** Tek geçişi doğrular (imza, süre, QR anahtarı); geçersizse `null` — sebep söylenmez. */
export function verifyDevicePass(pass: string | null, chatToken: string, now: Date = new Date()): DevicePass | null {
  if (!pass || !devicePassAvailable() || pass.length > MAX_PASS_LENGTH) return null;
  const dot = pass.indexOf(".");
  if (dot <= 0) return null;
  const body = pass.slice(0, dot);
  const given = Buffer.from(pass.slice(dot + 1));
  const expected = Buffer.from(mac(body));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let p: Partial<Payload>;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<Payload>;
  } catch {
    return null;
  }
  if (typeof p.r !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(p.r)) return null;
  if (typeof p.t !== "string" || typeof p.s !== "string" || !/^[0-9a-f]{16}$/.test(p.s)) return null;
  if (typeof p.x !== "number" || !Number.isFinite(p.x) || p.x <= now.getTime()) return null;
  if (p.t !== tag16(chatToken)) return null;
  return { reservationId: p.r, secretTag: p.s, expiresAt: p.x };
}

/**
 * İstek çerezlerinden BU QR anahtarına ait geçerli geçişi bulur — veritabanı YOK (kaba IP tavanından önce koşar). Daire kimliği bu anda
 * bilinmediği için `gcs_*` çerezleri denenir (en çok `MAX_COOKIES_TRIED`); anahtar özeti tutan ilk geçerli geçiş döner.
 */
export function readDevicePass(cookieHeader: string | null, chatToken: string, now: Date = new Date()): DevicePass | null {
  if (!cookieHeader || !devicePassAvailable()) return null;
  let tried = 0;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1 || !part.slice(0, eq).trim().startsWith(STAY_COOKIE_PREFIX)) continue;
    if (++tried > MAX_COOKIES_TRIED) break;
    const verified = verifyDevicePass(splitStayCookie(part.slice(eq + 1).trim()).pass, chatToken, now);
    if (verified) return verified;
  }
  return null;
}

/** Veritabanı doğrulamasından SONRA: geçiş bu konaklamanın, şu an bağlı olan bu sırrın geçişi mi. */
export function devicePassConfirmed(pass: DevicePass | null, reservationId: string, deviceSecret: string | null): boolean {
  return pass !== null && deviceSecret !== null && pass.reservationId === reservationId && pass.secretTag === tag16(deviceSecret);
}

/** Cihazın kendi kovası (cihaz başı sınır): konaklama + bağ. Anahtar yalnız İMZALI değerlerden kurulur — rastgele girdi sayaç satırı açmaz. */
export function deviceLaneKey(prefix: string, reservationId: string, secretTag: string): string {
  return `${prefix}:${reservationId}:${secretTag}`;
}
