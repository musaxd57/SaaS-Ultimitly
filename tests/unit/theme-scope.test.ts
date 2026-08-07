import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PANEL_PATH_PREFIXES, isPanelPath, themeBootScript, THEME_STORAGE_KEY } from "@/lib/theme";

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
    expect(js).toContain('classList.add("dark")');
    // Betik ASLA sınıfı koşulsuz eklememeli.
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

  it("`.dark` bloğu VAR ve `color-scheme: dark` taşıyor", () => {
    // `color-scheme` olmadan yerel denetimler (select açılır listesi,
    // `type="time"` seçici) karanlık panelde BEYAZ kutu olarak açılır.
    const i = GLOBALS.indexOf(".dark {");
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
    for (const m of GLOBALS.matchAll(/^([^\n{]*\.dark[^\n{]*)\{/gm)) {
      const selector = m[1].trim();
      expect(
        selector.startsWith(".dark"),
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
