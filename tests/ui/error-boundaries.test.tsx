// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Hata ekranları (Codex P3).
//
// (1) `(app)` altında bir sayfa patladığında EN YAKIN error boundary kök
//     `app/error.tsx` idi — o da `(app)/layout.tsx`in DIŞINDA. Sonuç: host
//     tek bir hatada uygulama kabuğunu (sol menü, üst bar, kimlik) tamamen
//     kaybedip boş bir tam-ekran hata sayfasına düşüyordu. Panele dönmenin tek
//     yolu "Ana sayfa" → pazarlama sitesiydi.
//     Segment içi `(app)/error.tsx` layout'u AYAKTA tutar (Next.js: error.tsx
//     yalnız segmentin ÇOCUKLARINI sarar, kendi layout'unu değil).
//
// (2) Kök layout'un kendisi patlarsa Next yerleşik ekranı basar: İngilizce,
//     markasız, "Application error: a client-side exception has occurred".
//     `global-error.tsx` yoksa Türk host bunu görür.
//
// Dosya varlığı da pinlenir: bir yeniden düzenlemede boundary sessizce
// kaybolursa test kırmızıya döner (robots/sitemap fs-drift pini ile aynı fikir).
// ---------------------------------------------------------------------------

const appDir = path.join(process.cwd(), "src", "app");

describe("hata sınırları — dosya yerleşimi", () => {
  it("(app) segmentinin KENDİ error boundary'si var (kabuk korunur)", () => {
    expect(fs.existsSync(path.join(appDir, "(app)", "error.tsx"))).toBe(true);
  });

  it("kök layout patlarsa Türkçe global-error devreye girer", () => {
    expect(fs.existsSync(path.join(appDir, "global-error.tsx"))).toBe(true);
  });
});

describe("(app)/error.tsx — panel içi hata ekranı", () => {
  beforeEach(cleanup);

  it("hatayı DUYURUR, tekrar denemeyi ve PANELE dönmeyi sunar", async () => {
    const { default: AppError } = await import("@/app/(app)/error");
    const reset = vi.fn();
    render(<AppError error={Object.assign(new Error("boom"), { digest: "d1" })} reset={reset} />);

    // Ekran okuyucu için duyuru; sessiz bir kutu değil.
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Tekrar dene/ }));
    expect(reset).toHaveBeenCalledTimes(1);

    // Kullanıcıyı pazarlama sitesine değil, PANELE geri gönderir.
    const back = screen.getByRole("link", { name: /Panele dön/ });
    expect(back.getAttribute("href")).toBe("/dashboard");
  });

  it("hata mesajının ham içeriğini EKRANA basmaz (yalnız digest referansı)", async () => {
    const { default: AppError } = await import("@/app/(app)/error");
    render(
      <AppError
        error={Object.assign(new Error("SELECT * FROM users -- gizli"), { digest: "abc123" })}
        reset={() => {}}
      />,
    );
    expect(document.body.textContent).not.toContain("SELECT * FROM users");
    expect(document.body.textContent).toContain("abc123"); // destek için referans
  });
});

describe("global-error.tsx — kök layout hatası", () => {
  beforeEach(cleanup);

  it("Türkçe metin ve tekrar deneme sunar", async () => {
    const { default: GlobalError } = await import("@/app/global-error");
    const reset = vi.fn();
    // Kendi <html>/<body> etiketlerini render eder; jsdom bunu iç içe kabul
    // eder, biz yalnız içerik sözleşmesini doğruluyoruz.
    render(<GlobalError error={Object.assign(new Error("boom"), { digest: "g1" })} reset={reset} />);

    expect(document.body.textContent).toContain("Bir şeyler ters gitti");
    fireEvent.click(screen.getByRole("button", { name: /Tekrar dene/ }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
