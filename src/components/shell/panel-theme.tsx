"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { THEME_STORAGE_KEY } from "@/lib/theme";

// ---------------------------------------------------------------------------
// PANEL TEMASI — sınıfın SAHİBİ bu bileşendir.
//
// 🚨 ÇIKIŞTA SINIF KALDIRILIR. Karanlık mod yalnız panelde geçerli; kullanıcı
// panelden landing'e ya da hukuk sayfasına geçtiğinde `(app)` layout'u unmount
// olur ve `dark` sınıfı `<html>`'den silinir. Temizlik YAPILMASAYDI sınıf
// asılı kalır ve pazarlama sayfası da kararırdı — kapsam kararının tek
// uygulama noktası burasıdır.
//
// İlk boyama `themeBootScript` tarafından zaten halledilmiş oluyor; bu bileşen
// (a) o kararı React tarafında da bilinir kılar ve (b) düğmeyi sağlar.
// ---------------------------------------------------------------------------

export function PanelTheme() {
  // `null` = henüz bilinmiyor (SSR + ilk render). Bu üçüncü durum ŞART:
  // sunucuda `localStorage` yok, ikon `useState(false)` ile başlasaydı
  // karanlık tercihli kullanıcıda hidrasyon uyuşmazlığı olurdu.
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    // ⚠️ KAPSAM SORUMLULUĞU BURADA DEĞİL — `ThemeScope` (kök layout) yönetiyor.
    // Eskiden sınıfı bu bileşen kaldırıyordu ve 404/hata sayfalarında hiç mount
    // olmadığı için karanlık sınıf landing'e SIZIYORDU (ölçüldü). Burada yalnız
    // düğmenin ikonu için DOM'daki gerçeği okuyoruz.
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    setDark(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Gizli sekmede localStorage atabilir — tercih o oturumda yaşar, sorun değil.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      // Durum bilinmeden ikon çizilmez (yanlış ikon bir an görünmesin).
      aria-label={dark ? "Açık temaya geç" : "Koyu temaya geç"}
      title={dark ? "Açık tema" : "Koyu tema"}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {dark === null ? (
        <span className="size-4" aria-hidden="true" />
      ) : dark ? (
        <Sun className="size-4" aria-hidden="true" />
      ) : (
        <Moon className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}
