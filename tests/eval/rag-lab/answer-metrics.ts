// RAG CEVAP DÜZEYİ — saf ölçü fonksiyonları (`rag-answer.eval.test.ts`; birim testi `tests/unit/rag-answer-metrics.test.ts`).
// Cevap KODLA ölçülür (LLM hakem YOK). Sayı dil değiştirmez: saat, tutar, süre, kod.

const pad2 = (h: string | number): string => String(h).padStart(2, "0");

/**
 * Saat ve sayı YAZIMINI tek biçime indirir — iki tarafa da (cevap cümlesi + model yanıtı) aynı uygulanır (kurucu 09-27: "08h30,
 * 5 pm = 17.00 … deterministik testlerle ele"; kuru koşuda doğru cevapların bir kısmı yalnız yazım farkıyla "yanlış sayı"
 * sayılıyordu). Ölçücü kuralıdır, ürün kodu DEĞİL. Saat → "HH.MM": 12 saatlik (5 pm, 5:30 p.m., 11am, 12 am = 00.00, 12 pm =
 * 12.00) · Fransız (08h30, 15 h 30; dakikasız "15h" yalnız 6–23 — küçük sayı süre olabilir: "2h") · Alman (15 Uhr, 15.30 Uhr) ·
 * Türkçe dakikasız "saat 17" (yalnız 6–23; "saat 2" iki okumalı) · noon / midnight · öndeki sıfır (8.30 = 08.30 = 8:30). Binlik
 * ayırıcı düşer (1.500 = 1,500 = 1500).
 */
export function normalizeNumbers(text: string): string {
  return text
    .replace(/(?<![\d.:,])(\d{1,2})(?:[:.](\d{2}))?\s?([ap])\.?\s?m\b\.?/gi, (_m, h: string, mm: string | undefined, ap: string) =>
      `${pad2((Number(h) % 12) + (ap.toLowerCase() === "p" ? 12 : 0))}.${mm ?? "00"}`,
    )
    .replace(/(?<![\d.:,])(\d{1,2})\s?h\s?(\d{2})(?!\d)/gi, (_m, h: string, mm: string) => `${pad2(h)}.${mm}`)
    .replace(/(?<![\d.:,])([6-9]|1\d|2[0-3])\s?h\b/gi, (_m, h: string) => `${pad2(h)}.00`)
    .replace(/(?<![\d.:,])(\d{1,2})(?:[:.](\d{2}))?\s?Uhr\b/gi, (_m, h: string, mm: string | undefined) => `${pad2(h)}.${mm ?? "00"}`)
    .replace(/\bsaat\s([6-9]|1\d|2[0-3])(?![\d.:,])/gi, (_m, h: string) => `saat ${pad2(h)}.00`)
    .replace(/\b(?:12\s)?noon\b/gi, "12.00")
    .replace(/\bmidnight\b/gi, "00.00")
    .replace(/(?<![\d.:,])(\d{1,2})[:.](\d{2})(?!\d)/g, (_m, h: string, mm: string) => `${pad2(h)}.${mm}`)
    .replace(/(?<![\d.,])\d{1,3}(?:[.,]\d{3})+(?![\d.,]*\d)/g, (m) => m.replace(/[.,]/g, ""));
}

/** Metindeki sayısal çapalar: saat (tek biçim "HH.MM"), ≥2 haneli sayı, ondalık. Tek haneli sayı çapa değil (gürültü). */
export function numericAnchors(text: string): string[] {
  const out = new Set<string>();
  for (const m of normalizeNumbers(text).matchAll(/\d{1,2}[.:]\d{2}|\d+(?:[.,]\d+)?/g)) {
    const raw = m[0];
    if (/^\d$/.test(raw)) continue;
    out.add(raw.replace(":", ".").replace(",", "."));
  }
  return [...out];
}

/** Cevap çapalardan en az birini (sayı sınırlarıyla: "115.00" ≠ "15.00") söylüyor mu. İki taraf aynı normalizasyondan geçer. */
export function replyHasAnchor(reply: string, anchors: readonly string[]): boolean {
  const norm = normalizeNumbers(reply).replace(/(\d{1,2}):(\d{2})/g, "$1.$2").replace(/(\d),(\d)/g, "$1.$2");
  return anchors.some((a) => new RegExp(`(^|[^\\d])${a.replace(".", "\\.")}([^\\d]|$)`).test(norm));
}

