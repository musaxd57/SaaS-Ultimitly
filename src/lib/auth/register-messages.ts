// ---------------------------------------------------------------------------
// KAYIT FORMU — ONAY / DOĞRULAMA UYARILARI (tek kaynak; UX-3, kurucu 11-13). Yaprak modül: hiçbir şey içe aktarmaz.
//
// Aynı metin iki yerde gösterilir: formun kendisi (düğme artık hiç soluk değil; kutu boşken basılınca uyarı kutunun altına çıkar ve sayfa
// kutuya kayar) ve sunucu (form atlatılırsa aynı alan hatası). İkisi ayrışmasın diye metin burada.
// ---------------------------------------------------------------------------

/** Onay kutusu işaretlenmeden "Hesap oluştur"a basıldı. */
export const REGISTER_CONSENT_REQUIRED = "Devam etmek için lütfen Kullanım Koşulları ve Gizlilik Politikası'nı kabul edin.";

/** İnsan doğrulaması (Turnstile) henüz tamamlanmadı ya da reddedildi. */
export const REGISTER_CAPTCHA_REQUIRED = "Doğrulamayı tamamlayın.";
