/**
 * Ödeme işleminden (ödeme ekranı, plan değişikliği, devam ettirme) sonra sayfayı BİRKAÇ kez yeniler: yerel abonelik satırı Paddle
 * webhook'uyla güncellenir ve webhook'un ne zaman geleceği belli değil (S9-18, 10-17 gece: tek 2,5 sn'lik yenileme webhook'tan önce
 * koşarsa ekran eski durumda kalıyordu). Yenileme ucuzdur (sunucu bileşeni yeniden okunur); bileşen kapansa da zararsız.
 */
export const BILLING_REFRESH_DELAYS_MS: readonly number[] = [2500, 6000, 12000];

export function refreshAfterBilling(router: { refresh(): void }, delaysMs: readonly number[] = BILLING_REFRESH_DELAYS_MS): void {
  for (const ms of delaysMs) setTimeout(() => router.refresh(), ms);
}
