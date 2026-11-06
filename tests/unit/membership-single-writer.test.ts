import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Prisma } from "@prisma/client";
import { DEMO_ID_PREFIX, DEMO_ORG_ID } from "@/lib/demo-tenant/constants";
import { DEMO_ID_PREFIX_FOR_MEMBERSHIP, DEMO_ORG_ID_FOR_MEMBERSHIP } from "@/lib/membership/write";

// ---------------------------------------------------------------------------
// M-2 dilim 1: kullanıcı ve üyelik YALNIZ tek yazıcıdan (`src/lib/membership/write.ts`) yaratılır / üyelik yalnız oradan yazılır — yoksa
// okuyucular üyeliğe geçince (dilim 3) bir yoldan açılan kullanıcı üyeliksiz kalır (oturumu düşer) ya da ayna ile üyelik ayrışır.
// Kaynak taraması tek yönlüdür (davranış `tests/integration/membership-slice1.test.ts`'te); bu pin yalnız YENİ bir yazım yolunu yakalar.
// İlişki adları ŞEMADAN türetilir (Opus R5): `assignedTo: { create }` gibi başka adlı bir ilişkiyle kullanıcı yaratmak da yakalanır; yeni bir
// ilişki eklenince liste kendiliğinden genişler.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const WRITER = "src/lib/membership/write.ts";
const SCAN_DIRS = ["src", "scripts"];
const EXTRA_FILES = ["prisma/seed.ts"];

const relationNames = (type: string) =>
  [...new Set(Prisma.dmmf.datamodel.models.flatMap((m) => m.fields.filter((f) => f.kind === "object" && f.type === type).map((f) => f.name)))].sort();
const USER_RELATIONS = relationNames("User");
const MEMBERSHIP_RELATIONS = relationNames("Membership");

