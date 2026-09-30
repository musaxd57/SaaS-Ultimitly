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

export function factsHit(facts: string[] | undefined, reply: string): boolean | null {
  if (!facts || facts.length === 0) return null;
  const r = reply.toLocaleLowerCase("tr");
  return facts.every((f) => r.includes(f.toLocaleLowerCase("tr")));
}
