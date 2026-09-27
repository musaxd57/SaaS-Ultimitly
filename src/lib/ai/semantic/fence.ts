// ---------------------------------------------------------------------------
// Anlam katmanı istemlerinin veri ayracı (`<<<…>>>`) koruması — TEK KAYNAK (yaprak modül; yeniden sıralayıcı, anlama katmanı
// ve bekçi aynı kuralı kullanır; eskiden üç ayrı kopyaydı).
//
// Veri bloğunun sınırını taklit eden dizi veriden silinir. İki+ ayraç karakterinden oluşan ÇALIŞMA bütünüyle silinir: tek geçişte
// "<<<" silmek ">><<<>" girdisinden YENİ bir ">>>" üretiyordu (inceleme 09-24). #211 (A6 bulgu 3, 09-27): yalnız bitişik ASCII
// "<" / ">" siliniyordu; tam genişlikli "＞＞＞", açılı tırnak "»»»", boşluklu "> > >" ve görünmez karakterle ayrılmış
// ">​>​>" (U+200B / U+2060) geçiyordu. Artık ayraç BENZERİ karakterler ve aralarındaki yalnız boşluk / görünmez karakter
// tek çalışma sayılır. Bu karakterleri taşımayan metin BAYT BAYT aynı (ölçer önbelleği ve modele giden istem değişmez); tek
// ayraç ("100 > 50", "«ёлка»", "<3") korunur.
// ---------------------------------------------------------------------------

/** Ayraç benzeri karakterler: ASCII, tam genişlik, açılı tırnak, açılı parantez (CJK / matematik). */
const FENCE_CHARS = "<>＜＞«»‹›〈〉《》⟨⟩";
/** Aralarında yalnız boşluk / görünmez karakter (U+2800 dahil) olan iki+ ayraç karakteri. */
const FENCE_RUN = new RegExp(`[${FENCE_CHARS}](?:[\\s\\p{Default_Ignorable_Code_Point}\\u2800]*[${FENCE_CHARS}])+`, "gu");

export function fenceSafe(text: string): string {
  return text.replace(FENCE_RUN, "");
}
