// ---------------------------------------------------------------------------
// "ÖDEMENİZ İŞLENİYOR" KİLİDİ — istemci ve sunucunun ortak sabitleri (YAPRAK modül: hiçbir şey import etmez, istemci paketine güvenle girer).
// Kurucu onayı 10-10 (`docs/TASARIM-2026-10-10-odeme-idempotency-ve-deneme-kotuye-kullanim.md` §1 boşluk 2).
// ---------------------------------------------------------------------------

/** Kilit süresi: Paddle webhook'u normalde saniyeler içinde gelir; gelmezse kilit kendiliğinden düşer (müşteri kalıcı kilitlenmez). */
export const CHECKOUT_PENDING_MS = 10 * 60_000;

/** Müşteriye görünen metin (sade, teknik ayrıntı yok — kurucu 09-23). */
export const CHECKOUT_PENDING_MESSAGE = "Ödemeniz işleniyor. Planınız birkaç dakika içinde görünecek.";

/**
 * Ödeme alındı ama abonelik 10 dakikada hesaba bağlanmadı (Codex 11-17; `lib/billing/checkout-paid.ts`): "birkaç dakika" sözü artık doğru
 * değil. Müşteriye ne olduğu ve ne yapacağı söylenir — yeniden ödeme YAPMASIN. (Metin kurucu onayında: tasarım belgesi soru Ö-1.)
 */
export const CHECKOUT_PAID_AWAITING_MESSAGE =
  "Ödemeniz alındı, aboneliğiniz henüz hesabınıza tanımlanmadı. Lütfen yeniden ödeme yapmayın; kısa sürede tanımlanmazsa bize yazın.";

/** Engel metni: ödemenin üstünden kilit süresi kadar geçmediyse bugünkü "işleniyor", geçtiyse "alındı, tanımlanmadı". */
export function checkoutBlockMessage(paidAt: Date, now: Date = new Date()): string {
  return now.getTime() - paidAt.getTime() < CHECKOUT_PENDING_MS ? CHECKOUT_PENDING_MESSAGE : CHECKOUT_PAID_AWAITING_MESSAGE;
}
