import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Migration listesi belgelerle uyumlu kalır (gece-4 S10-07 / S10-04 / S10-06): `docs/MIGRATION-MANIFEST.md` "TEK güncel kaynak" ama hiçbir şey
// onu klasörlere bağlamıyordu (74. satır iki kolondan birini sayıyordu, Railway belgesi "59–68" diyordu → açılışta yedek adımı eksik kalırdı).
// Klasör adı kuralı: `100_…` ad sırasında `10_…`dan ÖNCE gelir → taze veritabanında sıra bozulur; üç haneli ad yasak.
// ---------------------------------------------------------------------------

const ROOT = join(__dirname, "..", "..");
const folders = readdirSync(join(ROOT, "prisma", "migrations"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
const numbered = folders.filter((n) => /^\d+_/.test(n));
const no = (n: string) => Number(n.slice(0, n.indexOf("_")));

describe("migration manifesti ↔ klasörler", () => {
  it("anti-vakum: klasör listesi gerçekten okundu", () => {
    expect(numbered.length).toBeGreaterThan(70);
    expect(numbered).toContain("58_automated_message_send");
  });

  it("58 ve sonrası HER klasör manifest tablosunda adıyla geçer", () => {
    const manifest = readFileSync(join(ROOT, "docs", "MIGRATION-MANIFEST.md"), "utf8");
    const missing = numbered.filter((n) => no(n) >= 58 && !manifest.includes(`\`${n}\``));
    expect(missing).toEqual([]);
  });

  it("Railway açılış belgesi bekleyen aralığı güncel yazar (59–<son>)", () => {
    const last = Math.max(...numbered.map(no));
    const railway = readFileSync(join(ROOT, "docs", "RAILWAY-ACILIS-2026-10-15.md"), "utf8");
    expect(railway).toContain(`migration 59–${last}`);
  });

  it("klasör adı iki haneli (ya da 99'un ardına sıralanan) — `100_` ad sırasında `10_`dan önce gelir", () => {
    expect(numbered.filter((n) => /^\d{3,}_/.test(n))).toEqual([]);
    const sorted = [...numbered].sort();
    expect(sorted.map(no)).toEqual([...sorted.map(no)].sort((a, b) => a - b));
  });
});
