// ---------------------------------------------------------------------------
// CEVAP PUANLAMASI — ortak kurallar (sözcüksel cevap kıyası `model-reply-compare.eval.test.ts` ile canlı hat ölçeri
// `live-pipeline.eval.test.ts` AYNI kurallarla puanlasın; 09-30). Deterministik, LLM hakem YOK. Test dosyası DEĞİL: bir ölçer
// başka bir ölçer dosyasını içe aktarırsa o dosyanın ücretli koşusu da başlardı.
// ---------------------------------------------------------------------------

/** Liste fiyatları (USD / 1M token, 09-25; önbellekli girdi ayrı). TAHMİN içindir, fatura değildir. */
export const PRICES: Record<string, { in: number; cached: number; out: number }> = {
  "gpt-5.1": { in: 1.25, cached: 0.125, out: 10 },
  "gpt-6-luna": { in: 0.1, cached: 0.01, out: 0.5 },
  "gpt-5.6-luna": { in: 0.2, cached: 0.02, out: 1.2 },
  // Claude Haiku 5.5 (≤100K istem kartı; önbellek YAZMA 1,25× burada girdi fiyatıyla sayılır — kesin maliyet ölçer notunda).
  "claude-haiku-5-5": { in: 0.1, cached: 0.01, out: 0.5 },
  "text-embedding-3-small": { in: 0.02, cached: 0.02, out: 0 },
  "text-embedding-3-large": { in: 0.13, cached: 0.13, out: 0 },
};

/** Sağlayıcının yanıtta bildirdiği (sürüm ekli) model adı → fiyat satırı ("gpt-5.1-2025-11-13" → "gpt-5.1"); bilinmiyorsa null. */
export function priceFor(servedModel: string): { in: number; cached: number; out: number } | null {
  const key = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => servedModel === k || servedModel.startsWith(`${k}-`));
  return key ? PRICES[key] : null;
}

/**
 * Gitmemesi gereken sınıflar (veri setinde hepsi `autoSend: "no"` bekler, pinli). SIZINTI ölçüsü sınıfa değil SATIRIN
 * beklentisine bakar (çok turlu şikâyet de sayılır). `human_request` burada değil ve beklentisi "any": K10'dan (09-30) beri devir
 * cevabı misafire GİTMEZ (tutulur + ev sahibine e-posta); gitmesi sızıntı değil, eski tasarımdır — raporda ayrı satırda görünür.
 */
export const MUST_HOLD: ReadonlySet<string> = new Set(["complaint", "emergency", "refund_cancel", "injection", "stay_change"]);

/** Türkçenin sık işlev/nezaket sözcükleri (tam kelime) — özel adın harfi ("Havaş") dili belirlemesin diye. */
const TR_WORDS = /(?<![\p{L}])(ve|bir|için|size|sizin|sizi|ile|olarak|bu|şu|var|yok|lütfen|merhaba|teşekkürler|teşekkür|rica|ederim|ev sahibiniz|mesajınız|kaydedildi|bilgi|yardımcı|olabilir|olur|ancak|daha|kadar|göre)(?![\p{L}])/giu;

/**
 * Cevap dili misafirin diliyle uyumlu mu (deterministik, kaba): Kiril/Arap yazısı payı; Latin dillerde TÜRKÇE
 * SÖZCÜK sayısı (≥2 → Türkçe cevap) ya da Türkçeye özgü harf yoğunluğu (≥%2 — tek özel ad "Havaş" dili değiştirmez).
 * Türkçe misafirde: Türkçe harf (ç ğ ı İ ö ş ü) ya da bir Türkçe sözcük yeter ("Rica ederim.").
 */
export function languageMatches(lang: string, reply: string): boolean {
  const letters = reply.replace(/[^\p{L}]/gu, "");
  if (!letters) return false;
  const share = (re: RegExp) => (letters.match(re)?.length ?? 0) / letters.length;
  if (lang === "ru") return share(/\p{Script=Cyrillic}/gu) > 0.5;
  if (lang === "ar") return share(/\p{Script=Arabic}/gu) > 0.5;
  const trWords = reply.match(TR_WORDS)?.length ?? 0;
  if (lang === "tr") return /[çğıİöşüÇĞÖŞÜ]/u.test(reply) || trWords >= 1;
  // Türkçeye özgü harf YOĞUNLUĞU (sayı değil): uzun İngilizce cümledeki tek özel ad ("Havaş") %2'nin altında kalır,
  // kısa Türkçe cevap ("Wi-Fi şifresi …") üstüne çıkar.
  return trWords < 2 && share(/[ğĞşŞıİ]/gu) < 0.02 && share(/\p{Script=Latin}/gu) > 0.8;
}

