/**
 * Misafire görünen daire adı (U4, kurucu 10-22: "Ayrı 'misafire görünen ad'"). QR sohbet ekranının başlığı
 * "<ad> · Misafir Asistanı" olur. İç ad (`Property.name` — "Daire 5 / arka cephe" gibi ev sahibinin kendi etiketi) bu herkese açık
 * sayfaya ASLA çıkmaz; ev sahibi bu alanı doldurmazsa başlık bugünkü gibi yalnız marka.
 *
 * YAPRAK modül (hiçbir şey import etmez): hem doğrulayıcı / rota (yazarken) hem QR çözümleyici (okurken) aynı kuralı kullanır.
 * Saf, doğrusal (karesel iş yok).
 */
export const GUEST_DISPLAY_NAME_MAX = 60;

/**
 * Temizlenmiş biçim (TAVANSIZ): NFC, satır sonu / denetim karakteri → boşluk, görünmez karakter silinir (emoji birleştiricisi ZWJ ve
 * emoji biçim seçicisi korunur — "👨‍👩‍👧" bölünmesin), ardışık boşluk teke iner, kırpılır.
 */
function cleanGuestDisplayName(input: string): string {
  return input
    .normalize("NFC")
    .replace(/[\p{Cc}\u2028\u2029]/gu, " ")
    .replace(/(?![\u200d\ufe0f])[\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Doğrulama: temizlendikten sonra `GUEST_DISPLAY_NAME_MAX` KARAKTERİ (kod noktası) aşıyor mu. Form / rota bunu kullanır — ham uzunluk
 * (UTF-16 birimi) değil: emoji iki birim sayılıp kısa ad reddedilmesin, görünmez karakterle şişirilmiş kısa ad da reddedilmesin (Haiku 10-22).
 */
export function guestDisplayNameTooLong(input: string): boolean {
  return Array.from(cleanGuestDisplayName(input)).length > GUEST_DISPLAY_NAME_MAX;
}

/**
 * Kaydedilecek / gösterilecek biçim: temizlenmiş, en fazla `GUEST_DISPLAY_NAME_MAX` karakter. Boş → null (alan temizlenir, başlık yalnız
 * marka). Okurken de aynı kural (elle yazılmış değer başlığa taşmasın).
 */
export function normalizeGuestDisplayName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const capped = Array.from(cleanGuestDisplayName(input)).slice(0, GUEST_DISPLAY_NAME_MAX).join("").trimEnd();
  return capped.length > 0 ? capped : null;
}
