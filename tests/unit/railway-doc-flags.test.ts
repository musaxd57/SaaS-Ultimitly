import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// HER DAVRANIŞ ANAHTARI RAILWAY AÇILIŞ BELGESİNDE ADIYLA GEÇER — KAYNAK PİNİ (gece-4 S10-04 / S5-12, 10-18).
//
// Kurucu (10-09): "bayrağı unutturma". Railway kapalıyken eklenen anahtarlar (`*_ENABLED`) açılışta tek listeden okunur:
// `docs/RAILWAY-ACILIS-2026-10-15.md`. Gece-4 incelemesi belgede eksik anahtarlar buldu (açılışta unutulurdu; kimi bir başkasının ön şartı).
// Bu pin yeni bir anahtar eklenip belgeye yazılmadığında kırmızı verir. Sayısal ayarlar / sırlar kapsam dışı (adı `_ENABLED` ile bitmez).
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../..");
const DOC = readFileSync(path.join(ROOT, "docs", "RAILWAY-ACILIS-2026-10-15.md"), "utf8");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const flags = new Set<string>();
for (const file of sourceFiles(path.join(ROOT, "src"))) {
  for (const m of readFileSync(file, "utf8").matchAll(/process\.env\.([A-Z0-9_]+_ENABLED)\b/g)) flags.add(m[1]!);
}

describe("Railway açılış belgesi ↔ koddaki anahtarlar", () => {
  it("anti-vakum: tarama gerçekten anahtar buluyor (bilinen anahtarlar listede)", () => {
    expect(flags.size).toBeGreaterThan(40);
    expect([...flags]).toEqual(expect.arrayContaining(["HOST_COMMITMENT_AUTO_ENABLED", "DURABLE_OUTBOX_ENABLED", "QR_PIN_ENABLED"]));
  });

  it("koddaki her `*_ENABLED` anahtarı belgede adıyla geçer", () => {
    const missing = [...flags].filter((f) => !new RegExp(`(?<![A-Z0-9_])${f}(?![A-Z0-9_])`).test(DOC)).sort();
    expect(missing).toEqual([]);
  });
});
