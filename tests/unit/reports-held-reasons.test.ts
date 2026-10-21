import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Kurucu W9 (10-21): "size bırakıldı" toplamı HELD_REASONS'taki her sebebi sayar; her sebebin raporda bir satırı olmalı — yoksa toplam
// satırların toplamından büyük görünür (tehlike / güvence / acil yönlendirme satırsızdı).
describe("Raporlar — tutulan sebeplerin her birinin satırı var", () => {
  const src = readFileSync(join(process.cwd(), "src/app/(app)/reports/page.tsx"), "utf8");
  const list = /const HELD_REASONS = \[([\s\S]*?)\];/.exec(src)?.[1] ?? "";
  const reasons = [...list.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  it("liste okunabildi (vakumlu değil)", () => {
    expect(reasons.length).toBeGreaterThan(10);
    expect(reasons).toContain("physical_hazard");
  });
  it.each(reasons.map((r) => [r]))("%s raporda gösteriliyor", (r) => {
    expect(src).toContain(`heldCount("${r}")`);
  });
});
