// ---------------------------------------------------------------------------
// "TALİMAT YOK" YAN CÜMLESİ MİSAFİRE YAZILMAZ (kurucu 10-17, H9 cevabı, aynen):
//   "Çıkış için özel talimatımız yok, anahtarı masaya bırakmanız yeterli. Bunun ilk cümlesini yazmasına gerek yok, zaten yeterli … 'Çıkış
//    için özel talimatımız yok' bunu yazmasın." · "Televizyonla ilgili ayrı bir talimatım bulunmuyor — böyle bir şey yazamaz kesinlikle."
//
// Kural (saf; `suggestReply` cevabın SON adımında çağırır → kanal, QR, "AI öner", Ayarlar testi, demo hepsi aynı):
//   · Cümle "talimat yok" yan cümlesi taşıyorsa (`matchesNoInstructionClause`, yedi dil) ve AYNI cümlede yönerge varsa ("…, anahtarı masaya
//     bırakmanız yeterli") yalnız o yan cümle silinir: "Anahtarı masaya bırakmanız yeterli."
//   · Cümlenin TAMAMI "talimat yok" ise ve cevabın geri kalanı yönerge taşıyorsa ("Çıkış için özel talimatımız yok. Anahtarı masaya
//     bırakmanız yeterli.") o cümle düşer (Opus 10-17 B3: noktalı hâli bütün cevabı tutuyordu).
//   · "Talimat yok" ifadesi, ardından gelen adımın bilgi tabanından GELMEDİĞİNİN kanıtıdır (Opus 10-17 B1: "Özel bir talimatımız yok, kombiyi
//     sıfırlamak için reset tuşuna basın" silinince uydurma cihaz adımı kanıtsız gidiyordu). Bu yüzden silme İZİN LİSTESİYLE yapılır:
//       – silinen kısım bir CİHAZDAN söz etmez ve göndergesel değildir ("bu konuda", "for that" — konu gizli; B1);
//       – kalan metin anahtar DIŞINDA cihazdan söz etmez (yönerge bir cihaz adımıysa kanıtı silinmez);
//       – ya silinen kısmın ya kalan metnin bilinen bir KONUSU vardır (çıkış, giriş, çöp, otopark… — bilinmeyen konu = silme yok; B2:
//         "Jakuzi için özel talimatımız yok, keyfini çıkarın" tutulur);
//       – kalan metin yalnız selam / nezaket kabuğu değildir (B5: "Merhaba Ayşe Hanım, çıkış için özel talimatımız yok." → "Merhaba Ayşe
//         Hanım." olmaz — tutulur);
//       – kalan metin yine "bilgim yok" demez.
//     Şartlardan biri tutmazsa metne dokunulmaz → "bilgim yok" kuralı bütün cevabı tutar (misafire gitmez, ev sahibi yanıtlar).
// Misafire yeni söz EKLENMEZ; yalnız yan cümle / cümle ÇIKARILIR. Kalan metin bütün kapılardan yine geçer.
// Haiku 10-17 sınırları (pinli): yan cümle sınırı ayraç + BOŞLUK ("15:00", "1,5 TL" bölünmez); silinen yan cümle YALNIZ "talimat yok" + kısa
// konu olmalı ("…yok ve kahvaltı 08.00-10.00 arasıdır" silinmez — bilgi kaybı); madde işareti ("- ") korunur; "yok ve …" / "yok ama …" de
// yan cümle sınırıdır. Bütün taramalar doğrusal (cevap 4.000 karakterle sınırlı; süre pini `absence-cost.test.ts`).
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
 * Mutasyon notu (10-17): "boşluk şartı" kaldırılınca hiçbir test kırmızıya dönmüyor — EŞDEĞER: sayı içinde bölünen parça ("15:" + "00")
 * yeniden birleşir ve sayı taşıyan kalan zaten silinemez (`topicOnly`). Şart, "15:00" / "1,5" içinde bölmeyi kaynağında önlemek için durur.
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

/** Sondaki boşluk / ayraçlar (doğrusal; düzenli ifadedeki `[…]+$` uzun dizide karesel geri izleme yapar — Haiku 10-17). */
function trimTrailingSeparators(text: string): string {
  let end = text.length;
  while (end > 0 && /[\s,;:،]/u.test(text[end - 1]!)) end -= 1;
  return text.slice(0, end);
}

/** Sondaki cümle sonu noktalaması (doğrusal; `/[.!?]+$/` uzun ünlem dizisinde karesel — Opus 10-17 B7). Yoksa "". */
function trailingTerminal(text: string): string {
  let end = text.length;
  while (end > 0 && /\s/u.test(text[end - 1]!)) end -= 1;
  let start = end;
  while (start > 0 && /[.!?]/u.test(text[start - 1]!)) start -= 1;
  return text.slice(start, end);
}

/**
 * Asılı konu öbeği: yüklemsiz kısa yan cümle, konu edatıyla biter ("Kombi için", "Televizyonla ilgili") ya da başlar ("for the TV", "para la
 * tele"). Kapalı küme; en çok 4 sözcük.
 */