/**
 * CEVAP BAŞINA sayısal çapa isabeti (Codex 09-27): iki sorulu mesajda "herhangi bir çapa" başarı SAYILMAZ — yalnız birinci sorunun
 * saatini söyleyen yanıt ikinci soruyu cevaplamamıştır. Sayı taşıyan HER cevabın KENDİ sayılarından en az biri yanıtta olmalı.
 * `anchored` = sayı taşıyan cevap sayısı, `hit` = yanıtta sayısı geçen cevap sayısı, `all` = hepsi (sayılı cevap yoksa null).
 */
export function answerAnchorHits(reply: string, answers: readonly { needles: readonly string[] }[]): { anchored: number; hit: number; all: boolean | null } {
  let anchored = 0;
  let hit = 0;
  for (const a of answers) {
    const own = numericAnchors(a.needles[0] ?? "");
    if (own.length === 0) continue;
    anchored += 1;
    if (replyHasAnchor(reply, own)) hit += 1;
  }
  return { anchored, hit, all: anchored > 0 ? hit === anchored : null };
}

/**
 * U20 (Codex 10-07) — KATI isabet, AYRI sütun (gevşek ölçü `answerAnchorHits` gelişim çizgisi için AYNEN kalır; bu bir KAPI DEĞİL):
 * gevşek ölçü cevabın HERHANGİ bir sayısını yetiyor sayıyordu → doğru cevap "Havuz 09:00–20:00" iken "Havuz 09:00–11:00" ya da
 * "Havuz 09:00'da açık değil" tam isabetti. Katı: cevabın KENDİ sayılarının HEPSİ (aralıkta iki uç) yanıtta ve her biri olumsuzlanmamış
 * bir cümlede. Olumsuzluk yedi dilde kaba bir sözcük listesi (ölçücü kuralı, ürün kodu değil; Türkçe "ne" / "no" (numara)
 * çakıştığı için yok).
 */
const NEGATION = /(?:^|[^\p{L}])(?:değil|yok|olmaz|not|never|isn't|aren't|doesn't|don't|won't|can't|kein\p{L}*|nicht|pas|jamais|nunca|jamás|не|нет|ليس|لا)(?=[^\p{L}]|$)/iu;

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+|\n+/u).filter((s) => s.trim() !== "");
}

/** Bütün çapalar yanıtta ve her çapanın geçtiği cümlelerden en az biri olumsuzluk taşımıyor. */
export function replyHasAllAnchorsAffirmed(reply: string, anchors: readonly string[]): boolean {
  if (anchors.length === 0) return false;
  const sentences = sentencesOf(reply);
  return anchors.every((a) => sentences.some((s) => replyHasAnchor(s, [a]) && !NEGATION.test(s)));
}

export function answerAnchorHitsStrict(reply: string, answers: readonly { needles: readonly string[] }[]): { anchored: number; hit: number } {
  let anchored = 0;
  let hit = 0;
  for (const a of answers) {
    const own = numericAnchors(a.needles[0] ?? "");
    if (own.length === 0) continue;
    anchored += 1;
    if (replyHasAllAnchorsAffirmed(reply, own)) hit += 1;
  }
  return { anchored, hit };
}

/**
 * YABANCI SAYI (#189 geniş blok riski: "uzun blokta cevap modeli yanlış olguya sapar mı"): cevabın söylediği ama DAYANAĞI
 * BİLİNEN kaynaklarda (cevap cümleleri · mülk alanları · misafirin kendi yazdığı) OLMAYAN sayısal çapalar. Yanıtsız soruda
 * bilgi bloğundaki BAŞKA bir kalemin sayısını söylemek iddia denetiminde "dayanaklı" görünür (sayı bağlamda var) — bu ölçü onu
 * yakalar. Mutlak değer gürültülüdür (meşru ek bilgi de sayılır); yalnız aynı sorularda iki yapılandırmanın FARKI okunur.
 */
export function foreignNumbers(reply: string, allowedTexts: readonly string[]): string[] {
  const allowed = new Set(allowedTexts.flatMap((t) => numericAnchors(t)));
  return numericAnchors(reply).filter((a) => !allowed.has(a));
}
