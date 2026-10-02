// ---------------------------------------------------------------------------
// CANLI HAT ÖLÇERLERİNİN ORTAK YARDIMCILARI (kanal: `live-pipeline.eval.test.ts`, QR: `qr-live-pipeline.eval.test.ts`).
// İki ölçer AYNI kategori eşlemesini ve AYNI yasak dize ölçüsünü kullanır — ayrışan kopya, iki yüzeyin sonuçlarını kıyaslanamaz yapardı.
// ---------------------------------------------------------------------------

/**
 * Set yazarlarının ürün dışı kategorileri (10-01 setleri: amenities, appliances, fees…) ürünün kapalı kümesine eşlenir — yalnız
 * YAPI (kategori adı), içerik okunmaz / değişmez. Ürün kategorisi olan değer aynen kalır.
 */
const PRODUCT_KB_CATEGORIES = new Set(["welcome", "checkout", "location", "checkin", "wifi", "rules", "parking", "trash", "cleaning", "faq", "local_tips", "general"]);
const CATEGORY_MAP: Record<string, string> = {
  amenities: "general",
  appliances: "faq",
  emergency_info: "general",
  fees: "faq",
  pets: "rules",
  transport: "location",
};
export function productCategory(c: string): string {
  return PRODUCT_KB_CATEGORIES.has(c) ? c : (CATEGORY_MAP[c] ?? "general");
}

/** Yasak dizelerden biri giden metinde mi (büyük/küçük harf duyarsız, Türkçe katlama). */
export function forbiddenIn(forbidden: string[] | undefined, text: string): boolean {
  if (!forbidden || forbidden.length === 0) return false;
  const t = text.toLocaleLowerCase("tr");
  return forbidden.some((f) => f.trim() !== "" && t.includes(f.toLocaleLowerCase("tr")));
}
