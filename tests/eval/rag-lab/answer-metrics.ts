// RAG CEVAP DÜZEYİ — saf ölçü fonksiyonları (`rag-answer.eval.test.ts`; birim testi `tests/unit/rag-answer-metrics.test.ts`).
// Cevap KODLA ölçülür (LLM hakem YOK). Sayı dil değiştirmez: saat, tutar, süre, kod.

/** Metindeki sayısal çapalar: saat (15.00 / 15:00), ≥2 haneli sayı, ondalık. Tek haneli sayı çapa değil (gürültü). */
export function numericAnchors(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d{1,2}[.:]\d{2}|\d+(?:[.,]\d+)?/g)) {
    const raw = m[0];
    if (/^\d$/.test(raw)) continue;
    out.add(raw.replace(":", ".").replace(",", "."));
  }
  return [...out];
}

/** Cevap çapalardan en az birini (sayı sınırlarıyla: "115.00" ≠ "15.00") söylüyor mu. */
export function replyHasAnchor(reply: string, anchors: readonly string[]): boolean {
  const norm = reply.replace(/(\d{1,2}):(\d{2})/g, "$1.$2").replace(/(\d),(\d)/g, "$1.$2");
  return anchors.some((a) => new RegExp(`(^|[^\\d])${a.replace(".", "\\.")}([^\\d]|$)`).test(norm));
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