const USER_CREATE = new RegExp(
  String.raw`\.user\.(create|createMany|createManyAndReturn|upsert)\s*\(|\b(${USER_RELATIONS.join("|")})\s*:\s*\{\s*(create|createMany|connectOrCreate|upsert)\b`,
);
// Silme de YAZIMDIR (Opus S3): bugün üyelik satırını silen yol YOK (çıkarma = `revoked` + kuşak). Satırı silip aynı (kişi, işletme) için
// yeniden yaratan bir yol, iddiasız eski belirteci yeni satırın kuşak 0'ıyla eşleştirip çıkarılmış oturumu DİRİLTİR → o yol ancak iddiasız
// belirteçlere son tarih konduktan SONRA (tasarım §10.1) ve bu pin bilinçli güncellenerek eklenir. (Kullanıcı / işletme silinince Cascade
// satırı götürür — kimlik kalmaz, yeniden yaratılamaz; o yol bu kalıba girmez.)
const MEMBERSHIP_WRITE = new RegExp(
  String.raw`\.membership\.(create|createMany|createManyAndReturn|upsert|update|updateMany|updateManyAndReturn|delete|deleteMany)\s*\(|` +
    String.raw`\b(${MEMBERSHIP_RELATIONS.join("|")})\s*:\s*\{\s*(create|createMany|connectOrCreate|connect|upsert|update|updateMany|delete|deleteMany|set|disconnect)\b`,
);
const MEMBERSHIP_DELETE = new RegExp(
  String.raw`\.membership\.(delete|deleteMany)\s*\(|\b(${MEMBERSHIP_RELATIONS.join("|")})\s*:\s*\{\s*(delete|deleteMany|set|disconnect)\b`,
);
// Ham SQL ile üyelik yazımı ve kullanıcı YARATIMI da aynı kurala tabi (Opus R5: `ONLY` / `MERGE` / `COPY` ve şema nitelikli ad dahil).
const SCHEMA = String.raw`("?public"?\s*\.\s*)?`;
const MEMBERSHIP_RAW_WRITE = new RegExp(
  String.raw`\b(INSERT\s+INTO|UPDATE(\s+ONLY)?|DELETE\s+FROM(\s+ONLY)?|TRUNCATE(\s+TABLE)?(\s+ONLY)?|MERGE\s+INTO|COPY)\s+${SCHEMA}"Membership"`,
  "i",
);
const USER_RAW_CREATE = new RegExp(String.raw`\b(INSERT\s+INTO|MERGE\s+INTO|COPY)\s+${SCHEMA}"User"`, "i");
// Tek istisna onarım çekirdeği: migration 94'ün ifadesini DOSYADAN okuyup koşar (tek kaynak, kopya yok); kendi SQL'i yalnız okuma. Eşleşme
// SAYISI sabit (Opus R5: dosya düzeyi istisna yeni bir ham yazımı da geçirirdi) — belge satırı, ifadeyi doğrulayan düzenli ifade, hata metni.
const RAW_WRITE_EXCEPTIONS: Record<string, { lines: number; why: string }> = {
  "src/lib/membership/backfill-core.ts": { lines: 3, why: "migration 94'ün ifadesini dosyadan koşar (scripts/membership-backfill.ts, Opus S5)" },
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
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

describe("üyelik — tek yazıcı", () => {
  it("ANTİ-VAKUM: tarama dosya görüyor, ilişki adları şemadan geliyor, kalıplar gerçekten yakalıyor", () => {
    expect(FILES.length).toBeGreaterThan(300);
    expect(USER_RELATIONS).toEqual(expect.arrayContaining(["user", "users", "assignedTo", "invitedBy", "lastActiveUsers"]));
    expect(MEMBERSHIP_RELATIONS).toEqual(expect.arrayContaining(["memberships", "invitedMemberships"]));
    const writer = read(WRITER);
    expect(USER_CREATE.test(writer)).toBe(true);
    expect(MEMBERSHIP_WRITE.test(writer)).toBe(true);
    expect(MEMBERSHIP_RAW_WRITE.test(read("prisma/migrations/94_membership_backfill_repeat/migration.sql"))).toBe(true);
    for (const s of [
      "await tx.membership.deleteMany({ where: { userId } })",
      "data: { memberships: { delete: { id } } }",
      "data: { invitedMemberships: { create: { userId } } }",
    ])
      expect(MEMBERSHIP_WRITE.test(s)).toBe(true);
    expect(MEMBERSHIP_WRITE.test("where: { memberships: { none: {} } }")).toBe(false);
    for (const s of ["data: { user: { create: { email } } }", "data: { assignedTo: { create: { email } } }", "user: { upsert: { create: {}, update: {} } }"])
      expect(USER_CREATE.test(s)).toBe(true);
    expect(USER_CREATE.test("data: { assignedTo: { connect: { id } } }")).toBe(false);
    for (const s of ['DELETE FROM "public"."Membership" WHERE 1=1', 'UPDATE ONLY "Membership" SET "status" = 1', 'MERGE INTO "Membership" m', 'COPY "Membership" FROM STDIN'])
      expect(MEMBERSHIP_RAW_WRITE.test(s)).toBe(true);
    expect(MEMBERSHIP_RAW_WRITE.test('SELECT 1 FROM "Membership" m')).toBe(false);
    expect(USER_RAW_CREATE.test('INSERT INTO "User" ("id") VALUES (1)')).toBe(true);
    expect(USER_RAW_CREATE.test('UPDATE "User" SET "sessionEpoch" = 1')).toBe(false);
  });

  it("🚨 kullanıcı yaratan başka yol yok (Prisma ya da ham SQL)", () => {
    const offenders = FILES.filter((f) => f !== WRITER && (USER_CREATE.test(read(f)) || USER_RAW_CREATE.test(read(f))));
    expect(offenders).toEqual([]);
  });

  it("🚨 üyeliği yazan (ya da SİLEN) başka yol yok", () => {
    const offenders = FILES.filter((f) => f !== WRITER && MEMBERSHIP_WRITE.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("🚨 yazıcının KENDİSİ de üyelik satırı SİLMEZ (Opus R3) — önce iddiasız belirteçlere son tarih (tasarım §10.1 S3 ön koşulu)", () => {
    expect(MEMBERSHIP_DELETE.test(read(WRITER))).toBe(false);
    expect(MEMBERSHIP_DELETE.test("await tx.membership.delete({ where: { id } })")).toBe(true);
  });

  it("🚨 ham SQL ile üyelik yazan başka yol yok (istisna gerekçeli, eşleşme sayısı sabit)", () => {
    const offenders = FILES.filter((f) => !(f in RAW_WRITE_EXCEPTIONS) && MEMBERSHIP_RAW_WRITE.test(read(f)));
    expect(offenders).toEqual([]);
    for (const [f, { lines }] of Object.entries(RAW_WRITE_EXCEPTIONS)) {
      expect(FILES).toContain(f);
      expect(read(f).split("\n").filter((l) => MEMBERSHIP_RAW_WRITE.test(l)).length).toBe(lines);
    }
  });

  it("yazıcının demo sabitleri demo modülüyle AYNI (yazıcı sunucu yolunu içe aktarmadığı için kopya)", () => {
    expect(DEMO_ORG_ID_FOR_MEMBERSHIP).toBe(DEMO_ORG_ID);
    expect(DEMO_ID_PREFIX_FOR_MEMBERSHIP).toBe(DEMO_ID_PREFIX);
  });
});
