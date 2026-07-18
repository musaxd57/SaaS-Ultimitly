// Seller / legal-entity details shown on the legal pages (Mesafeli Satış
// Sözleşmesi + Ön Bilgilendirme Formu).
//
// ⚠️ FILL THESE before enabling paid subscriptions, and have a lawyer review the
// final legal text. The [bracketed] values are obvious placeholders so an
// unfinished form is never mistaken for a finalized one.
export const SELLER = {
  unvan: "Zeynep Cinar",
  adres: "Via Francesco Olgiati, Milano, Lombardia, 20143, İtalya",
  mersisVergi: "[P.IVA NO]",
  telefon: "[TELEFON — ülke koduyla, örn. +39...]",
  eposta: "iletisimlixusai@gmail.com",
};

// Legal-document version. Bump BOTH together whenever the legal text changes:
//  • LEGAL_VERSION — machine value stamped into each user's consent record
//    (User.acceptedLegalVersion), so we can later prove WHICH text was accepted.
//  • LEGAL_LAST_UPDATED — the human string shown on the legal pages.
// Single source → the stamped version can never silently drift from what the
// user actually saw. Keep the two in sync (same release).
export const LEGAL_VERSION = "2026-06";
export const LEGAL_LAST_UPDATED = "Haziran 2026";
