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
//
// 🚨 ÖN ŞART — YALNIZ CEVAP PARÇALARI KİPİNDE (ölçüldü 11-12, iki koşu; Opus P1-4): parça kipi kapalıyken anahtar önceki mesajdaki
// BİLİNMEYEN soruyu da cevaplatıyor ve model uyduruyor ("Yes, there is an iron in the apartment." — bilgi tabanında ütü yok; 15 senaryoda 2
// yanlış gönderim, anahtar kapalıyken 0). Bugün o soru görmezden gelindiği için tesadüfen gitmiyor. Parça kipinde her cevap parçası bilgi
// tabanından birebir alıntıyla doğrulandığı için aynı sette 0 yanlış (21/23 doğru cevap). Bu yüzden kemer KODDA: tur parça kipinde değilse
// (istek defteri yok ya da parça kipi kapalı) blok eski biçimde kalır.
//
// Şüphede eski biçim: çok sayıda / çok uzun mesaj · mesajlardan birinin yazıldığı an bilinmiyor ya da son mesajla AYNI takvim gününde değil
// (bloğun başlığındaki "yazıldığı an … göreli günler bu güne göredir" notu yalnız son mesajın anıdır — dünkü "yarın" bugüne göre okunmasın;
// Opus P2-7). Kapılar, istek defteri ve gönderim kimliği değişmez. Saf.
// ---------------------------------------------------------------------------

/** Yalnız tam "1" açar (`STRICT_ONE_FLAGS`). */
export function turnMessagesEnabled(): boolean {
  return process.env.AI_TURN_MESSAGES_ENABLED === "1";
}

/** Bloğa alınacak en çok mesaj (sonuncusu dahil) ve önceki mesaj başına en çok karakter — aşılırsa eski biçim. */
export const TURN_MESSAGES_MAX = 6;
export const TURN_MESSAGE_MAX_CHARS = 1_500;

export interface TurnMessage {
  text: string;
  /** Mesajın yazıldığı an (bilinmiyorsa null). */
  at: Date | null;
}

const dayKey = (at: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

/**
 * Bloğa girecek ÖNCEKİ cevapsız misafir mesajları (yazılış sırasıyla, güncel mesaj hariç). Anahtar kapalıysa, tur parça kipinde değilse,
 * önceki mesaj yoksa ya da bir sınır / gün şartı sağlanmıyorsa boş dizi → çağıran bugünkü biçimi kurar.
 */
export function turnEarlierMessages(input: {
  earlier: readonly TurnMessage[];
  /** Güncel (son) mesajın yazıldığı an. */
  latestAt: Date | null;
  /** Bu tur cevap parçaları kipinde mi (istek defteri + parça kipi). */
  parts: boolean;
  timeZone: string;
}): string[] {
  if (!turnMessagesEnabled() || !input.parts) return [];
  const rows = input.earlier.map((m) => ({ text: m.text.trim(), at: m.at })).filter((m) => m.text);
  if (rows.length === 0 || rows.length + 1 > TURN_MESSAGES_MAX) return [];
  if (rows.some((m) => m.text.length > TURN_MESSAGE_MAX_CHARS)) return [];
  // Gün şartı: bütün mesajların anı bilinmeli ve son mesajla aynı takvim gününde olmalı (hiçbirinin anı bilinmiyorsa — an taşımayan yol —
  // başlıkta "yazıldığı an" notu da yoktur; o durumda şart aranmaz).
  const known = rows.filter((m) => m.at !== null).length + (input.latestAt ? 1 : 0);
  if (known > 0) {
    if (!input.latestAt || rows.some((m) => m.at === null)) return [];
    const day = dayKey(input.latestAt, input.timeZone);
    if (rows.some((m) => dayKey(m.at as Date, input.timeZone) !== day)) return [];
  }
  return rows.map((m) => m.text);
}

/** Mesaj içi satır sonlarının görünür işareti: her mesaj TEK satır — misafir kendi mesajında yeni satıra sahte "[2/2]" etiketi kuramaz. */
const TURN_LINE_BREAK = " ⏎ ";

/** Blok içeriği: her mesaj tek satırda, koddan "[i/n]" etiketiyle (misafir metni etiketi taklit etse de satır başına geçemez, veri olarak kalır). */
export function turnMessagesBlock(texts: readonly string[]): string {
  return texts.map((t, i) => `[${i + 1}/${texts.length}] ${t.replace(/\r\n|[\n\v\f\r\u0085\u2028\u2029]/g, TURN_LINE_BREAK)}`).join("\n");
}

/** Blok başlığına eklenen KOD notu. */
export function turnMessagesNote(count: number): string {
  return (
    `\nKOD NOTU (kesin): Misafir son cevabımızdan sonra ${count} mesaj yazdı; hepsi aşağıda, yazılış sırasıyla ([1/${count}] en eski — ` +
    "geçmişin sonundaki cevapsız misafir satırlarıyla aynıdır, yeniden sorulmuş sayma). HEPSİ bu turun mesajıdır: hangi isteğin " +
    "cevaplanacağını kurallar ve istek listesi belirler; cevaplanacak bir isteği yalnız eski mesajda yazıldı diye ATLAMA."
  );
}
