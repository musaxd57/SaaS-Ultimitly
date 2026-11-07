// ---------------------------------------------------------------------------
// K10-t — UZUN MİSAFİR MESAJINA YAPAY ZEKÂ CEVAP ÜRETMEZ (kurucu kararı 09-28).
//
// Tek bir kanal mesajı 8.000 karakteri aşarsa: yapay zekâ otomatik cevap üretmez, "AI öner" modele gitmez, metin KIRPILIP
// modele VERİLMEZ; mesaj tam hâliyle saklanır ve ev sahibine görünür bir "elle yanıtla" uyarısı düşer. Kontrol pahalı model /
// kalıp işlemlerinden ÖNCE koşar (ReDoS denetimi 09-28: kanal mesajında uzunluk tavanı yoktu). Acil sözcükler uyarı yolunda
// hafif bir kontrolle YİNE aranır (kurucu: "acil sözcük aransın") — acil e-postası çalışır. QR mesajı zaten 2.000 ile sınırlı.
// Gerçek misafir mesajı pratikte bu uzunluğa ulaşmaz; kural kötü niyetli / hatalı mesaja karşı emniyet kilididir.
// YAPRAK modül: hiçbir şey içe aktarmaz (oto-yanıt, uyarı, mülk hafızası, "AI öner" ve sayfa aynı sınırı kullanır).
// ---------------------------------------------------------------------------

import { isAnsweringOutbound } from "@/lib/message-author";

/** Yapay zekânın işleyeceği tek misafir mesajının en fazla KOD NOKTASI sayısı. */
export const GUEST_MESSAGE_AI_MAX_CHARS = 8000;

/** Oto-yanıt atlama sebebi (konuşmaya yazılır, gelen kutusu etiketi bunu okur). */
export const MESSAGE_TOO_LONG_REASON = "message_too_long";

/** "AI öner" bu mesajda modele gitmez; panelde bu açıklama görünür. */
export const MESSAGE_TOO_LONG_SUGGEST_TEXT =
  "Misafirin mesajlarından biri 8.000 karakterden uzun. Yapay zekâ bu uzunluktaki bir mesaja cevap önermiyor; lütfen mesajı okuyup kendiniz yanıtlayın.";

/**
 * Metin sınırı aşıyor mu — KOD NOKTASI sayısıyla (emoji tek karakter). Erken çıkışlı ve doğrusal: sınırın altındaki uzunlukta
 * hiç sayılmaz (UTF-16 birimi sayısı kod noktası sayısından küçük olamaz).
 */
export function exceedsGuestMessageLimit(body: string | null | undefined): boolean {
  if (typeof body !== "string" || body.length <= GUEST_MESSAGE_AI_MAX_CHARS) return false;
  let count = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body.charCodeAt(i);
    // Yüksek + düşük vekil çifti tek kod noktasıdır (`for…of` ile aynı sayım; tek başına vekil de bir sayılır).
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < body.length) {
      const d = body.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i += 1;
    }
    count += 1;
    if (count > GUEST_MESSAGE_AI_MAX_CHARS) return true;
  }
  return false;
}

/**
 * Cevapsız misafir mesajlarından (son GİDEN mesajdan sonraki gelen mesajlar — modelin göreceği küme) biri sınırı aşıyor mu.
 * `messages` kronolojik (eskiden yeniye).
 */
export function unansweredExceedsGuestMessageLimit(
  messages: readonly { direction: string; body: string | null; authorType?: string | null }[],
): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    // Otomatik şablon mesajı (K7) cevap değildir: arkasındaki uzun misafir mesajı hâlâ cevapsızdır.
    if (isAnsweringOutbound(m)) return false;
    if (m.direction === "inbound" && exceedsGuestMessageLimit(m.body)) return true;
  }
  return false;
}

/**
 * "AI öner" bu konuşmada uzunluk kuralına takılır mı — rota ve konuşma sayfası AYNI kural: cevapsız misafir mesajlarından biri ya da
 * önerinin cevap vereceği SON GELEN mesaj sınırı aşıyor. Son gelen mesajın arkasında giden bir mesaj (ör. otomatik giriş mesajı) olsa da
 * "AI öner" onu cevaplar; sayfa uyarıyı gizliyordu (09-28 CPU denetimi — rota 422 dönüyor, ev sahibi uyarıyı görmüyordu).
 */
export function aiSuggestExceedsLength(
  messages: readonly { direction: string; body: string | null; authorType?: string | null }[],
): boolean {
  if (unansweredExceedsGuestMessageLimit(messages)) return true;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].direction === "inbound") return exceedsGuestMessageLimit(messages[i].body);
  }
  return false;
}
