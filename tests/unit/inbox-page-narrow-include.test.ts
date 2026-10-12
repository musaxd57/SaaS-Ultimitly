import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Gelen kutusu konuşma sayfası mülk / rezervasyonu YALNIZ kullandığı alanlarla okur (DENETIM 08-09 #10 / ACIK-08 §15). `property: true`
// sunucuya `icalToken` / `chatToken` gibi erişim sırlarını çekiyordu; istemciye bugün yalnız projeksiyon gidiyor, daraltma savunma
// derinliği. Tür sistemi kullanılan alanları zorlar; bu yapısal pin genişletilmiş `include`un geri gelmesini yakalar.
// ---------------------------------------------------------------------------
describe("gelen kutusu konuşma sayfası — dar include", () => {
  // Yorumlar ayıklanır: gerekçe yorumu eski `property: true` biçimini ve sır alan adlarını ANAR (Haiku 10-12: ham kaynakla test kırmızıydı).
  const src = readFileSync("src/app/(app)/inbox/[id]/page.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  it("🚨 property / reservation `true` ile okunmaz; erişim sırları seçilmez", () => {
    expect(src).not.toMatch(/property:\s*true/);
    expect(src).not.toMatch(/reservation:\s*true/);
    expect(src).not.toMatch(/icalToken|chatToken/);
  });
  it("anti-vakumluk: sorgu dosyada ve dar seçimle", () => {
    expect(src).toMatch(/prisma\.conversation\.findFirst/);
    expect(src).toMatch(/property:\s*\{\s*select:/);
  });
});
