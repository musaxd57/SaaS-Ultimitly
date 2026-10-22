import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Raporlar sayfası telefonda yana kaymaz (görsel inceleme 10-22, Chromium 320 / 390 px): ikinci ızgara telefonda sütun tanımsızdı → örtük
// `auto` sütun en uzun daire adı kadar genişliyor, "Doluluk (daireye göre)" satırındaki `truncate` hiç devreye girmiyordu. Uzun daire adıyla
// sayfa 587 px'e taşıyordu; `grid-cols-1` (minmax(0, 1fr)) ile 320 / 390 px'te taşma 0 (17 panel sayfası + QR aynı taramada temiz).
// Sayfa veritabanlı sunucu bileşeni — jsdom'da çizilemez; sınıf sözleşmesi kaynaktan pinlenir.
// ---------------------------------------------------------------------------

const PAGE = readFileSync(join(process.cwd(), "src/app/(app)/reports/page.tsx"), "utf8");

describe("raporlar ızgarası dar ekranda", () => {
  it("doluluk kartını taşıyan ızgara telefonda tek `minmax(0,1fr)` sütun", () => {
    const occupancy = PAGE.indexOf("Doluluk (daireye göre)");
    expect(occupancy).toBeGreaterThan(0);
    const gridOpen = PAGE.lastIndexOf('<div className="grid', occupancy);
    const gridClass = /className="([^"]*)"/.exec(PAGE.slice(gridOpen))?.[1] ?? "";
    expect(gridClass.split(/\s+/)).toEqual(expect.arrayContaining(["grid", "grid-cols-1", "lg:grid-cols-2"]));
  });

  it("daire adı kırpılır (truncate + min-w-0) — sütun genişliğini adın uzunluğu belirlemez", () => {
    expect(PAGE).toMatch(/<span className="min-w-0 truncate font-medium">\{o\.propertyName\}<\/span>/);
  });
});
