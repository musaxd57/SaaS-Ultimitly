// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LixusBuilding } from "@/components/marketing/lixus-building";

// ---------------------------------------------------------------------------
// Canlı bina — hero dekoru. Buradaki pinler görselden çok KARARLARI korur:
// butonsuzluk, sıfır-JS ve "dekor ekran okuyucuya anlatılmaz" üçlüsü bilinçli
// tasarım kararları; biri sessizce geri gelirse (örn. Codex'in ilk patch'indeki
// "Sinyali göster" düğmesi) test kırmızıya döner.
// ---------------------------------------------------------------------------

afterEach(cleanup);

describe("LixusBuilding", () => {
  it("22 pencere + kapı + cephe tabelası render olur", () => {
    render(<LixusBuilding />);
    expect(screen.getAllByTestId("lxb-window")).toHaveLength(22);
    expect(screen.getByTestId("lxb-door")).toBeTruthy();
    expect(screen.getByText("LIXUS AI")).toBeTruthy();
  });

  it("KARAR PİNİ: buton yok, dekor ekran okuyucudan gizli, yalnız ≥xl görünür", () => {
    const { container } = render(<LixusBuilding />);
    // Ürün kararı: dekora buton koymak gerçek CTA ile yarışır — asla geri gelmesin.
    expect(screen.queryByRole("button")).toBeNull();
    const root = container.firstElementChild!;
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(root.className).toContain("hidden");
    expect(root.className).toContain("xl:block");
  });

  it("KARAR PİNİ: sıfır JavaScript — server component, zamanlayıcı yok", () => {
    // Sahnenin tüm davranışı globals.css'teki lxb-* animasyonları; komponent
    // "use client" olursa ya da timer kazanırsa landing'e JS binmeye başlar.
    const src = readFileSync("src/components/marketing/lixus-building.tsx", "utf8");
    // Direktif biçimi: satır başında duran "use client" — yorumda geçen
    // sözcükler değil (komponentin kendi açıklaması bu kararı anlatıyor).
    expect(src).not.toMatch(/^\s*["']use client["']/m);
    expect(src).not.toMatch(/setTimeout|setInterval|useEffect|useState/);
  });

  it("ENTEGRASYON PİNİ: hero binayı tam bir kez bağlar", () => {
    const landing = readFileSync("src/components/marketing/landing-page.tsx", "utf8");
    expect(landing.match(/<LixusBuilding \/>/g)).toHaveLength(1);
  });
});
