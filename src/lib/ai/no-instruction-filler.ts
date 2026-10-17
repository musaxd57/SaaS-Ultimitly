// ---------------------------------------------------------------------------
// "TALİMAT YOK" YAN CÜMLESİ MİSAFİRE YAZILMAZ (kurucu 10-17, H9 cevabı, aynen):
//   "Çıkış için özel talimatımız yok, anahtarı masaya bırakmanız yeterli. Bunun ilk cümlesini yazmasına gerek yok, zaten yeterli … 'Çıkış
//    için özel talimatımız yok' bunu yazmasın." · "Televizyonla ilgili ayrı bir talimatım bulunmuyor — böyle bir şey yazamaz kesinlikle."
//
// Kural (saf; `suggestReply` cevabın SON adımında çağırır → kanal, QR, "AI öner", Ayarlar testi, demo hepsi aynı):
//   · Cümle "talimat yok" yan cümlesi taşıyorsa (`matchesNoInstructionClause`, yedi dil) ve AYNI cümlede yönerge varsa ("…, anahtarı masaya
//     bırakmanız yeterli") yalnız o yan cümle silinir: "Anahtarı masaya bırakmanız yeterli."
//   · Yan cümle bir CİHAZDAN söz ediyorsa ("Televizyonla ilgili ayrı bir talimatım bulunmuyor, …") SİLİNMEZ: orada bir sorunun bilgisi yok
//     demektir; silmek o soruyu sessizce "cevaplandı" gösterirdi. Cümle aynen kalır ve "bilgim yok" kuralı bütün cevabı tutar.
//   · Geriye yönerge kalmıyorsa (yan cümle tek başına) ya da kalan kısım yine "bilgim yok" diyorsa cümleye dokunulmaz (tutulur).
// Misafire yeni söz EKLENMEZ; yalnız yan cümle ÇIKARILIR. Kalan metin bütün kapılardan yine geçer.
// Haiku 10-17 sınırları (hepsi pinli): yan cümle sınırı ayraç + BOŞLUK ("15:00", "1,5 TL" bölünmez); silinen yan cümle YALNIZ "talimat yok"
// + kısa konu olmalı ("…yok ve kahvaltı 08.00-10.00 arasıdır" silinmez — bilgi kaybı); cihaz denetimi BÜTÜN cümlede ("Kombi için, özel
// talimatımız yok, …" silinmez); madde işareti ("- ") korunur; "yok ve …" / "yok ama …" de yan cümle sınırıdır.
// ---------------------------------------------------------------------------

import { admitsMissingKnowledge, matchesNoInstructionClause, noInstructionClauseRest } from "./absence";
import { deviceTopicsOf, topicsWithSymptomsOf } from "@/lib/conversation-items/relation";

/** Cümle parçaları (ayraçlarıyla; birleştirince satırın kendisi). Sınır = nokta / ünlem / soru + boşluk ("15.00" bölünmez). Doğrusal. */
function sentencesOf(line: string): string[] {
  return line.split(/(?<=[.!?])(?=\s)/u).filter((s) => s.length > 0);
}

/**
 * Yan cümleler (ayraç sonda kalır): ardından BOŞLUK gelen virgül / noktalı virgül / iki nokta / Arapça virgül ("15:00", "1,5" bölünmez), ve
 * Türkçe "talimat yok" yükleminden sonra gelen "ve / ama / fakat / ancak" (bağlaç kalan yan cümlenin başında kalır, ↓atılır).
 */
function clausesOf(sentence: string): string[] {
  return sentence
    .split(
      /(?<=[,;:،])(?=\s)|(?<=(?<![\p{L}])(?:yok|yoktur|bulunmuyor|bulunmamaktadır|gerekmiyor))(?=\s+(?:ve|ama|fakat|ancak)\s)/u,
    )
    .filter((c) => c.length > 0);
}

