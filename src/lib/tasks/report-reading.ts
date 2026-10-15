import { foldTurkishAscii } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// MİSAFİR ARIZA BİLDİRİMİ Mİ, SORU / VARSAYIM / OLUMSUZLAMA MI? — YALNIZ GÖREV TESPİTİ İÇİN (kurucu D4, 10-15, aynen: "Gerçek arıza
// bildirimi ile varsayım, olumsuzlama ve genel soruyu ayır.")
//
// ⚠️ Güvenlik kapısına / şikâyet sınıflandırıcısına BAĞLANMAZ (`tasks/detect.ts` başlığındaki ayrım): bu dosya yalnız "bakım görevi
// açılsın mı?" sorusunu cevaplar. Konuşmanın şikâyet / insana devir kararı değişmez — soru gibi yazılmış bir arıza yine ev sahibine düşer.
//
// 🚨 SORU EKİ TEK BAŞINA HÜKÜM VERMEZ (sınıflandırıcıda ölçülmüş ders, `fallback.ts` "SORU EKİ GUARD'I … GERİ ALINDI"): Türkçede soru eki
// arızayı TEREDDÜTLE bildirmenin olağan biçimidir — "Salon ışığı yanmıyor mu, karanlıkta oturuyoruz." Bu yüzden mesaj YALNIZ şu hâlde
// "soru" sayılır: HER cümlecik soru / varsayım / soru-niyeti ("gelmeden sormak istedim") ya da selamlama; tek bir başka cümlecik
// ("karanlıkta oturuyoruz", "su gitmiyor", "buz gibi") varsa bildirimdir. Şüphede bildirim (fazla görev, kaçan arızadan ucuzdur).
// Türkçe "?" tek başına soru DEĞİLDİR ("Su akmıyor?" vurgulu bildirim); İngilizcede soru yardımcı fiille başlayan "?"li cümleciktir.
//
// Doğrusal: karakter / belirteç başına tek geçiş, karesel düzenli ifade yok (misafir metni, ReDoS kuralı).
// ---------------------------------------------------------------------------

/** Türkçe soru eki (ASCII'ye katlanmış; ı→i, ü→u) + "acaba". Cümleciğin İLK sözcüğü değilse sayılır (İspanyolca "mi casa" ayrımı). */
const TR_QUESTION_PARTICLES: ReadonlySet<string> = new Set([
  "mi", "mu", "misin", "musun", "miyim", "muyum", "miyiz", "muyuz", "misiniz", "musunuz", "midir", "mudur", "miydi", "muydu",
  "miymis", "muymus", "midirlar", "mudurlar",
]);

/** İngilizce evet / hayır sorusunu açan yardımcı fiiller (yalnız "?" ile biten cümlecikte). "Why / how" bilerek YOK: arızayı varsayar. */
const EN_QUESTION_OPENERS: ReadonlySet<string> = new Set([
  "is", "are", "was", "were", "do", "does", "did", "can", "could", "will", "would", "should", "has", "have", "am", "isn't", "aren't",
  "doesn't", "don't", "didn't", "isnt", "arent", "doesnt", "dont", "didnt",
]);
/**
 * Soru sözcüğüyle açılan "?"li cümlecik ("who do we call?", "what should we do?") YALNIZ kendisi arıza anlatmıyorsa soru sayılır:
 * "Who do I call about the broken dishwasher?" arızayı bildirir (ölçüldü — Haiku düzeltmesinin ilk hâli bunu düşürüyordu). "why / how"
 * hiç YOK — arızayı varsayar ("Why is the AC not working?").
 */
const EN_WH_QUESTION_WORDS: ReadonlySet<string> = new Set(["who", "whom", "what", "where", "when", "which"]);

/**
 * İngilizce varsayım: cümlecik "if / unless / whether / in case / just in case" ile BAŞLAR ya da soru sözcüğüyle başlayıp "if" içerir
 * ("What should we do if the AC is broken?"). Cümlecik ortasındaki "even if" bildirimdir ("Heating doesn't work even if I set it to max" —
 * Haiku 10-15). Türkçe varsayım çoğunlukla EKTEDİR ("bozuksa") — ↓`hitIsReported`.
 */
