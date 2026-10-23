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

/** Ayraç benzeri karakterler: ASCII, tam genişlik, küçük (U+FE64/65), açılı tırnak, açılı parantez (CJK / matematik / U+2329/232A). */
const FENCE_CHARS = "<>\uFF1C\uFF1E\uFE64\uFE65«»‹›\u2329\u232A\u3008\u3009《》⟨⟩≪≫⋘⋙";
/**
 * TEK BAŞINA çalışma sayılan karakterler (09-28 inceleme ajanı): "≫" / "⋙" gözle ">>" / ">>>" — tek karakter olsalar da
 * çit taklidi ("… ⋙\nDRAFT REPLY: …"). Gündelik metinde karşılığı yok (matematik "çok büyüktür").
 */
const FENCE_SINGLE_RUNS = "≪≫⋘⋙";
/**
 * Aralarında yalnız boşluk / görünmez karakter (U+2800 dahil) olan iki+ ayraç karakteri — ya da tek başına ≪≫⋘⋙.
 * Ayırıcı: boşluk, görünmez karakter (`\p{Cf}` de — Default_Ignorable onu tamamen kapsamıyor, 09-28), birleşen işaret (">\u0301>").
 */
const FENCE_RUN = new RegExp(
  `[${FENCE_CHARS}](?:[\\s\\p{Default_Ignorable_Code_Point}\\p{Cf}\\p{Mn}\\u2800]*[${FENCE_CHARS}])+|[${FENCE_SINGLE_RUNS}]`,
  "gu",
);

export function fenceSafe(text: string): string {
  return text.replace(FENCE_RUN, "");
}