/** Silinen yan cümlenin "talimat yok" dışında kalanı yalnız KONU mu ("çıkış için", "for checkout")? Sayı, bağlaç, uzun kalan → bilgi var. */
const REST_CONJUNCTIONS: ReadonlySet<string> = new Set([
  "ve", "veya", "ile", "ama", "fakat", "ancak", "ayrıca", "and", "or", "but", "also", "y", "o", "pero", "et", "ou", "mais", "und", "oder",
  "aber", "и", "или", "но",
]);
const MAX_TOPIC_WORDS = 6;
function topicOnly(rest: string): boolean {
  if (/\p{N}/u.test(rest)) return false;
  const words = rest.split(/[^\p{L}'-]+/u).filter((w) => /\p{L}/u.test(w));
  return words.length <= MAX_TOPIC_WORDS && !words.some((w) => REST_CONJUNCTIONS.has(w));
}

/** Silinebilir yan cümle: "talimat yok" kalıbı + geriye yalnız konu. */
function removableClause(clause: string): boolean {
  const rest = noInstructionClauseRest(clause);
  return rest !== null && topicOnly(rest);
}

/**
 * Asılı konu öbeği: yüklemsiz kısa yan cümle, konu edatıyla biter ("Kombi için", "Televizyonla ilgili") ya da başlar ("for the TV", "para la
 * tele"). Kapalı küme; en çok 4 sözcük.
 */
const DANGLING_TAIL = /(?<![\p{L}])(?:için|icin|ilgili|hakkında|konusunda|dair)$/iu;
const DANGLING_HEAD = /^(?:for|about|regarding|para|sobre|pour|concernant|für|zu|по|для|عن|بخصوص)(?![\p{L}])/iu;
function danglingTopic(clause: string): boolean {
  const core = trimTrailingSeparators(clause.trim()).replace(/[.!?]+$/u, "");
  if (core.split(/\s+/u).filter(Boolean).length > 4) return false;
  return DANGLING_TAIL.test(core) || DANGLING_HEAD.test(core);
}

/** Sondaki boşluk / ayraçlar (doğrusal; düzenli ifadedeki `[…]+$` uzun dizide karesel geri izleme yapar — Haiku 10-17). */
function trimTrailingSeparators(text: string): string {
  let end = text.length;
  while (end > 0 && /[\s,;:،]/u.test(text[end - 1]!)) end -= 1;
  return text.slice(0, end);
}

/**
 * Baştaki bağlaç ("ama anahtarı…", "so just leave…") ve noktalama atılır: silinen yan cümleye bağlanıyordu, tek başına anlamsız. Kapalı küme;
 * yalnız baştaki bir öbek.
 */
const LEADING_CONNECTIVE =
  /^[\s,;:،-]*(?:ama|fakat|ancak|lakin|ve|bu yüzden|o yüzden|dolayısıyla|but|however|and|so|therefore|aber|und|also|daher|mais|et|donc|alors|pero|y|así que|entonces|но|и|поэтому|так что|لذا|لكن)(?=[\s,])[\s,]*/iu;
/** Türkçe metin ipucu: büyük harfe çevirirken "i" → "İ" yalnız Türkçede. */
const TURKISH_LETTERS = /[çğışöüÇĞİŞÖÜ]/u;

function capitalizeFirst(text: string): string {
  const first = text.charAt(0);
  if (!first) return text;
  const upper = TURKISH_LETTERS.test(text) ? first.toLocaleUpperCase("tr") : first.toUpperCase();
  return upper + text.slice(1);
}

/** Tek cümle: silinebiliyorsa yeni hâli, değilse `null` (cümle aynen kalır). */
function stripSentence(sentence: string): string | null {
  // Baştaki boşluk ve madde işareti ("- ", "• ", "2) ") korunur (Haiku 10-17: "- " ilk yan cümleyle birlikte siliniyordu).
  const lead = sentence.match(/^\s*(?:[-*•–]\s+|\d{1,3}[.)]\s+)?/u)?.[0] ?? "";
  const body = sentence.slice(lead.length);
  const clauses = clausesOf(body);
  if (clauses.length < 2) return null;
  const flagged = clauses.map((c) => removableClause(c));
  if (!flagged.some(Boolean) || flagged.every(Boolean)) return null;
  // Cihazdan söz eden "talimat yok" bir sorunun bilgisizliğidir — silinmez. Konu ayrı yan cümleye düşmüş olabilir ("Kombi için, özel
  // talimatımız yok, …" — Haiku 10-17): silinen yan cümleye BİTİŞİK asılı konu öbeği de denetlenir. Bütün cümle denetlenmez: yönergenin
  // kendisi "anahtar"dan söz eder ("anahtarı masaya bırakın") ve kurucunun örneği silinmez olurdu.
  const topicText = clauses
    .filter((c, i) => flagged[i] || ((flagged[i - 1] || flagged[i + 1]) && danglingTopic(c)))
    .join(" ");
  if (deviceTopicsOf(topicsWithSymptomsOf(topicText)).length > 0) return null;
  const terminal = body.trimEnd().match(/[.!?]+$/u)?.[0] ?? ".";
  // Silinen yan cümle sondaysa kalan kısım ayraçla biter ("Anahtarı masaya bırakın,") → cümle sonu geri konur.
  // Silinen yan cümlenin ARDINDAKİ bağlaç da atılır ("Anahtar masada, [özel talimatımız yok] ve kahvaltı …" → "Anahtar masada, kahvaltı …").
  let rest = trimTrailingSeparators(
    clauses
      .map((c, i) => (flagged[i] ? "" : i > 0 && flagged[i - 1] ? ` ${c.replace(LEADING_CONNECTIVE, "")}` : c))
      .join("")
      .replace(LEADING_CONNECTIVE, "")
      .trim(),
  );
  if (!/[\p{L}\p{N}]/u.test(rest)) return null;
  if (!/[.!?]$/u.test(rest)) rest += terminal;
  rest = capitalizeFirst(rest);
  if (admitsMissingKnowledge(rest) || matchesNoInstructionClause(rest)) return null;
  return lead + rest;
}

/**
 * Cevaptaki silinebilir "talimat yok" yan cümlelerini çıkarır (↑kural). Değişiklik yoksa AYNI dizeyi döner. Satır yapısı korunur.
 */
export function stripNoInstructionFiller(reply: string): string {
  if (!reply || !matchesNoInstructionClause(reply)) return reply;
  return reply
    .split("\n")
    .map((line) =>
      sentencesOf(line)
        .map((s) => (matchesNoInstructionClause(s) ? (stripSentence(s) ?? s) : s))
        .join(""),
    )
    .join("\n");
}