const DANGLING_TAIL = /(?<![\p{L}])(?:için|icin|ilgili|hakkında|konusunda|dair)$/iu;
const DANGLING_HEAD = /^(?:for|about|regarding|para|sobre|pour|concernant|für|zu|по|для|عن|بخصوص)(?![\p{L}])/iu;
function danglingTopic(clause: string): boolean {
  const core = trimTrailingSeparators(clause.trim());
  const bare = core.slice(0, core.length - trailingTerminal(core).length);
  if (bare.split(/\s+/u).filter(Boolean).length > 4) return false;
  return DANGLING_TAIL.test(bare) || DANGLING_HEAD.test(bare);
}

/**
 * Göndergesel konu ("bu konuda", "bununla ilgili", "for that", "à ce sujet"…): konu metinde YOK, önceki cümleye / misafirin sorusuna işaret
 * eder → hangi cihaz olduğu bilinemez, silinmez (Opus 10-17 B1: "Bu konuda özel bir talimatımız yok, sigortayı kapatıp açabilirsiniz").
 */
const REFERENTIAL =
  /(?<![\p{L}])(?:bu|şu|o) (?:konuda|konuyla|konu hakkında)|(?<![\p{L}])bununla|(?<![\p{L}])bunun için|(?<![\p{L}])(?:for|on|about|regarding) (?:that|this|it)(?![\p{L}])|(?<![\p{L}])(?:à ce sujet|pour cela|dazu|hierzu|dafür|al respecto|para eso|para esto|по этому поводу|для этого|بهذا الشأن|لذلك)(?![\p{L}])/iu;

/** Kalan metinde izin verilen tek "cihaz" konusu: anahtar (çıkış / giriş yönergesinin doğal parçası — "anahtarı masaya bırakın"). */
const ALLOWED_DEVICE_IN_REST: ReadonlySet<string> = new Set(["keys"]);

