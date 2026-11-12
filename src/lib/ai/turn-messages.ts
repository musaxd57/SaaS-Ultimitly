// ---------------------------------------------------------------------------
// ÇOK MESAJLI TUR — misafir son cevabımızdan sonra BİRDEN ÇOK mesaj yazdıysa hepsi "misafir mesajı"dır
// (11-12 ölçümü; anahtar `AI_TURN_MESSAGES_ENABLED` VARSAYILAN KAPALI — misafire gideni değiştirir: ölçüm + kurucu kararı).
//
// Ölçülen kusur (canlı hat, gpt-5.1, üç koşu): misafir 10:00'da "Otopark var mı?", 10:01'de "Bir de çıkış saati kaç?" yazıyor; ikisi de
// cevapsız. Cevap üç koşunun üçünde yalnız "Çıkış saatimiz 11:00." — otopark sorusu istek defterinde açık kalıyor (yanlış kapanma yok) ama
// cevaplanmıyor. Sebep istemin yapısı: "MİSAFİR MESAJI" bloğu yalnız SON mesajı taşır, önceki cevapsız mesaj geçmişin içinde bir satırdır;
// uzunluk ipucu soruları yalnız son mesajdan sayar → tek soruluk mesaj sanılır, "tek konu, tek mesaj" kuralı geçerli kalır.
//
// Anahtar açıkken (yalnız birden çok cevapsız misafir mesajı varsa; tek mesajda istem bayt bayt aynı):
//   · "MİSAFİR MESAJI" bloğu cevapsız mesajların HEPSİNİ yazılış sırasıyla taşır (etiket "[i/n]" koddan; metin çitli veri olarak kalır),
//   · bloğun başlığına koddan tek not: hepsi bu turun parçası — cevaplanacak istek eski mesajda yazıldı diye atlanmaz,
//   · uzunluk ipucu soruları bütün cevapsız mesajlardan sayar.
// Hangi isteğin cevaplanacağını bu not DEĞİŞTİRMEZ: istek listesi / kurallar belirler (ev sahibine bırakılan istek yine yazılmaz).
// Çok sayıda ya da çok uzun mesajda eski biçim (şüphede eski davranış). Kapılar, istek defteri ve gönderim kimliği değişmez. Saf.
// ---------------------------------------------------------------------------

/** Yalnız tam "1" açar (`STRICT_ONE_FLAGS`). */
export function turnMessagesEnabled(): boolean {
  return process.env.AI_TURN_MESSAGES_ENABLED === "1";
}

/** Bloğa alınacak en çok mesaj (sonuncusu dahil) ve önceki mesaj başına en çok karakter — aşılırsa eski biçim. */
export const TURN_MESSAGES_MAX = 6;
export const TURN_MESSAGE_MAX_CHARS = 1_500;

/**
 * Bloğa girecek ÖNCEKİ cevapsız misafir mesajları (yazılış sırasıyla, güncel mesaj hariç). Anahtar kapalıysa, önceki mesaj yoksa ya da sınır
 * aşılıyorsa boş dizi → çağıran bugünkü biçimi kurar.
 */
export function turnEarlierMessages(earlierUnanswered: readonly string[]): string[] {
  if (!turnMessagesEnabled()) return [];
  const texts = earlierUnanswered.map((t) => t.trim()).filter(Boolean);
  if (texts.length === 0 || texts.length + 1 > TURN_MESSAGES_MAX) return [];
  if (texts.some((t) => t.length > TURN_MESSAGE_MAX_CHARS)) return [];
  return texts;
}

/** Blok içeriği: her mesaj kendi satır(lar)ında, koddan "[i/n]" etiketiyle (misafir metni etiketi taklit etse de veri olarak kalır). */
export function turnMessagesBlock(texts: readonly string[]): string {
  return texts.map((t, i) => `[${i + 1}/${texts.length}] ${t}`).join("\n");
}

/** Blok başlığına eklenen KOD notu. */
export function turnMessagesNote(count: number): string {
  return (
    `\nKOD NOTU (kesin): Misafir son cevabımızdan sonra ${count} mesaj yazdı; hepsi aşağıda, yazılış sırasıyla ([1/${count}] en eski — ` +
    "geçmişin sonundaki cevapsız misafir satırlarıyla aynıdır, yeniden sorulmuş sayma). HEPSİ bu turun mesajıdır: hangi isteğin " +
    "cevaplanacağını kurallar ve istek listesi belirler; cevaplanacak bir isteği yalnız eski mesajda yazıldı diye ATLAMA."
  );
}
