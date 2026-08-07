// ---------------------------------------------------------------------------
// TEMA — KAPSAM VE DEPOLAMA, TEK KAYNAK.
//
// 🚨 KARANLIK MOD YALNIZ PANELDE (kullanıcı kararı). Landing, hukuk sayfaları,
// giriş/kayıt ekranı ve halka açık QR sohbeti HER ZAMAN açık kalır.
// Gerekçe iki katmanlı:
//  · ÜRÜN: pazarlama yüzeyi marka rengiyle satılıyor; ziyaretçinin işletim
//    sistemi tercihine göre değişmesi istenmiyor.
//  · TEKNİK: giriş ekranı `bg-primary` lacivert panel üzerine BEYAZ metin
//    kullanıyor (`(auth)/layout.tsx`). Karanlıkta `--primary` açık maviye
//    döndüğü için beyaz-üstü-açık-mavi ~1.9:1'e düşerdi — yeni müşterinin
//    gördüğü İLK ekran okunmaz olurdu.
//
// ⚠️ SINIF `<html>` ÜZERİNDE, panel sarmalayıcısında DEĞİL. Sebep: `Toaster` ve
// `ConfirmHost` KÖK layout'ta mount ediliyor, yani panel ağacının DIŞINDALAR.
// Sınıf bir panel div'ine konsaydı bildirimler ve onay kutuları karanlık panelin
// üstünde AÇIK RENK açılırdı. `<html>`'e koyup panel layout'unun girişte ekleyip
// çıkışta kaldırması hem portalları kapsar hem kapsamı korur.
// ---------------------------------------------------------------------------

/** localStorage anahtarı. Sunucuya HİÇ gitmez — çerez yok, oturuma yazılmaz. */
export const THEME_STORAGE_KEY = "lixus-theme";

/**
 * Karanlık modun geçerli olduğu yol önekleri.
 *
 * ⚠️ `src/app/(app)/` altındaki HER dizin burada olmalı — bir sayfa eksik
 * kalırsa o sayfaya doğrudan girildiğinde ilk boyamada AÇIK tema görünür,
 * sonra JavaScript karartır: kullanıcının gördüğü şey bir "flaş"tır.
 * `tests/unit/theme-scope.test.ts` bunu dosya sisteminden türetip pinler,
 * yani yeni bir panel sayfası eklendiğinde test kırmızı verir.
 */
export const PANEL_PATH_PREFIXES = [
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

/** Bu yol panele mi ait? (önek eşleşmesi — `/inbox/123` de panel sayılır) */
export function isPanelPath(pathname: string): boolean {
  return PANEL_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * İlk boyamadan ÖNCE koşan tema betiği.
 *
 * `<head>` içine HAM olarak gömülür: React hidrasyonu beklenirse kullanıcı
 * önce açık temayı, sonra karanlığı görür (flaş). Betik senkron ve boyamadan
 * önce koştuğu için flaş olmaz.
 *
 * ⚠️ YOL KONTROLÜ BURADA DA VAR — yalnız tercih değil, KAPSAM da ilk boyamada
 * doğru olmalı. Landing'e doğrudan girildiğinde sınıf hiç eklenmez.
 * ⚠️ CSP NOTU: bu satır-içi bir betiktir. Bugün `script-src` ENFORCE EDİLMİYOR
 * (report-only), o yüzden çalışıyor. Nonce turunu yapan kişi buna nonce
 * vermezse karanlık mod ilk boyamada bozulur — CSP'yi gevşetmek DEĞİL, nonce
 * eklemek doğru düzeltmedir.
 */
export function themeBootScript(): string {
  const prefixes = JSON.stringify(PANEL_PATH_PREFIXES);
  return `try{var p=${prefixes},n=location.pathname;if(p.some(function(x){return n===x||n.indexOf(x+"/")===0})){var t=localStorage.getItem(${JSON.stringify(
    THEME_STORAGE_KEY,
  )});if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark")}}catch(e){}`;
}
