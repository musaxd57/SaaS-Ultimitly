// ---------------------------------------------------------------------------
// ③ PAROLA BİÇİMİ VE YENİ PAROLA POLİTİKASI — saf, bcrypt'siz (kurucu onayı 09-23).
//
// Ayrı modül çünkü `validators.ts` (her rotanın içe aktardığı şema dosyası) bu kuralı
// kullanıyor ve bcrypt'i oraya taşımanın sebebi yok. `auth/password.ts` hem
// normalizasyonu hem politikayı buradan alır → kural TEK yerde.
//
// NFC: aynı görünen parola iki bayt dizisiyle gelebilir ("ş" tek karakter = NFC;
// "s" + birleşen çengel = NFD). Saklama ve karşılaştırma NFC biçiminden yapılır
// (RFC 8265 OpaqueString). NFKC DEĞİL: uyumluluk katlaması farklı parolaları birleştirir.
//
// 72 BAYT: bcrypt girdinin yalnız ilk 72 baytını kullanır, fazlası SESSİZCE yok sayılır
// (test-pinli). YENİ parola bu sınırı aşamaz; giriş yolu bu kontrolü YAPMAZ (mevcut uzun
// parolalar girmeye devam eder).
// ---------------------------------------------------------------------------

/** Parolanın saklanan/karşılaştırılan biçimi. */
export function normalizePassword(password: string): string {
  return password.normalize("NFC");
}

/** bcrypt'in fiilen kullandığı üst sınır (bayt, UTF-8). */
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_MIN_LENGTH = 8;
/**
 * 🚨 MÜŞTERİYE GİDEN METİN SADE (kurucu 09-23): "bayt", "ş 2 bayt sayılır" gibi teknik
 * açıklama müşteriye GİTMEZ. Sınır aynen uygulanır (OWASP Password Storage: bcrypt için en
 * fazla 72 bayt; Go `ErrPasswordTooLong`, Spring `BCryptPasswordEncoder` de fazlasını
 * reddeder) ama kullanıcıya yalnız ne yapması gerektiği söylenir. Karakter sayısı
 * YAZILMAZ: Türkçe harf 2 bayt olduğundan "en fazla N karakter" sözü yanlış olurdu.
 * Pinli: metin teknik terim içermez (`password-normalization.test.ts`).
 */
export const PASSWORD_TOO_LONG_MESSAGE = "Şifre çok uzun. Lütfen daha kısa bir şifre oluşturun.";

/** Ölçü SAKLANACAK biçimdir (NFC): NFD yazımın fazladan baytı parolayı reddettirmez. */
export function passwordExceedsByteLimit(password: string): boolean {
  return new TextEncoder().encode(normalizePassword(password)).length > PASSWORD_MAX_BYTES;
}

/**
 * YENİ parola için tek politika kaynağı (kayıt, değiştirme, sıfırlama, operatörün
 * müşteri açması). Sorun yoksa `null`, varsa kullanıcıya gösterilecek Türkçe metin.
 * Üst sınır `loginSchema`nın 200 karakterinden SIKI → burada belirlenen her parola
 * girişte yazılabilir (eskiden sıfırlama yolu 200+ karakterlik parola belirleyip
 * sahibini kilitleyebiliyordu).
 */
export function newPasswordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Şifre en az ${PASSWORD_MIN_LENGTH} karakter olmalı.`;
  if (passwordExceedsByteLimit(password)) return PASSWORD_TOO_LONG_MESSAGE;
  return null;
}
