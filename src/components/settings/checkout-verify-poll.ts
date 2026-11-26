// ---------------------------------------------------------------------------
// ÖDEME EKRANI TAMAMLANDI → ANINDA DOĞRULAMA, istemci tarafının saf kuralları (kurucu 11-18 akşam: "doğrulanır doğrulanmaz plan açılmalı …
// panel sayfayı yenilemeden güncellenmeli"; tasarım `docs/TASARIM-2026-11-18-odeme-aninda-dogrulama.md` §3). Sunucu ucu
// `POST /api/billing/checkout-verify` (anahtar `BILLING_INSTANT_LINK_ENABLED`). YAPRAK modül: istemci paketine güvenle girer.
// ---------------------------------------------------------------------------

/** Kurucunun metinleri (AYNEN, 11-18 akşam). */
export const CHECKOUT_VERIFY_ACTIVE_MESSAGE = "Planınız etkin.";
export const CHECKOUT_VERIFY_DASHBOARD_LABEL = "Panele dön";
export const CHECKOUT_VERIFY_AWAITING_MESSAGE = "Ödeme tamamlandı. Planınız hazır olduğunda bu ekran otomatik güncellenecek.";

/** Bekleyen cevaptan sonra yeniden sorma: 3 sn, 6 sn, sonra 12 sn (QR sohbetindeki bekleme kalıbı — `guestChatPendingDelay`). */
const VERIFY_RETRY_DELAYS_MS = [3_000, 6_000, 12_000] as const;
/**
 * Bu süreden sonra aralık seyrekleşir: toplam süre sınırı yok, istek sayısı sınırlı. Sunucu kovası saatte 120: ilk 10 dakika ~50 istek
 * (3 / 6 / 12 sn), sonrası dakikada 1 → ilk saat ~100 (30 sn aralık ilk saatte ~150 isteğe çıkıp 40. dakika civarında kovayı dolduruyordu —
 * ana oturum incelemesi 11-19).
 */
export const CHECKOUT_VERIFY_SLOW_AFTER_MS = 10 * 60_000;
export const CHECKOUT_VERIFY_SLOW_DELAY_MS = 60_000;
/**
 * Destek seçeneğini ÖNE ÇIKARMA eşiği (kurucu 11-19, ÖD-1 / ÖD-3: "İki dakika makul ama yalnızca destek seçeneğini öne çıkarma eşiği
 * olarak. Normal destek bağlantısı baştan erişilebilir olsun."). Bekleme cümlesinin altındaki destek e-posta bağlantısı BAŞTAN görünür;
 * bu süreden sonra bağlantının metni ↓`CHECKOUT_VERIFY_SUPPORT_LABEL` olur ve yanında kısa takip numarası çıkar. Süre sözü verilmez.
 */
export const CHECKOUT_VERIFY_SUPPORT_AFTER_MS = 2 * 60_000;
/** Kurucunun metni (AYNEN, 11-19). */
export const CHECKOUT_VERIFY_SUPPORT_LABEL = "Destekle iletişime geç";

/**
 * Ekrandaki kısa takip numarası: sunucudaki `shortCorrelationId` (`lib/correlation.ts`) ile AYNI kural — ilk 8 karakter. O modül
 * `node:async_hooks` yüklediği için istemci paketine alınamaz; iki kuralın aynı kaldığı testte pinli (`paddle-checkout-instant.test.tsx`).
 * Kopyalama düğmesi (`TrackingNumberCopy`) numaranın TAMAMINI taşır (kurucu kararı 10-10 §5).
 */
export function shortTrackingId(id: string): string {
  return id.slice(0, 8);
}

/**
 * `attempt` kaçıncı bekleyen cevaptan sonra beklendiği (0'dan), `elapsedMs` ödeme tamamlanalı geçen süre. Sunucu 429 ile `Retry-After`
 * verdiyse ondan erken sorulmaz (kova dolunca her istek boşa gider).
 */
export function checkoutVerifyDelay(attempt: number, elapsedMs: number, retryAfterMs = 0): number {
  const base =
    elapsedMs >= CHECKOUT_VERIFY_SLOW_AFTER_MS
      ? CHECKOUT_VERIFY_SLOW_DELAY_MS
      : VERIFY_RETRY_DELAYS_MS[Math.min(Math.max(attempt, 0), VERIFY_RETRY_DELAYS_MS.length - 1)]!;
  return Math.max(base, retryAfterMs);
}

/**
 * Ucun cevabını ekran kararına çevirir.
 * - `active`: plan açık → bir kez tazele, sormayı bırak.
 * - `wait`: `awaiting` / `unverified` ya da geçici arıza (429, 5xx, ağ) → yeniden sor.
 * - `legacy`: uç yok (404: anahtar kapalı / onay bu işletmenin değil) ya da istek geçersiz (400: onay çok eski) → bugünkü akış
 *   (`checkout-pending` + sayfa yenileme). İLK istek hiç geçerli bir durum döndürmediyse de bugünkü akışa düşülür (eski yol silinmedi).
 */
export type CheckoutVerifyStep = "active" | "wait" | "legacy";

export function checkoutVerifyStep(input: { firstAttempt: boolean; status: number | null; state: unknown }): CheckoutVerifyStep {
  const { firstAttempt, status, state } = input;
  if (status !== null && status >= 200 && status < 300) {
    if (state === "active") return "active";
    if (state === "awaiting" || state === "unverified") return "wait";
  }
  if (firstAttempt) return "legacy";
  if (status === 404 || status === 400) return "legacy";
  return "wait";
}
