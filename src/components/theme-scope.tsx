"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isPanelPath, THEME_STORAGE_KEY } from "@/lib/theme";

// ---------------------------------------------------------------------------
// TEMA KAPSAMININ TEK SORUMLUSU — KÖK layout'ta mount edilir.
//
// 🚨 NEDEN PANEL LAYOUT'UNDA DEĞİL: ilk tasarımda sınıfı `PanelTheme` ekliyor ve
// unmount'ta kaldırıyordu. Denetim ajanı bunun AÇIK MODU BOZDUĞU bir yol buldu
// ve doğrulandı:
//   1. Boot betiği `/tasks/12345` gibi PANEL ÖNEKLİ ama var olmayan bir yolda da
//      `dark` sınıfını ekliyor (önek eşleşmesi rotayı bilmez).
//   2. O yol 404 → KÖK `not-found.tsx` render olur, `(app)` layout'u ÇALIŞMAZ,
//      yani `PanelTheme` hiç mount olmaz.
//   3. Sınıfı kaldıran TEK kod `PanelTheme`'in unmount temizliğiydi — hiç
//      mount olmadığı için hiç koşmaz.
//   4. 404 sayfasındaki `<Link href="/">` istemci-taraflı gezinme yapar (belge
//      yeniden yüklenmez, boot betiği tekrar koşmaz) → LANDING KARANLIK AÇILIR.
// Aynı kapı `(app)/layout.tsx` içinde bir hata fırlarsa da açılıyordu (kök
// `error.tsx` de panel ağacının dışında).
//
// Çözüm: kapsam artık BİR BİLEŞENİN MOUNT OLMASINA bağlı değil. Bu bileşen kök
// layout'ta duruyor ve HER yol değişiminde doğru durumu YENİDEN KURUYOR —
// panelde ekliyor, panel dışında kaldırıyor. İki yön de tek yerde.
//
// ⚠️ Yan kazanç (ikinci ölçülmüş kusur): eskiden `classList.add` YALNIZ boot
// betiğindeydi, yani yalnız TAM SAYFA yüklemelerinde. Girişten sonra
// `router.push("/dashboard")` istemci-taraflı olduğu için panel, tercihi
// "dark" olmasına rağmen AÇIK açılıyordu (kullanıcı elle düğmeye basana ya da
// sayfayı yenileyene kadar). Artık yol değişimi yeterli.
// ---------------------------------------------------------------------------

/** Tercih + kapsam → `<html>` üzerindeki sınıf. Tek karar noktası. */
export function applyThemeClass(pathname: string): void {
  let wantsDark = false;
  if (isPanelPath(pathname)) {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      wantsDark =
        stored === "dark" ||
        (stored === null && window.matchMedia("(prefers-color-scheme: dark)").matches);
    } catch {
      // Gizli sekmede localStorage atabilir → AÇIK tema. Hata hâlinde güvenli
      // yön açıktır: karanlık modun yanlışlıkla açılması, kapalı kalmasından
      // daha görünür bir arızadır.
      wantsDark = false;
    }
  }
  document.documentElement.classList.toggle("dark", wantsDark);
}

export function ThemeScope() {
  const pathname = usePathname();
  useEffect(() => {
    applyThemeClass(pathname);
  }, [pathname]);
  return null;
}
