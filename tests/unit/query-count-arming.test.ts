import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// SORGU SAYAN TEST SAYACI BARİYERLE AÇAR (11-25). Prisma'nın sorgu olayı sonuçtan SONRA gelebilir: sayaç `counter.on = true` ile
// açılırsa hazırlığın son sorgusunun olayı ölçüme düşer (tam kapıda bir kez 8 yerine 9 sorgu; yük altında 200 turda 1 — ölçüldü).
// Kendi sorgu dinleyicisini kuran her test sayacı `beginQueryCount` ile açar, `flushQueryEvents` ile kapatır
// (`tests/helpers/query-event-barrier.ts`). Bu pin çıplak açılışın geri gelmesini yakalar.
// ---------------------------------------------------------------------------

const DIR = join(process.cwd(), "tests", "integration");
const listeners = readdirSync(DIR)
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => ({ f, src: readFileSync(join(DIR, f), "utf8") }))
  .filter(({ src }) => /level:\s*"query"/.test(src));

describe("sorgu sayan testler — sayaç bariyerle açılır", () => {
  it("anti-vakum: sorgu olayı dinleyen test dosyaları bulunuyor", () => {
    expect(listeners.length).toBeGreaterThanOrEqual(6);
  });

  it.each(listeners.map((l) => [l.f, l.src] as const))("%s: çıplak `counter.on = true` yok; beginQueryCount + flushQueryEvents var", (_f, src) => {
    expect(src).not.toMatch(/counter\.on\s*=\s*true/);
    expect(src).toMatch(/beginQueryCount\(/);
    expect(src).toMatch(/flushQueryEvents\(/);
  });
});
