// Seller / legal-entity details shown on the legal pages (Mesafeli Satış
// Sözleşmesi + Ön Bilgilendirme Formu).
//
// ⚠️ FILL THESE before enabling paid subscriptions, and have a lawyer review the
// final legal text. The [bracketed] values are obvious placeholders so an
// unfinished form is never mistaken for a finalized one.
export const SELLER = {
  unvan: "Zeynep Cinar",
  adres: "Via Francesco Olgiati, Milano, Lombardia, 20143, İtalya",
  // UX-6 (kurucu 11-13): satıcı İtalya'da kayıtlı bir şahıs işletmesi; numara İtalya KDV numarası (Partita IVA — 11 hane, denetim
  // hanesi tutuyor). Türkiye'ye özgü "MERSİS" etiketi yanlıştı. Etiket metni tek yerde: `SELLER_TAX_LABEL`.
  vergiNo: "14237210969",
  telefon: "+39 348 752 45 31",
  eposta: "iletisimlixusai@gmail.com",
};

// Legal-document version. Bump it whenever the legal text changes (YYYY-MM-DD, the day of the change):
//  • LEGAL_VERSION — machine value stamped into each user's consent record
//    (User.acceptedLegalVersion), so we can later prove WHICH text was accepted.
//  • LEGAL_LAST_UPDATED — the human string shown on the legal pages, DERIVED from LEGAL_VERSION.
// Single source → the stamped version can never silently drift from what the user actually saw.
// (`LEGAL_TEXT_HASH` is the automatic second proof: it changes even if nobody bumps this.)
const TR_MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

// UX-6 (kurucu 11-13): sürüm GÜN-ay-yıl düzeyinde ("Son güncelleme: Kasım 2026" ay sonunu / ileri bir tarihi işaret ediyor gibi
// okunuyordu). Görünen tarih sürümden TÜRETİLİR — ikisi artık elle eşitlenmez, ayrışamaz.
export const LEGAL_VERSION = "2026-11-13";
export const LEGAL_LAST_UPDATED = legalDateTr(LEGAL_VERSION);

/** Vergi numarasının etiketi (yasal sayfaların üçü de bunu kullanır). */
export const SELLER_TAX_LABEL = "Vergi No (Partita IVA, İtalya)";

/** "2026-11-13" → "13 Kasım 2026". Biçim dışı sürüm yayına çıkmasın: açılışta atar (test pinli). */
export function legalDateTr(version: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(version);
  const month = m ? Number(m[2]) : 0;
  const day = m ? Number(m[3]) : 0;
  if (!m || month < 1 || month > 12 || day < 1 || day > 31) throw new Error(`LEGAL_VERSION biçimi YYYY-AA-GG olmalı: ${version}`);
  return `${day} ${TR_MONTHS[month - 1]} ${m[1]}`;
}
