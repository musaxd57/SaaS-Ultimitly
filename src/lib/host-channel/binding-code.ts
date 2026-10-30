import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// NUMARA BAĞLAMA — saf parçalar (tasarım `docs/TASARIM-2026-10-30-whatsapp-ev-sahibi-dongusu.md` §5.4). Akış: Ayarlar → numara + rıza → ekranda
// tek kullanımlık kod `LIXUS-7F3K2Q` → ev sahibi kodu KENDİ WhatsApp'ından bizim numaramıza yazar → kanca gönderen numarayı ve kodu eşler →
// bağlantı etkin. Ev sahibi başlattığı için serbest metin penceresi açılır (ücretsiz) ve numaraya sahip olduğu kanıtlanır.
//
// Sağlayıcı bilmez (V0). DB yok, ağ yok. Gizli anahtar (`HOST_CHANNEL_HMAC_SECRET`) çağırandan gelir:
//  · Numara arama anahtarı = HMAC(sağlayıcı + E.164) — düz numara saklanmaz, gelen mesaj bu anahtarla bulunur.
//  · Kod saklanmaz, HMAC'i saklanır; karşılaştırma sabit zamanlı. 6 karakter × 32 simge ≈ 1,07·10⁹ olasılık, 5 deneme, 15 dakika — anahtarsız
//    çevrimdışı deneme yapılamaz (bcrypt yerine anahtarlı HMAC: kanca yolu bcrypt eşzamanlılık kapısına girmez, koruma anahtardadır).
// ---------------------------------------------------------------------------

/** Karışan harfler (I, L, O, U) yok — telefonda elle yazılırsa da okunur (Crockford). */
export const BINDING_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const BINDING_CODE_PREFIX = "LIXUS-";
export const BINDING_CODE_LEN = 6;
export const BINDING_CODE_TTL_MS = 15 * 60_000;
export const BINDING_CODE_MAX_ATTEMPTS = 5;

/** Yeni kod. `rand` yalnız test için (aynı uzunlukta bayt). Modulo sapması yok: 256 = 8 × 32. */
export function newBindingCode(rand: (n: number) => Uint8Array = randomBytes): string {
  const bytes = rand(BINDING_CODE_LEN);
  let out = "";
  for (let i = 0; i < BINDING_CODE_LEN; i++) out += BINDING_CODE_ALPHABET[bytes[i]! % 32];
  return `${BINDING_CODE_PREFIX}${out}`;
}

/**
 * Gelen metinde bağlama kodu. Ev sahibi kodu `wa.me` bağlantısıyla aynen ya da elle yazabilir: büyük / küçük harf, tire yerine boşluk ya da
 * hiçbir şey, kodun önünde / ardında başka sözcük ("merhaba LIXUS-7F3K2Q"). Elle yazımda karışan harfler kanonik biçime döner (O→0, I/L→1).
 * Doğrusal: tek çapalı kalıp, sınırlı tekrar. Kod yoksa `null`.
 */
export function extractBindingCode(text: string): string | null {
  const m = /(?<![\p{L}\p{N}])lixus[\s-]?([0-9a-z]{6})(?![\p{L}\p{N}])/iu.exec(text.slice(0, 2_000));
  if (!m) return null;
  const body = m[1]!
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if ([...body].some((c) => !BINDING_CODE_ALPHABET.includes(c))) return null;
  return `${BINDING_CODE_PREFIX}${body}`;
}

const hmacHex = (secret: string, value: string) => createHmac("sha256", secret).update(value, "utf8").digest("hex");

/** Kodun saklanan biçimi (anahtarlı). */
export function bindingCodeHash(code: string, secret: string): string {
  return hmacHex(secret, `code:${code}`);
}

/** Sabit zamanlı eşitlik (aynı uzunlukta onaltılık dizeler; uzunluk farkı = eşit değil). */
export function hashesEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Numara arama anahtarı: sağlayıcı + yalnız rakam E.164 (artı işaretsiz). */
export function addressHash(provider: string, e164Digits: string, secret: string): string {
  return hmacHex(secret, `addr:${provider}:${e164Digits}`);
}

/**
 * Ev sahibinin yazdığı numara → yalnız rakam uluslararası biçim (8–15 hane, artısız). "+90 532 123 45 67", "0090…" ve "(0532) …" kabul edilir;
 * ülke kodu olmayan yerel biçim ("0532…") kabul EDİLMEZ (hangi ülke olduğu tahmin edilmez). Geçersizse `null`.
 */
export function normalizeE164Digits(raw: string): string | null {
  let t = raw.trim().replace(/[\s().-]/g, "");
  if (t.startsWith("+")) t = t.slice(1);
  else if (t.startsWith("00")) t = t.slice(2);
  else return null;
  return /^[1-9]\d{7,14}$/.test(t) ? t : null;
}

/** Ekranda maskeli gösterim: ülke kodu + son iki hane ("+90 ••• ••• •• 67"). Ev sahibi kendi numarasını tanır, başkası öğrenemez. */
export function maskE164(e164Digits: string): string {
  const d = e164Digits.replace(/\D/g, "");
  if (d.length < 8) return "••••";
  const cc = d.length > 10 ? d.slice(0, d.length - 10) : d.slice(0, 2);
  return `+${cc} ••• ••• •• ${d.slice(-2)}`;
}

export interface BindingState {
  status: string;
  verifyCodeHash: string | null;
  verifyExpiresAt: Date | null;
  verifyAttempts: number;
}

export type BindingCodeVerdict = "ok" | "not_pending" | "expired" | "too_many_attempts" | "mismatch";

/**
 * Bekleyen bağlantıya gelen kodun hükmü. Saf. Sıra önemli: süresi dolmuş / deneme hakkı bitmiş bağlantıda doğru kod da KABUL EDİLMEZ (yeni kod
 * istenir). Çağıran `mismatch`te deneme sayacını ARTIRIR (CAS ile), `ok`ta bağlantıyı etkinleştirir ve kodu siler.
 */
export function judgeBindingCode(state: BindingState, code: string, secret: string, now: Date): BindingCodeVerdict {
  if (state.status !== "pending" || !state.verifyCodeHash || !state.verifyExpiresAt) return "not_pending";
  if (state.verifyExpiresAt.getTime() <= now.getTime()) return "expired";
  if (state.verifyAttempts >= BINDING_CODE_MAX_ATTEMPTS) return "too_many_attempts";
  return hashesEqual(bindingCodeHash(code, secret), state.verifyCodeHash) ? "ok" : "mismatch";
}

/**
 * Etkin bağlantı soru almaya uygun mu: durum `active` ve kullanıcının oturum kuşağı doğrulama anındakiyle aynı (şifre değişimi / sıfırlama
 * kuşağı artırır → bağlantı askıya düşer, yeniden doğrulama gerekir; tasarım §5.5).
 */
export function bindingUsable(binding: { status: string; userSessionEpoch: number }, currentUserEpoch: number): boolean {
  return binding.status === "active" && binding.userSessionEpoch === currentUserEpoch;
}