const EN_HYPOTHETICAL_OPENERS: ReadonlySet<string> = new Set(["if", "unless", "whether"]);
const EN_WH_OPENERS: ReadonlySet<string> = new Set([
  "what", "who", "whom", "how", "where", "when", "should", "shall", "do", "does", "can", "could", "will", "would",
]);
function enHypothetical(tokens: readonly string[]): boolean {
  const [a, b, c] = tokens;
  if (EN_HYPOTHETICAL_OPENERS.has(a)) return true;
  if ((a === "in" && b === "case") || (a === "just" && b === "in" && c === "case")) return true;
  return EN_WH_OPENERS.has(a) && tokens.includes("if");
}
/**
 * Türkçe AYRI yazılmış koşul: AYNI cümlecikte "eğer / şayet" + "ise / olursa / olsa" ("Eğer su gelmiyor ise ne yapalım?"). Tek başına "eğer"
 * yetmez: "Su gelmiyor eğer akşama kadar düzelmezse otele geçeceğiz" bildirimdir (sınıflandırıcıda ölçülmüş ders).
 */
const TR_IF_WORDS: ReadonlySet<string> = new Set(["eger", "sayet"]);
const TR_IF_TAILS: ReadonlySet<string> = new Set(["ise", "olursa", "olsa"]);

/**
 * Soru niyeti cümleciği ("gelmeden sormak istedim", "just asking"). Türkçede SÖZCÜK BAŞI (sormak / soruyorum / merak…); çıplak "gelmeden /
 * varmadan" YETMEZ — "Musluktan su gelmiyor sabah gelmeden kalktık" bildirimdir (Haiku 10-15); yalnız "gelmeden önce / varmadan önce".
 * İfadeler sözcük sınırlı (ASCII katlanmış metinde; sabit metin + çevre kontrolü, geri izleme yok).
 */
const INQUIRY_TOKEN_PREFIXES: readonly string[] = [
  "sormak", "sormus", "soruyor", "sorayim", "soracak", "soracag", "merak", "ogrenmek", "ogrenebilir", "danismak",
];
const INQUIRY_PHRASES: readonly RegExp[] = [
  "bilgi almak", "gelmeden once", "varmadan once", "just asking", "wondering", "wanted to ask", "want to ask", "would like to ask",
  "before we arrive", "before arrival", "before our arrival", "curious",
].map((p) => new RegExp(`(?<![\\p{L}\\p{N}])${p}(?![\\p{L}\\p{N}])`, "u"));

/** Selamlama / nezaket cümleciği yalnız bu sözcüklerden oluşuyorsa YANSIZDIR (bildirim kanıtı sayılmaz). */
const NEUTRAL_WORDS: ReadonlySet<string> = new Set([
  "merhaba", "merhabalar", "selam", "selamlar", "iyi", "gunler", "aksamlar", "geceler", "gunaydin", "tesekkurler", "tesekkur",
  "ederim", "ederiz", "sagolun", "sag", "olun", "lutfen", "rica", "kolay", "gelsin", "hocam", "bey", "hanim", "hello", "hi", "hey",
  "thanks", "thank", "you", "good", "morning", "evening", "afternoon", "dear", "host", "please", "sorry", "kusura", "bakmayin",
]);

type ClauseKind = "question" | "hypothetical" | "inquiry" | "neutral" | "other" | "empty";

