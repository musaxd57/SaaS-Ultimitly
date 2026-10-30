/**
 * Yol sınıfları — oturumsuz ziyaretçinin hangi yolu açabileceği (kurucu 10-29 gece, 404 maddesi: "özel adres listesi kenar çubuğu
 * menüsünden gelmesin"). Üç sınıf:
 *   · `public`  — oturumsuz açılır: tanıtım ("/"), yasal sayfalar, kimlik sayfaları, QR (`/c`);
 *   · `private` — `src/app/(app)` altındaki HER üst klasör: oturumsuz istek girişe gider (`?next=` ile);
 *   · `unknown` — ikisi de değil: oturumsuz istek GEÇER, Next gerçek 404 verir (önce her bilinmeyen adres 307 → /login idi).
 * Listeler ELLE yazılır çünkü ara katman (Edge) dosya sistemini okuyamaz; `private-routes.test.ts` onları sayfa ağacına pinler:
 * `(app)` içindeki her sayfa `private`, DIŞINDAKİ her sayfa `public` (yeni bir sayfa sınıflanmadan eklenemez — sınıflanmamış sayfa
 * `unknown` olur ve test kırılır), iki liste kesişmez, her açık girdi en az bir sayfaya karşılık gelir.
 *
 * Bu listeler YETKİ DEĞİLDİR: oturumsuz ziyaretçiyi girişe yollayan bir kullanıcı deneyimi katmanıdır. Asıl kapılar `(app)/layout`
 * (`requireAuth`), sayfa düzeyi personel kapısı (`requireManagerSession`) ve API'nin org kapsamlı sorgularıdır.
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

/**
 * Oturum GEREKTİRMEYEN kimlik sayfaları — çıkış yapmış ziyaretçi görebilir.
 * `/uyari-adresi-dogrula` (09-30): uyarı adresi onay bağlantısı — alıcı ekip dışı olabilir (oturumsuz); oturum AÇIKKEN de yönlendirilmez
 * (ara katmanın `SIGNED_IN_REDIRECT_PATHS`inde değil).
 */
export const AUTH_PATHS = ["/login", "/register", "/sifremi-unuttum", "/e-posta-dogrula", "/uyari-adresi-dogrula"] as const;

/**
 * Oturumsuz açılan diğer yollar. "/c" = misafir QR sohbeti (kendi jetonuyla; oturum yok).
 * ⚠️ `/guvenlik` (VDP) BURADA OLMAK ZORUNDA: politikayı okuyacak kişi tanım gereği oturumsuz bir dış araştırmacıdır. Listeden düşerse
 * `/login`'e yönlendirilir ve politika tam da hedef kitlesine kapanır — `security.txt`'in `Policy` alanı da ölü bağlantıya döner.
 * Test-pinli.
 */
export const PUBLIC_PREFIXES = [
  "/gizlilik",
  "/kosullar",
  "/mesafeli-satis",
  "/on-bilgilendirme",
  "/entegrasyonlar",
  "/guvenlik",
  "/c",
] as const;

export type RouteClass = "public" | "private" | "unknown";

const under = (prefix: string, pathname: string) => pathname === prefix || pathname.startsWith(prefix + "/");

/** Yol, kimlik sayfalarından biri mi (önek tam ya da `önek/…`). */
export function isAuthPath(pathname: string): boolean {
  return AUTH_PATHS.some((p) => under(p, pathname));
}

function classifyDecoded(pathname: string): RouteClass {
  if (pathname === "/" || isAuthPath(pathname) || PUBLIC_PREFIXES.some((p) => under(p, pathname))) return "public";
  if (PRIVATE_APP_PREFIXES.some((p) => under(p, pathname))) return "private";
  return "unknown";
}

/** Çözülmüş yolda nokta kesimi / ters bölü — çözüm sonrası "/c/../inbox" açık önekle başlasa da başka bir yolu gösterebilir. */
const DOT_SEGMENT = /(?:^|\/)\.{1,2}(?:\/|$)|\\/;

/**
 * Yolun sınıfı. Açık liste özel listeden ÖNCE okunur; iki liste kesişmez (testli).
 * Yüzde kodlu yol ÇÖZÜLEREK sınıflanır (10-30 sert inceleme C17: ara katman ham yolu görür — "/%69nbox" — ama Next dosya yönlendiricisi
 * onu "/inbox" diye çözüp sayfayı açar; oturumsuz istek girişe gitmiyordu, yalnız sayfa kapısı durduruyordu). Bozuk kodlama ya da
 * çözümde nokta kesimi → `private` (girişe yollamak zararsız; kapalı-güvenli).
 */
export function classifyPath(pathname: string): RouteClass {
  if (!pathname.includes("%")) return classifyDecoded(pathname);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return "private";
  }
  if (DOT_SEGMENT.test(decoded)) return "private";
  return classifyDecoded(decoded);
}

/** Yol, panelin oturum gerektiren bir yolu mu. */
export function isPrivateAppPath(pathname: string): boolean {
  return classifyPath(pathname) === "private";
}
