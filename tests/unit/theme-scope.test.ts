// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PANEL_PATH_PREFIXES, isPanelPath, themeBootScript, THEME_STORAGE_KEY } from "@/lib/theme";
import { applyThemeClass } from "@/components/theme-scope";

// ---------------------------------------------------------------------------
// KARANLIK MOD KAPSAMI — YALNIZ PANEL.
//
// 🚨 BU DOSYANIN ASIL İŞİ: AÇIK MODUN BOZULAMAYACAĞINI PİNLEMEK.
// Kullanıcının açık isteği: "beyazı sakın bozmasına izin verme". Tasarım bunu
// iki yapısal kararla garanti ediyor ve ikisi de burada test ediliyor:
//   1. `:root` bloğuna HİÇ dokunulmaz — karanlık değerler AYRI bir `.dark`
//      bloğunda. Yani açık mod token'ları yeniden tanımlanmıyor.
//   2. Sabit renkler DEĞİŞTİRİLMEZ, yanlarına `dark:` KARDEŞİ eklenir. Açık
//      moddaki sınıf kaynakta olduğu gibi duruyor.
// Bu ikisi doğruyken açık modun değişmesi mümkün değildir.
// ---------------------------------------------------------------------------

const GLOBALS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

describe("kapsam — karanlık mod paneli AŞMAZ", () => {
  it("her `(app)` dizini panel öneki listesinde (dosya sisteminden türetildi)", () => {
    // Eksik bir sayfa = o sayfaya doğrudan girildiğinde ilk boyamada AÇIK tema,
    // sonra JS karartır → kullanıcının gördüğü şey bir FLAŞ.
    const dirs = readdirSync(join(process.cwd(), "src", "app", "(app)"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(dirs.length).toBeGreaterThan(5); // sağlama: grup gerçekten bulundu
    for (const dir of dirs) {
      expect(PANEL_PATH_PREFIXES, `panel yolu eksik: /${dir}`).toContain(`/${dir}`);
    }
  });

  it("panel DIŞI yollar karanlık moda girmez", () => {
    for (const p of ["/", "/login", "/register", "/gizlilik", "/mesafeli-satis", "/c/abc123", "/sifremi-unuttum"]) {
      expect(isPanelPath(p), `${p} panel sayılmamalı`).toBe(false);
    }
    // ...panel yolları ve ALT yolları girer.
    for (const p of ["/dashboard", "/inbox", "/inbox/abc", "/settings", "/properties/xyz/duzenle"]) {
      expect(isPanelPath(p), `${p} panel sayılmalı`).toBe(true);
    }
  });

  it("boot betiği HEM tercihi HEM kapsamı kontrol eder", () => {
    const js = themeBootScript();
    expect(js).toContain(THEME_STORAGE_KEY);
    expect(js).toContain("location.pathname"); // kapsam kontrolü
    expect(js).toContain("prefers-color-scheme"); // tercih yoksa OS'a bak
    // ⚠️ `add` DEĞİL `toggle` — betik simetrik olmak zorunda (↓ayrı test).
    expect(js).toContain('classList.toggle("dark"');
    // Kapsam kontrolü koşullu olmalı: sınıf KOŞULSUZ eklenmemeli.
    expect(js).not.toMatch(/^\s*document\.documentElement\.classList\.add/);
  });
});

describe("🚨 açık mod DOKUNULMAZ", () => {
  it("`:root` ve `.dark` AYRI bloklar — karanlık değerler root'a sızmamış", () => {
    const rootBlock = GLOBALS.slice(GLOBALS.indexOf(":root {"), GLOBALS.indexOf("}", GLOBALS.indexOf("--radius")));
    // Açık modun bilinen değerleri yerinde mi? (birkaç çapa yeterli — hepsi
    // değişseydi zaten bu üçü de değişirdi)
    expect(rootBlock).toContain("--background: 210 40% 98%");
    expect(rootBlock).toContain("--foreground: 222 47% 11%");
    expect(rootBlock).toContain("--primary: 222 47% 20%");
    expect(rootBlock).not.toContain(".dark");
  });

  it("karanlık token bloğu VAR ve `color-scheme: dark` taşıyor", () => {
    // `color-scheme` olmadan yerel denetimler (select açılır listesi,
    // `type="time"` seçici) karanlık panelde BEYAZ kutu olarak açılır.
    const i = GLOBALS.indexOf("html.dark {");
    expect(i, ".dark bloğu bulunamadı").toBeGreaterThan(-1);
    const darkBlock = GLOBALS.slice(i, GLOBALS.indexOf("\n  }", i));
    expect(darkBlock).toContain("color-scheme: dark");
    expect(darkBlock).toContain("--background:");
    expect(darkBlock).toContain("--muted-foreground:");
  });

  it("CSS'teki `.dark` kuralları HEP kapsamlı — çıplak override YOK", () => {
    // `.dark` ile başlamayan ama karanlığa özel bir kural, açık modu da
    // etkilerdi. Dosyadaki her `.dark` geçişi ya seçicinin başında ya da
    // `.dark ` öneki olarak bulunmalı.
    // ⚠️ Token bloğunun seçicisi `html.dark` (özgüllük 0,1,1). Çıplak `.dark`
    // ile `:root` AYNI özgüllükte (0,1,0) olurdu ve kazananı yalnız kaynak
    // sırası belirlerdi — bloklar bir gün yer değiştirirse karanlık mod
    // SESSİZCE ölürdü. Kabul edilen iki biçim: `html.dark` ve `.dark <alt>`.
    for (const m of GLOBALS.matchAll(/^([^\n{]*\.dark[^\n{]*)\{/gm)) {
      const selector = m[1].trim();
      expect(
        selector.startsWith(".dark ") || selector.startsWith("html.dark"),
        `kapsamsız karanlık kuralı: ${selector}`,
      ).toBe(true);
    }
  });

  it("Tailwind `darkMode: \\\"class\\\"` — `media` DEĞİL", () => {
    // "media" işletim sistemi tercihini HER sayfaya uygular; kapsam seçilemez
    // ve landing de kararırdı. Ayrıca varsayılan "media" iken kaynaktaki tek
    // bir eski `dark:` sınıfı canlıda zaten ateşleniyordu.
    const cfg = readFileSync(join(process.cwd(), "tailwind.config.ts"), "utf8");
    expect(cfg).toMatch(/darkMode:\s*"class"/);
  });
});

describe("🚨 SINIF KALDIRILIYOR MU — kaçak bu eksende oldu", () => {
  // Denetim ajanının bulduğu GERÇEK açık-mod kırılması: sınıfı kaldıran tek kod
  // `PanelTheme`'in unmount temizliğiydi. `/tasks/12345` (panel ÖNEKLİ ama var
  // olmayan yol) 404 → KÖK `not-found.tsx` render olur, `(app)` layout'u hiç
  // çalışmaz, `PanelTheme` hiç mount olmaz → temizlik hiç koşmaz. 404
  // sayfasındaki `<Link href="/">` istemci-taraflı gezindiği için boot betiği de
  // tekrar koşmaz ve LANDING KARANLIK AÇILIR.
  // Artık kapsam kök seviyedeki `ThemeScope`'ta ve MOUNT'a bağlı değil.
  const setPref = (v: string | null) => {
    if (v === null) localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, v);
  };

  it("panel yolunda tercih 'dark' ise sınıf EKLENİR", () => {
    setPref("dark");
    applyThemeClass("/dashboard");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("🚨 panel DIŞI yola geçince sınıf KALDIRILIR (asılı kalmaz)", () => {
    setPref("dark");
    applyThemeClass("/dashboard");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    // Landing'e istemci-taraflı gezinme — boot betiği KOŞMAZ.
    applyThemeClass("/");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("🚨 404 zinciri: /tasks/12345 → / (kaçağın tam senaryosu)", () => {
    setPref("dark");
    applyThemeClass("/tasks/12345"); // önek eşleşir, sınıf eklenir
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    applyThemeClass("/"); // 404'teki bağlantı istemci-taraflı gezinir
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("tercih 'light' iken panelde bile sınıf EKLENMEZ", () => {
    setPref("light");
    applyThemeClass("/inbox");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("localStorage okunamazsa AÇIK temaya düşer (güvenli yön)", () => {
    const orig = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      applyThemeClass("/dashboard");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    } finally {
      if (orig) Object.defineProperty(window, "localStorage", orig);
    }
  });

  it("boot betiği de SİMETRİK — panel dışında sınıfı kaldırır", () => {
    // Yalnız `add` yazmak, karanlık panelden tam sayfa yüklemeyle pazarlama
    // sayfasına geçildiğinde sınıfı asılı bırakabiliyordu.
    const js = themeBootScript();
    expect(js).toContain('classList.toggle("dark"');
    expect(js).not.toContain('classList.add("dark")');
  });
});

describe("🚨 DOLU ZEMİNİN ÇOCUĞU — ölçülmüş görünmezlik hatası", () => {
  // Denetim ajanı ölçtü: impersonation bandı karanlıkta da DOLU `bg-amber-500`
  // kalıyor (bilinçli dışlama), ama içindeki çıkış düğmesine script
  // `dark:bg-amber-500/15` eklemişti. amber-500'ün herhangi bir alfası
  // amber-500 üzerine binince TAM OLARAK amber-500 verir → dolgu 1.00:1,
  // kenarlık 1.00:1, düğme görünmez. Hover da kurtarmıyordu (`dark:` kuralı
  // sonra geldiği için `hover:bg-amber-200`ı eziyordu).
  // Operatörün impersonation'dan çıkmak için TEK yolu bu düğme.
  const shell = readFileSync(join(process.cwd(), "src/components/shell/app-shell.tsx"), "utf8");

  it("band DOLU amber kalır (dışlama korunuyor)", () => {
    expect(shell).toMatch(/bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950/);
    expect(shell).not.toMatch(/bg-amber-500 [^"]*dark:bg-/);
  });

  it("çıkış düğmesi DOLU bandın içinde — `dark:` kardeşi ALMAZ", () => {
    // 🚨 ÇAPA GUARD'I ŞART (08-09 (2)): `indexOf` -1 dönerse `slice(-1, 119)`
    // metnin SON KARAKTERİNİ verir ve `not.toContain("dark:")` trivially geçer —
    // yani sınıf adı bir refaktörde değişirse test SESSİZCE hiçbir şey
    // pinlemez ama YEŞİL kalır. Kardeş taramalarda bu guard zaten var.
    const at = shell.indexOf("border-amber-700");
    expect(at, "çapa bulunamadı — test sessizce boşa düşerdi").toBeGreaterThan(-1);
    const btn = shell.slice(at, at + 120);
    expect(btn, "dolu zeminin çocuğuna dark: eklenmiş — görünmez olur").not.toContain("dark:");
  });
});