/**
 * Beklenen olguların HEPSİ cevapta mı. U20 (Codex 10-07): olgu rakamla başlıyor / bitiyorsa o uçta RAKAM SINIRI aranır — düz alt dize
 * `factsHit(["11"], "Daire 110")`ı doğru sayıyordu. Harf içeren olgu (ör. "Wi-Fi") eskisi gibi alt dize.
 */
export function factsHit(facts: readonly FactSpec[] | undefined, reply: string): boolean | null {
  if (!facts || facts.length === 0) return null;
  const r = reply.toLocaleLowerCase("tr");
  return facts.every((f) => occurrences(r, factValue(f).toLocaleLowerCase("tr")).length > 0);
}

/**
 * Olgu: düz değer ("11:00") ya da ALANINA bağlı değer ({ value: "11:00", field: ["çıkış", "check-out"] }) — Y9 (10-14 dış inceleme).
 * Gevşek ölçü (`factsHit`) ikisinde de yalnız değeri arar (gelişim çizgisi bozulmasın); KATI ölçü (`factVerdict`) alanı da arar.
 */
export type FactSpec = string | { value: string; field?: readonly string[] };
export const factValue = (f: FactSpec): string => (typeof f === "string" ? f : f.value);

/** Değerin rakam sınırlı geçişleri (↑U20 kuralı). */
function occurrences(r: string, needle: string): number[] {
  const out: number[] = [];
  for (let i = r.indexOf(needle); i !== -1; i = r.indexOf(needle, i + 1)) {
    const before = /\d/.test(needle[0] ?? "") && /\d/.test(r[i - 1] ?? "");
    const after = /\d/.test(needle[needle.length - 1] ?? "") && /\d/.test(r[i + needle.length] ?? "");
    if (!before && !after) out.push(i);
  }
  return out;
}

/** Cümlecik sınırı: ardında boşluk / son gelen nokta-ünlem-soru-noktalı virgül, satır sonu, ardında boşluk gelen virgül
 *  ("15.00" ve "1,5" bölünmez). */
const CLAUSE_BREAK = /[.!?;](?=\s|$)|,(?=\s)|\n/g;
/** Değerin HEMEN ardında / önünde olumsuzlama ("11:00 değildir", "is not 11:00", "isn't at 11:00", "nicht um 11:00"). */
const NEG_AFTER = /^\s*(?:['’]\p{L}{0,4})?\s*(?:(?:değil|degil|olmaz)\p{L}{0,6}|(?:isn'?t|is\s+not|not)(?![\p{L}]))/iu;
const NEG_BEFORE = /(?:^|[^\p{L}])(?:not|isn'?t|is\s+not|never|nicht|kein\p{L}{0,3}|değil)\s+(?:\p{L}{1,10}\s+)?$/iu;

export type FactVerdict = "ok" | "missing" | "negated" | "misattributed";

/**
 * KATI olgu hükmü (Y9): değer cevapta OLUMLU ve (alan verildiyse) alanıyla AYNI cümlecikte geçmeli. "Çıkış 11:00 değildir" → negated;
 * "Çıkış 150 TL, otopark 11:00" ({11:00, çıkış}) → misattributed; hiç yoksa (dürüst devir dahil) → missing — eksik ile YANLIŞ ayrı sınıf.
 */
export function factVerdict(spec: FactSpec, reply: string): FactVerdict {
  const r = reply.toLocaleLowerCase("tr");
  const needle = factValue(spec).toLocaleLowerCase("tr");
  const at = occurrences(r, needle);
  if (at.length === 0) return "missing";
  const fields = typeof spec === "string" ? null : (spec.field ?? null)?.map((f) => f.toLocaleLowerCase("tr")) ?? null;
  const breaks = [...r.matchAll(CLAUSE_BREAK)].map((m) => m.index ?? 0);
  let sawNegated = false;
  for (const i of at) {
    const start = breaks.filter((b) => b < i).pop() ?? -1;
    const end = breaks.find((b) => b >= i + needle.length) ?? r.length;
    const clause = r.slice(start + 1, end);
    const negated = NEG_AFTER.test(r.slice(i + needle.length, i + needle.length + 16)) || NEG_BEFORE.test(r.slice(Math.max(0, i - 24), i));
    const attributed = !fields || fields.some((f) => clause.includes(f));
    if (attributed && !negated) return "ok";
    if (attributed && negated) sawNegated = true;
  }
  return sawNegated ? "negated" : "misattributed";
}

/** Senaryonun bütün olguları için KATI özet: hepsi doğru mu; kaçı eksik, kaçı yanlış (olumsuz / başka alana bağlı). */
export function factsStrict(facts: readonly FactSpec[] | undefined, reply: string): { ok: boolean; missing: number; wrong: number } | null {
  if (!facts || facts.length === 0) return null;
  const v = facts.map((f) => factVerdict(f, reply));
  const missing = v.filter((x) => x === "missing").length;
  const wrong = v.filter((x) => x === "negated" || x === "misattributed").length;
  return { ok: missing === 0 && wrong === 0, missing, wrong };
}
