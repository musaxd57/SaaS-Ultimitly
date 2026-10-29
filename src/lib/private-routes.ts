/**
 * Oturum gerektiren panel yolları — `src/app/(app)` altındaki HER üst klasör (kurucu 10-29 gece, 404 maddesi: "özel adres listesi kenar
 * çubuğu menüsünden gelmesin"). Liste ELLE yazılır çünkü ara katman (Edge) dosya sistemini okuyamaz; `private-routes.test.ts` onu sayfa
 * ağacına İKİ YÖNLÜ pinler (eksik klasör de fazladan girdi de kırmızı) ve `(app)` dışındaki her sayfanın açık listede olduğunu sınar.
 *
 * Bu liste YETKİ DEĞİLDİR: oturumsuz ziyaretçiyi girişe yollayan bir kullanıcı deneyimi katmanıdır. Asıl kapılar `(app)/layout`
 * (`requireAuth`), sayfa düzeyi personel kapısı (`requireManagerSession`) ve API'nin org kapsamlı sorgularıdır. Listede olmayan bir yol
 * oturumsuz isteğe gerçek 404 döner (önce her bilinmeyen adres girişe yönleniyordu — durum kodu 307, "sayfa yok" denemiyordu).
 * YAPRAK modül: hiçbir şey import etmez (ara katman + robots ortak kullanır).
 */
export const PRIVATE_APP_PREFIXES = [
  "/admin",
  "/billing",
  "/calendar",
  "/cancellations",
  "/dashboard",
  "/guest-chats",
  "/hazirlik",
  "/inbox",
  "/knowledge",
  "/properties",
  "/reports",
  "/sent",
  "/settings",
  "/tasks",
  "/templates",
] as const;

/** Yol, panelin oturum gerektiren bir yolu mu (önek tam ya da `önek/…`). */
export function isPrivateAppPath(pathname: string): boolean {
  return PRIVATE_APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
