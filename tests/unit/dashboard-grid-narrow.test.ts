import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Ana sayfa (pano) telefonda yana kaymaz (ajan turu 11-04, S-18; doğrulayıcı onayladı). Raporlar sayfasında 10-22'de düzeltilen hatanın
// aynısı: girişler / bekleyen mesajlar ızgarası telefonda sütun tanımsızdı → örtük `auto` sütun en uzun daire adı ya da boşluksuz misafir
// metni (uzun bağlantı) kadar genişliyor, `truncate` devreye girmiyordu. `grid-cols-1` (minmax(0, 1fr)) + önizleme satırında uzun sözcük
// kırılır. Sayfa veritabanlı sunucu bileşeni — jsdom'da çizilemez; sınıf sözleşmesi kaynaktan pinlenir (`reports-grid-narrow` emsali).
// ---------------------------------------------------------------------------

const PAGE = readFileSync(join(process.cwd(), "src/app/(app)/dashboard/page.tsx"), "utf8");

function gridClassBefore(anchor: string): string[] {
  const at = PAGE.indexOf(anchor);
  expect(at).toBeGreaterThan(0);
  const gridOpen = PAGE.lastIndexOf('<div className="grid', at);
  return (/className="([^"]*)"/.exec(PAGE.slice(gridOpen))?.[1] ?? "").split(/\s+/);
}

describe("pano ızgarası dar ekranda", () => {
  it("girişler + bekleyen mesajlar ızgarası telefonda tek `minmax(0,1fr)` sütun", () => {
    expect(gridClassBefore("{/* Arrivals */}")).toEqual(expect.arrayContaining(["grid", "grid-cols-1", "lg:grid-cols-2"]));
    // Aynı ızgara "Bekleyen Mesajlar" kartını da taşır (ayrı bir ızgaraya taşınırsa bu pin onu da ister).
    expect(gridClassBefore("Bekleyen Mesajlar")).toEqual(expect.arrayContaining(["grid-cols-1"]));
  });

  it("bekleyen mesaj önizlemesi uzun sözcükte (bağlantı) satır kırar", () => {
    const at = PAGE.indexOf("truncate(c.messages[0].body, 70)");
    expect(at).toBeGreaterThan(0);
    const pOpen = PAGE.lastIndexOf("<p className=", at);
    const cls = /<p className="([^"]*)"/.exec(PAGE.slice(pOpen))?.[1] ?? "";
    expect(cls.split(/\s+/)).toContain("break-words");
  });
});
