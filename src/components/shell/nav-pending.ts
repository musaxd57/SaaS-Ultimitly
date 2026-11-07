/**
 * Menü tıklamasında ANINDA geri bildirim (kurucu 10-29 gece, HZ2 "önerini beğendim"). Saf kurallar — kabuk (`app-shell.tsx`) kullanır.
 *
 * Kurucunun şartları: tıklamada anında işaret · hızlı geçişte içerik hazır olur olmaz · yavaşta menü ve üst çubuk kullanılabilir ·
 * mobilde menü kapandıktan sonra da üst çubukta görünür · hata / iptal / başka yere gitmede doğru biter, ASLA sonsuz dönmez, menüyü
 * ASLA kilitlemez · "geçiş başladı" ≠ "veri hazır" (Next'in `useLinkStatus`u iskelet görünür görünmez biter — erken).
 * Bu yüzden bitiş ölçütü: adres DEĞİŞTİ (yalnız yol değil, sorgu da — `/billing` → `/settings?tab=…`) VE ekranda rota iskeleti
 * (`[data-route-skeleton]`, her `loading.tsx` kökü) YOK. Hata / 404 ekranı iskeleti kaldırır → biter. Güvenlik süresi 15 sn.
 */

/** Yalnız sol tık + değiştirici tuş yok + yeni sekme hedefi değil — tarayıcının kendi açtığı sekmeler bekleme göstermez. */
export function isPlainNavigationClick(e: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  currentTarget: { getAttribute(name: string): string | null } | null;
}): boolean {
  if (e.defaultPrevented || e.button !== 0) return false;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const target = e.currentTarget?.getAttribute("target");
  return !target || target === "_self";
}

/**
 * Bekleyen gezinme bitti mi: adres başlangıçtakinden farklı (ya da bekleme sırasında bir kez ayrıldı — geri tuşu / logo ile başlangıç
 * adresine dönüş, 10-30 sert inceleme C14: şerit 15 sn dönüyor, yanlış menü seçili kalıyordu) ve rota iskeleti yok.
 */
export function navigationSettled(fromHref: string, currentHref: string, skeletonOnScreen: boolean, leftFrom = false): boolean {
  return (currentHref !== fromHref || leftFrom) && !skeletonOnScreen;
}

/** Güvenlik süresi: bu süreden sonra işaret her durumda kalkar (10 sn'lik "yavaş yükleme" uyarısı ayrıca çıkış yolu sunar). */
export const NAV_PENDING_MAX_MS = 15_000;

/** Güvenlik süresinin KALANI — TIKLAMADAN ölçülür (10-30 C15: her yol değişiminde süre baştan başlıyordu, şerit 15 sn'yi aşıyordu). */
export function remainingPendingMs(startedAt: number, now: number): number {
  return Math.max(0, NAV_PENDING_MAX_MS - (now - startedAt));
}

/** Rota iskeletlerinin ortak işareti (her `loading.tsx` kökünde). */
export const ROUTE_SKELETON_ATTR = "data-route-skeleton";