/** Selam / nezaket sözcükleri (kapalı küme, küçük harf) — kalan metin yalnız bunlardan + en çok bir addan oluşuyorsa "kabuk"tur. */
const COURTESY_WORDS: ReadonlySet<string> = new Set([
  "merhaba", "selam", "sayın", "hanım", "bey", "iyi", "günler", "akşamlar", "yolculuklar", "dileriz", "dilerim", "teşekkürler", "teşekkür",
  "ederiz", "ederim", "hoş", "geldiniz", "hello", "hi", "hey", "dear", "thanks", "thank", "you", "have", "a", "nice", "safe", "trip", "day",
  "stay", "great", "hola", "buen", "viaje", "gracias", "bonjour", "bon", "voyage", "merci", "hallo", "gute", "reise", "danke", "привет",
  "здравствуйте", "спасибо", "хорошей", "поездки", "مرحبا", "شكرا",
]);
function courtesyShell(text: string): boolean {
  const words = text
    .toLocaleLowerCase("tr")
    .split(/[^\p{L}'-]+/u)
    .filter((w) => /\p{L}/u.test(w));
  const content = words.filter((w) => !COURTESY_WORDS.has(w));
  // İçerik sözcüğü yoksa kabuktur; bir selam sözcüğü + en çok bir "ad" ("Merhaba Ayşe", "Hello Alex") da kabuktur.
  return content.length === 0 || (content.length <= 1 && words.length > content.length);
}

function topicsOf(text: string): { all: string[]; devices: string[] } {
  const all = topicsWithSymptomsOf(text);
  return { all, devices: deviceTopicsOf(all) };
}

/** Silme izin listesi (↑kural). `removed`: çıkarılacak metin (+ bitişik asılı konu); `kept`: geriye kalan yönerge metni. */
function removalAllowed(removed: string, kept: string): boolean {
  if (REFERENTIAL.test(removed)) return false;
  const r = topicsOf(removed);
  if (r.devices.length > 0) return false;
  const k = topicsOf(kept);
  if (k.devices.some((d) => !ALLOWED_DEVICE_IN_REST.has(d))) return false;
  if (r.all.length === 0 && k.all.length === 0) return false;
  if (k.all.length === 0 && courtesyShell(kept)) return false;
  if (admitsMissingKnowledge(kept) || matchesNoInstructionClause(kept)) return false;
  return true;
}

/** Baştaki bağlaç ("ama anahtarı…", "so just leave…") ve noktalama atılır: silinen yan cümleye bağlanıyordu, tek başına anlamsız. */
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

/** Baştaki boşluk ve madde işareti ("- ", "• ", "2) ") — korunur (Haiku 10-17: "- " ilk yan cümleyle birlikte siliniyordu). */
const LIST_MARKER = /^[-*•–]\s+|^\d{1,3}[.)]\s+/u;
function leadOf(sentence: string): string {
  const ws = sentence.match(/^\s*/u)?.[0] ?? "";
  return ws + (sentence.slice(ws.length).match(LIST_MARKER)?.[0] ?? "");
}

/** Tek cümle, yan cümle düzeyi: silinebiliyorsa yeni hâli, değilse `null` (cümle aynen kalır). */
function stripClauses(sentence: string): string | null {
  const lead = leadOf(sentence);
  const body = sentence.slice(lead.length);
  const clauses = clausesOf(body);
  if (clauses.length < 2) return null;
  const flagged = clauses.map((c) => removableClause(c));
  if (!flagged.some(Boolean) || flagged.every(Boolean)) return null;
  // Konu ayrı yan cümleye düşmüş olabilir ("Kombi için, özel talimatımız yok, …" — Haiku 10-17): BİTİŞİK asılı konu öbeği silinenle
  // birlikte denetlenir (cihazsa cümle tutulur).
  const removed = clauses.filter((c, i) => flagged[i] || ((flagged[i - 1] || flagged[i + 1]) && danglingTopic(c))).join(" ");
  const terminal = trailingTerminal(body) || ".";
  // Silinen yan cümlenin ARDINDAKİ bağlaç da atılır ("Anahtar masada, [özel talimatımız yok] ve kahvaltı …" → "Anahtar masada, kahvaltı …");
  // tek boşlukla birleşir (Opus 10-17 B4: bağlaçsız orta yan cümlede çift boşluk kalıyordu).
  let rest = trimTrailingSeparators(
    clauses
      .map((c, i) => (flagged[i] ? "" : i > 0 && flagged[i - 1] ? ` ${c.replace(LEADING_CONNECTIVE, "").trimStart()}` : c))
      .join("")
      .replace(LEADING_CONNECTIVE, "")
      .trim(),
  );
  if (!/[\p{L}\p{N}]/u.test(rest)) return null;
  if (!trailingTerminal(rest)) rest += terminal;
  rest = capitalizeFirst(rest);
  if (!removalAllowed(removed, rest)) return null;
  return lead + rest;
}

type Part = { text: string; whole: boolean };

/**
 * Cevaptaki silinebilir "talimat yok" yan cümlelerini / cümlelerini çıkarır (↑kural). Değişiklik yoksa AYNI dizeyi döner. Satır yapısı
 * korunur; tamamen boşalan satır düşer.
 */
export function stripNoInstructionFiller(reply: string): string {
  if (!reply || !matchesNoInstructionClause(reply)) return reply;
  const sourceLines = reply.split("\n");
  // 1. tur: yan cümle düzeyi; bütünüyle "talimat yok" olan cümleler aday olarak işaretlenir.
  const lines: Part[][] = sourceLines.map((line) =>
    sentencesOf(line).map((s) => {
      if (!matchesNoInstructionClause(s)) return { text: s, whole: false };
      const stripped = stripClauses(s);
      if (stripped !== null) return { text: stripped, whole: false };
      return { text: s, whole: removableClause(s.slice(leadOf(s).length)) };
    }),
  );
  // 2. tur: bütün cümle düşürme — cevabın GERİ KALANI yönerge taşımalı (aynı izin listesi; Opus 10-17 B3).
  const all = lines.flat();
  const candidates = all.filter((p) => p.whole);
  if (candidates.length > 0) {
    const removed = candidates.map((p) => p.text).join(" ");
    const kept = all
      .filter((p) => !p.whole)
      .map((p) => p.text)
      .join(" ");
    if (!/[\p{L}\p{N}]/u.test(kept) || !removalAllowed(removed, kept)) for (const p of candidates) p.whole = false;
  }
  const out: string[] = [];
  lines.forEach((parts, i) => {
    const kept = parts.filter((p) => !p.whole);
    if (kept.length === parts.length) {
      out.push(parts.map((p) => p.text).join(""));
      return;
    }
    const joined = kept.map((p) => p.text).join("").trim();
    // Tamamen boşalan satır düşer; kısmen kalan satırın baştaki boşluğu / madde işareti korunur.
    if (!/[\p{L}\p{N}]/u.test(joined)) return;
    out.push(leadOf(sourceLines[i] ?? "") + capitalizeFirst(joined.replace(LIST_MARKER, "")));
  });
  // Düşen satırın bıraktığı ardışık boş satırlar teke iner; baştaki / sondaki boş satır atılır.
  const collapsed: string[] = [];
  for (const line of out) {
    if (line.trim() === "" && (collapsed.length === 0 || collapsed[collapsed.length - 1]!.trim() === "")) continue;
    collapsed.push(line);
  }
  while (collapsed.length > 0 && collapsed[collapsed.length - 1]!.trim() === "") collapsed.pop();
  // Hiçbir şey değişmediyse AYNI dize (boş satır normalleştirmesi yalnız değişiklik olduğunda).
  const source = sourceLines.flatMap((l) => sentencesOf(l));
  return all.every((p, idx) => !p.whole && p.text === source[idx]) ? reply : collapsed.join("\n");
}
