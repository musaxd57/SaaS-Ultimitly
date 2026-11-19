import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// İÇ NOT — TEK YAZICI (dilim D1). `InternalNote` satırını OLUŞTURAN tek modül `src/lib/internal-notes/service.ts`. Başka bir yol (ör. bir
// konuşma rotası, yapay zekâ akışı) not yazarsa bağ çözümü, metin sınırı, tekrar güvenliği ve denetim kaydı atlanır. Silme / taşıma yapan
// gizlilik yolları (saklama süresi, silme talebi, konuşma birleştirme, demo sıfırlama) bilinçli istisnadır — onlar OLUŞTURMAZ.
// Kaynak taraması tek yönlüdür; davranış `tests/integration/internal-notes.test.ts`te.
// ---------------------------------------------------------------------------

const SRC = path.resolve(__dirname, "../../src");
const WRITER = "lib/internal-notes/service.ts";
const CREATE = /\binternalNote\s*\.\s*(create|createMany|createManyAndReturn|upsert)\s*\(/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = path.join(dir, e);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(e)) out.push(full);
  }
  return out;
}

describe("iç not — tek yazıcı", () => {
  const files = walk(SRC).map((f) => [path.relative(SRC, f).split(path.sep).join("/"), readFileSync(f, "utf8")] as const);

  it("anti-vakum: tarama dosya buldu ve yazıcı gerçekten not oluşturuyor", () => {
    expect(files.length).toBeGreaterThan(100);
    const writer = files.find(([rel]) => rel === WRITER);
    expect(writer).toBeDefined();
    expect(CREATE.test(writer![1])).toBe(true);
  });

  it("🚨 `internalNote` OLUŞTURAN başka modül yok", () => {
    const offenders = files.filter(([rel, text]) => rel !== WRITER && CREATE.test(text)).map(([rel]) => rel);
    expect(offenders).toEqual([]);
  });
});
