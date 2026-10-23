// ---------------------------------------------------------------------------
// "ÖDEMENİZ İŞLENİYOR" KİLİDİ — istemci ve sunucunun ortak sabitleri (YAPRAK modül: hiçbir şey import etmez, istemci paketine güvenle girer).
// Kurucu onayı 10-10 (`docs/TASARIM-2026-10-10-odeme-idempotency-ve-deneme-kotuye-kullanim.md` §1 boşluk 2).
// ---------------------------------------------------------------------------

/** Kilit süresi: Paddle webhook'u normalde saniyeler içinde gelir; gelmezse kilit kendiliğinden düşer (müşteri kalıcı kilitlenmez). */
export const CHECKOUT_PENDING_MS = 10 * 60_000;

/** Müşteriye görünen metin (sade, teknik ayrıntı yok — kurucu 09-23). */
export const CHECKOUT_PENDING_MESSAGE = "Ödemeniz işleniyor. Planınız birkaç dakika içinde görünecek.";
