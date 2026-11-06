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
const USER_CREATE = /\.user\.(create|createMany|createManyAndReturn|upsert)\s*\(|\busers?\s*:\s*\{\s*(create|createMany|connectOrCreate)\b/;
// Silme de YAZIMDIR (Opus S3): bugün üyelik satırını silen yol YOK (çıkarma = `revoked` + kuşak). Satırı silip aynı (kişi, işletme) için
// yeniden yaratan bir yol, iddiasız eski belirteci yeni satırın kuşak 0'ıyla eşleştirip çıkarılmış oturumu DİRİLTİR → o yol ancak iddiasız
// belirteçlere son tarih konduktan SONRA (tasarım §10.1) ve bu pin bilinçli güncellenerek eklenir. (Kullanıcı / işletme silinince Cascade
// satırı götürür — kimlik kalmaz, yeniden yaratılamaz; o yol bu kalıba girmez.)
const MEMBERSHIP_WRITE =
  /\.membership\.(create|createMany|createManyAndReturn|upsert|update|updateMany|updateManyAndReturn|delete|deleteMany)\s*\(|\bmemberships\s*:\s*\{\s*(create|createMany|connectOrCreate|connect|upsert|update|updateMany|delete|deleteMany|set|disconnect)\b/;
// Ham SQL ile üyelik yazımı da aynı kurala tabi. Tek istisna onarım çekirdeği: migration 94'ün ifadesini DOSYADAN okuyup koşar (tek kaynak,
// kopya yok); kendi SQL'i yalnız okuma (kalıp eşleşmesi ifadeyi doğrulayan düzenli ifadeden ve hata metninden).
const MEMBERSHIP_RAW_WRITE = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(\s+TABLE)?)\s+("?public"?\s*\.\s*)?"Membership"/i;
const RAW_WRITE_EXCEPTIONS: Record<string, string> = {
  "src/lib/membership/backfill-core.ts": "migration 94'ün ifadesini dosyadan koşar (scripts/membership-backfill.ts, Opus S5)",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|cts|mjs|cjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

const FILES = [...SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))), ...EXTRA_FILES.map((f) => join(ROOT, f))].map((p) => relative(ROOT, p));

describe("üyelik — tek yazıcı", () => {
  it("ANTİ-VAKUM: tarama dosya görüyor ve yazıcının kendisi iki kalıbı da içeriyor; ham SQL kalıbı migration 94'ü tanır", () => {
    expect(FILES.length).toBeGreaterThan(300);
    const writer = readFileSync(join(ROOT, WRITER), "utf8");
    expect(USER_CREATE.test(writer)).toBe(true);
    expect(MEMBERSHIP_WRITE.test(writer)).toBe(true);
    expect(MEMBERSHIP_RAW_WRITE.test(readFileSync(join(ROOT, "prisma/migrations/94_membership_backfill_repeat/migration.sql"), "utf8"))).toBe(true);
    // Silme kalıbı gerçekten yakalıyor (yalnız yaratmayı değil).
    expect(MEMBERSHIP_WRITE.test("await tx.membership.deleteMany({ where: { userId } })")).toBe(true);
    expect(MEMBERSHIP_WRITE.test("data: { memberships: { delete: { id } } }")).toBe(true);
    expect(MEMBERSHIP_WRITE.test("where: { memberships: { none: {} } }")).toBe(false);
    expect(MEMBERSHIP_RAW_WRITE.test('DELETE FROM "public"."Membership" WHERE 1=1')).toBe(true);
    expect(MEMBERSHIP_RAW_WRITE.test('SELECT 1 FROM "Membership" m')).toBe(false);
    expect(USER_CREATE.test("data: { user: { create: { email } } }")).toBe(true);
  });

  it("🚨 kullanıcı yaratan başka yol yok", () => {
    const offenders = FILES.filter((f) => f !== WRITER && USER_CREATE.test(readFileSync(join(ROOT, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("🚨 üyeliği yazan (ya da SİLEN) başka yol yok", () => {
    const offenders = FILES.filter((f) => f !== WRITER && MEMBERSHIP_WRITE.test(readFileSync(join(ROOT, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("🚨 ham SQL ile üyelik yazan başka yol yok (istisna listesi gerekçeli ve güncel)", () => {
    const offenders = FILES.filter((f) => !(f in RAW_WRITE_EXCEPTIONS) && MEMBERSHIP_RAW_WRITE.test(readFileSync(join(ROOT, f), "utf8")));
    expect(offenders).toEqual([]);
    for (const f of Object.keys(RAW_WRITE_EXCEPTIONS)) expect(FILES).toContain(f);
  });

  it("yazıcının demo sabitleri demo modülüyle AYNI (yazıcı sunucu yolunu içe aktarmadığı için kopya)", () => {
    expect(DEMO_ORG_ID_FOR_MEMBERSHIP).toBe(DEMO_ORG_ID);
    expect(DEMO_ID_PREFIX_FOR_MEMBERSHIP).toBe(DEMO_ID_PREFIX);
  });
});