const TOKEN_SPLIT = /[^\p{L}\p{N}']+/u;

function clauseKind(raw: string, endsWithQuestion: boolean, reportsFault: (clause: string) => boolean): ClauseKind {
  const folded = foldTurkishAscii(raw).replace(/[’`]/g, "'");
  const tokens = folded.split(TOKEN_SPLIT).filter(Boolean);
  if (tokens.length === 0) return "empty";
  if (tokens.some((t) => INQUIRY_TOKEN_PREFIXES.some((p) => t.startsWith(p))) || INQUIRY_PHRASES.some((re) => re.test(folded))) {
    return "inquiry";
  }
  if (tokens.some((t, i) => (i > 0 && TR_QUESTION_PARTICLES.has(t)) || t === "acaba")) return "question";
  if (endsWithQuestion && EN_QUESTION_OPENERS.has(tokens[0])) return "question";
  if (endsWithQuestion && EN_WH_QUESTION_WORDS.has(tokens[0]) && !reportsFault(raw)) return "question";
  if (enHypothetical(tokens)) return "hypothetical";
  if (tokens.some((t) => TR_IF_WORDS.has(t)) && tokens.some((t) => TR_IF_TAILS.has(t))) return "hypothetical";
  if (tokens.every((t) => NEUTRAL_WORDS.has(t))) return "neutral";
  return "other";
}

const WORD_CHAR = /[\p{L}\p{N}]/u;
/** Karşıtlık bağlaçları (cümlecik sınırı). "ve / and" bilerek YOK ("Klima ve kombi bozuk" tek bildirim); "yet" YOK ("not yet"). */
const CONTRAST_CONJUNCTIONS: ReadonlySet<string> = new Set(["ama", "fakat", "ancak", "lakin", "but", "however"]);

/** Cümleciklere böl (. , ; ! ? satır sonu); her cümleciğin "?" ile bitip bitmediği. Doğrusal. Küçük harfe çevirme / harf örtme noktalama
 *  eklemediği ve silmediği için aynı mesajın bu biçimleri AYNI sayıda cümlecik verir (sıra numarasıyla eşlenir — `detect.ts`). */
export function splitClauses(message: string): Array<{ text: string; start: number; endsWithQuestion: boolean }> {
  const out: Array<{ text: string; start: number; endsWithQuestion: boolean }> = [];
  let start = 0;
  let wordStart = -1;
  for (let i = 0; i <= message.length; i++) {
    const ch = i < message.length ? message[i] : "\n";
    const isWordChar = i < message.length && WORD_CHAR.test(ch);
    if (isWordChar) {
      if (wordStart < 0) wordStart = i;
      continue;
    }
    // Karşıtlık bağlacı da sınırdır ("Klima güzel çalışıyor ama kombi bozuk" → arıza "kombi bozuk" cümleciğinde — Haiku 10-15).
    if (wordStart >= 0) {
      if (i - wordStart <= 7 && CONTRAST_CONJUNCTIONS.has(message.slice(wordStart, i).toLowerCase())) {
        if (wordStart > start) out.push({ text: message.slice(start, wordStart), start, endsWithQuestion: false });
        start = i;
      }
      wordStart = -1;
    }
    if (ch === "." || ch === "," || ch === ";" || ch === "!" || ch === "?" || ch === "\n" || ch === "\u061F" || ch === "\uFF1F") {
      const question = ch === "?" || ch === "\u061F" || ch === "\uFF1F";
      if (i > start) out.push({ text: message.slice(start, i), start, endsWithQuestion: question });
      else if (question && out.length > 0) out[out.length - 1].endsWithQuestion = true; // "??"
      start = i + 1;
    }
  }
  return out;
}

/**
 * Mesaj YALNIZ soru / varsayım / soru niyetinden (ve selamlamadan) mı oluşuyor? Öyleyse bakım görevi açılmaz.
 * Tek bir "başka" cümlecik (durum anlatımı) varsa false → bildirim (şüphede bildirim).
 */
export function isInquiryOnly(message: string, reportsFault: (clause: string) => boolean = () => false): boolean {
  let asked = false;
  for (const c of splitClauses(message)) {
    const kind = clauseKind(c.text, c.endsWithQuestion, reportsFault);
    if (kind === "other") return false;
    if (kind === "question" || kind === "hypothetical" || kind === "inquiry") asked = true;
  }
  return asked;
}

/**
 * Misafirin KENDİ eşyası mı? ("Getirdiğimiz kahve makinesi bozuldu", "Kendi blenderımız bozuldu", "my own hair dryer") — dairenin
 * bakımı değil. Yalnız cihaz envanteri kuralı (detect 3b) okur; açık arıza sözcüğü kuralı bugünkü gibi.
 */
const GUEST_OWNED_TOKENS: ReadonlySet<string> = new Set(["kendi", "kendimizin", "kendimin"]);
const GUEST_OWNED_PREFIXES: readonly string[] = ["getirdig", "getirdik", "getirmistik", "getirdim"];
const GUEST_OWNED_PHRASES: readonly string[] = ["our own", "my own", "we brought", "i brought"];
export function mentionsGuestOwnedItem(message: string): boolean {
  const folded = foldTurkishAscii(message).replace(/[\u2019`]/g, "'");
  if (GUEST_OWNED_PHRASES.some((p) => folded.includes(p))) return true;
  return folded.split(TOKEN_SPLIT).some((t) => GUEST_OWNED_TOKENS.has(t) || GUEST_OWNED_PREFIXES.some((p) => t.startsWith(p)));
}

/** Türkçe koşul eki (sınıflandırıcıdaki `CONDITIONAL_TAIL` ile aynı: -sa/-se, kaynaştırmalı -rsa/-ysa). */
const TR_CONDITIONAL_SUFFIX = /^[ry]?s[ae]/u;
/** Belirteçten SONRA gelen ayrı sözcük: olumsuzlama ya da koşul. */
const TR_AFTER_NEGATION = new Set(["degil", "degildi", "degiller"]);
const TR_AFTER_CONDITIONAL = new Set(["ise", "olursa", "olsa", "olunca", "olmasi", "durumunda"]);
/** İngilizce: eşleşmeden HEMEN ÖNCEKİ sözcük olumsuzlama ("isn't broken", "not broken", "never broken"). */
const EN_BEFORE_NEGATION = new Set(["not", "never", "isn't", "isnt", "wasn't", "wasnt", "aren't", "arent", "weren't", "werent"]);
/** Olumsuzlama ile eşleşme arasında olabilecek TEK pekiştirme zarfı. */
const EN_NEGATION_ADVERBS = new Set(["really", "actually", "totally", "completely", "fully", "even", "exactly", "that"]);

/**
 * Arıza sözcüğünün bu GEÇİŞİ bildirim mi? `start`/`end` eşleşmenin küçük harfli metindeki konumu (Türkçe sözcükte gövde; ek serbest).
 *  - Aynı belirtecin geri kalanı koşul eki ise ("bozukSA", "çalışmıyorSA") → değil.
 *  - Ardındaki sözcük "değil" ise ("bozuk değil") → değil; "ise / olursa / durumunda" ise → değil.
 *  - Önündeki sözcük İngilizce olumsuzlama ise ("isn't broken") → değil.
 * Cümlecik sınırı ("Klima bozuk, değil mi?") ayrı sözcük sayılmaz → bildirim kalır (onay sorusu).
 */
export function hitIsReported(lower: string, start: number, end: number): boolean {
  // Belirtecin geri kalanı (harf / rakam / kesme).
  let tokEnd = end;
  while (tokEnd < lower.length && /[\p{L}\p{N}'’]/u.test(lower[tokEnd])) tokEnd++;
  const rest = foldTurkishAscii(lower.slice(end, tokEnd));
  if (rest && TR_CONDITIONAL_SUFFIX.test(rest)) return false;
  // Ardındaki sözcük (yalnız boşlukla ayrılmışsa).
  let i = tokEnd;
  while (i < lower.length && (lower[i] === " " || lower[i] === " " || lower[i] === "\t")) i++;
  if (i > tokEnd) {
    let j = i;
    while (j < lower.length && /[\p{L}\p{N}]/u.test(lower[j])) j++;
    const next = foldTurkishAscii(lower.slice(i, j));
    if (TR_AFTER_NEGATION.has(next) || TR_AFTER_CONDITIONAL.has(next)) return false;
  }
  // Önündeki sözcük (yalnız boşlukla ayrılmışsa); pekiştirme zarfıysa bir önceki ("isn't really broken" — Haiku 10-15).
  let wordEnd = start;
  for (let hop = 0; hop < 2; hop++) {
    let k = wordEnd;
    while (k > 0 && (lower[k - 1] === " " || lower[k - 1] === "\u00a0" || lower[k - 1] === "\t")) k--;
    if (k === wordEnd) break;
    let m = k;
    while (m > 0 && /[\p{L}\p{N}'’]/u.test(lower[m - 1])) m--;
    const word = lower.slice(m, k).replace(/’/g, "'");
    if (EN_BEFORE_NEGATION.has(word)) return false;
    if (!EN_NEGATION_ADVERBS.has(word)) break;
    wordEnd = m;
  }
  return true;
}
