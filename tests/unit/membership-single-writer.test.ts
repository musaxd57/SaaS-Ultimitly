import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { DEMO_ID_PREFIX, DEMO_ORG_ID } from "@/lib/demo-tenant/constants";
import { DEMO_ID_PREFIX_FOR_MEMBERSHIP, DEMO_ORG_ID_FOR_MEMBERSHIP } from "@/lib/membership/write";

// ---------------------------------------------------------------------------
// M-2 dilim 1: kullanıcı ve üyelik YALNIZ tek yazıcıdan (`src/lib/membership/write.ts`) yaratılır / üyelik yalnız oradan yazılır — yoksa
// okuyucular üyeliğe geçince (dilim 3) bir yoldan açılan kullanıcı üyeliksiz kalır (oturumu düşer) ya da ayna ile üyelik ayrışır.
// Kaynak taraması tek yönlüdür (davranış `tests/integration/membership-slice1.test.ts`'te); bu pin yalnız YENİ bir yazım yolunu yakalar.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const WRITER = "src/lib/membership/write.ts";
const SCAN_DIRS = ["src", "scripts"];
const EXTRA_FILES = ["prisma/seed.ts"];
const USER_CREATE = /\.user\.(create|createMany|createManyAndReturn|upsert)\s*\(|\busers\s*:\s*\{\s*(create|createMany|connectOrCreate)\b/;
const MEMBERSHIP_WRITE = /\.membership\.(create|createMany|createManyAndReturn|upsert|update|updateMany)\s*\(|\bmemberships\s*:\s*\{\s*(create|createMany|connectOrCreate)\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

const FILES = [...SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))), ...EXTRA_FILES.map((f) => join(ROOT, f))].map((p) => relative(ROOT, p));

describe("üyelik — tek yazıcı", () => {
  it("ANTİ-VAKUM: tarama dosya görüyor ve yazıcının kendisi iki kalıbı da içeriyor", () => {
    expect(FILES.length).toBeGreaterThan(300);
    const writer = readFileSync(join(ROOT, WRITER), "utf8");
    expect(USER_CREATE.test(writer)).toBe(true);
    expect(MEMBERSHIP_WRITE.test(writer)).toBe(true);
  });

  it("🚨 kullanıcı yaratan başka yol yok", () => {
    const offenders = FILES.filter((f) => f !== WRITER && USER_CREATE.test(readFileSync(join(ROOT, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("🚨 üyeliği yazan başka yol yok", () => {
    const offenders = FILES.filter((f) => f !== WRITER && MEMBERSHIP_WRITE.test(readFileSync(join(ROOT, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("yazıcının demo sabitleri demo modülüyle AYNI (yazıcı sunucu yolunu içe aktarmadığı için kopya)", () => {
    expect(DEMO_ORG_ID_FOR_MEMBERSHIP).toBe(DEMO_ORG_ID);
    expect(DEMO_ID_PREFIX_FOR_MEMBERSHIP).toBe(DEMO_ID_PREFIX);
  });
});
