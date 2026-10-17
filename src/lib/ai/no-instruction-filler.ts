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
// ---------------------------------------------------------------------------

import { admitsMissingKnowledge, matchesNoInstructionClause } from "./absence";
import { deviceTopicsOf, topicsWithSymptomsOf } from "@/lib/conversation-items/relation";

/** Cümle parçaları (ayraçlarıyla; birleştirince satırın kendisi). Sınır = nokta / ünlem / soru + boşluk ("15.00" bölünmez). Doğrusal. */
function sentencesOf(line: string): string[] {
  return line.split(/(?<=[.!?])(?=\s)/u).filter((s) => s.length > 0);
}

/** Yan cümleler (ayraç sonda kalır): virgül / noktalı virgül / iki nokta / Arapça virgül. */
function clausesOf(sentence: string): string[] {
  return sentence.split(/(?<=[,;:،])/u).filter((c) => c.length > 0);
}

/**
 * Baştaki bağlaç ("ama anahtarı…", "so just leave…") ve noktalama atılır: silinen yan cümleye bağlanıyordu, tek başına anlamsız. Kapalı küme;
 * yalnız baştaki bir öbek.
 */
const LEADING_CONNECTIVE =
  /^[\s,;:،-]*(?:ama|fakat|ancak|lakin|bu yüzden|o yüzden|dolayısıyla|but|however|so|therefore|aber|also|daher|mais|donc|alors|pero|así que|entonces|но|поэтому|так что|لذا|لكن)(?=[\s,])[\s,]*/iu;
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
  const lead = sentence.match(/^\s*/u)?.[0] ?? "";
  const body = sentence.slice(lead.length);
  const clauses = clausesOf(body);
  if (clauses.length < 2) return null;
  const flagged = clauses.map((c) => matchesNoInstructionClause(c));
  if (!flagged.some(Boolean) || flagged.every(Boolean)) return null;
  const removed = clauses.filter((_, i) => flagged[i]).join(" ");
  // Cihazdan söz eden "talimat yok" bir sorunun bilgisizliğidir — silinmez (yukarıdaki kural).
  if (deviceTopicsOf(topicsWithSymptomsOf(removed)).length > 0) return null;
  const terminal = body.trimEnd().match(/[.!?]+$/u)?.[0] ?? ".";
  let rest = clauses
    .filter((_, i) => !flagged[i])
    .join("")
    .replace(LEADING_CONNECTIVE, "")
    .trim();
  // Silinen yan cümle sondaysa kalan kısım ayraçla biter ("Anahtarı masaya bırakın,") → cümle sonu geri konur.
  rest = rest.replace(/[\s,;:،]+$/u, "");
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
