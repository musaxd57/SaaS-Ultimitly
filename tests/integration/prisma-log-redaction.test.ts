import { describe, it, expect, vi, afterEach } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// İNCELEME AJANI b5 (09-30) — GERÇEK İSTEMCİYLE: başarısız sorgunun verisi (misafir e-postası / telefonu) hiçbir konsol çıkışına
// yazılmaz. Eskiden üretim istemcisi `log: ["error"]` ile Prisma'nın kendi kaydedicisine bırakılmıştı; o kaydedici iletinin
// TAMAMINI ("… metadataJson: {"email": …}") uygulamanın yakalamasından ÖNCE basıyordu. Test ortamı üretim dalını kullanır.
// ---------------------------------------------------------------------------

afterEach(() => vi.restoreAllMocks());

/** Konsolun ve iki akışın TÜM çıkışını toplar; `run` bitince yakalamayı kapatır. */
async function captureOutput(run: () => Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  for (const m of ["log", "error", "warn", "info"] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  }
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as never);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as never);
  try {
    await expect(run()).rejects.toThrow();
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
  return lines.join("\n");
}

const EMAIL = "ayse.yilmaz@example.com";
const PHONE = "0555 123 45 67";

describe("Prisma hata kaydı — veri yok (inceleme b5)", () => {
  it("yabancı anahtar hatası: konsolda özet var, e-posta / telefon yok", async () => {
    await resetDb();
    const out = await captureOutput(() =>
      prisma.auditLog.create({
        data: { organizationId: "org-yok", action: "test", metadataJson: JSON.stringify({ email: EMAIL, phone: PHONE }) },
      }),
    );
    expect(out).not.toContain(EMAIL);
    expect(out).not.toContain(PHONE);
    expect(out).toContain("prisma:error");
    expect(out).toContain("auditLog.create");
  });

  // Ölçüldü (09-30): Prisma'nın kendi kaydedicisi yabancı anahtar / tekil alan hatasında veri BASMIYOR — sızıntı şu üç biçimde:
  // doğrulama hatasının argüman ağacı, ham sorgunun "Failing row contains (…)" ve "Key (…)=(…)" ayrıntısı. Test bu biçimlerle.
  it("🚨 doğrulama hatası (argüman ağacı): konsolda e-posta / telefon yok", async () => {
    await resetDb();
    const { orgId } = await makeOrgWithProperty();
    const out = await captureOutput(() =>
      prisma.auditLog.create({
        data: { organizationId: orgId, action: "test", metadataJson: JSON.stringify({ email: EMAIL, phone: PHONE }), bogus: 1 } as never,
      }),
    );
    expect(out).not.toContain(EMAIL);
    expect(out).not.toContain(PHONE);
    expect(out).toContain("prisma:error");
  });

  it("🚨 ham sorgu \"Failing row contains\" ve \"Key (…)=(…)\": konsolda veri yok", async () => {
    await resetDb();
    const { orgId } = await makeOrgWithProperty();
    const notNull = await captureOutput(
      () =>
        prisma.$executeRaw`INSERT INTO "AuditLog" ("id","organizationId","action","metadataJson","createdAt") VALUES ('p-null', NULL, 'x', ${JSON.stringify({ email: EMAIL, phone: PHONE })}, now())`,
    );
    expect(notNull).not.toContain(EMAIL);
    expect(notNull).not.toContain(PHONE);
    expect(notNull).toContain("prisma:error");
    await prisma.$executeRaw`INSERT INTO "AuditLog" ("id","organizationId","action","metadataJson","createdAt") VALUES (${EMAIL}, ${orgId}, 'x', '{}', now())`;
    const unique = await captureOutput(
      () =>
        prisma.$executeRaw`INSERT INTO "AuditLog" ("id","organizationId","action","metadataJson","createdAt") VALUES (${EMAIL}, ${orgId}, 'x', '{}', now())`,
    );
    expect(unique).not.toContain(EMAIL);
    expect(unique).toContain("prisma:error");
  });
});
