import { describe, it, expect, vi, afterEach } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// İNCELEME AJANI b5 (09-30) — GERÇEK İSTEMCİYLE: başarısız sorgunun verisi (misafir e-postası / telefonu) hiçbir konsol çıkışına
// yazılmaz. Eskiden üretim istemcisi `log: ["error"]` ile Prisma'nın kendi kaydedicisine bırakılmıştı; o kaydedici iletinin
// TAMAMINI ("… metadataJson: {"email": …}") uygulamanın yakalamasından ÖNCE basıyordu. Test ortamı üretim dalını kullanır.
// ---------------------------------------------------------------------------

afterEach(() => vi.restoreAllMocks());

describe("Prisma hata kaydı — veri yok (inceleme b5)", () => {
  it("🚨 yabancı anahtar hatası: konsolda özet var, e-posta / telefon yok", async () => {
    await resetDb();
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
    await expect(
      prisma.auditLog.create({
        data: {
          organizationId: "org-yok",
          action: "test",
          metadataJson: JSON.stringify({ email: "ayse.yilmaz@example.com", phone: "0555 123 45 67" }),
        },
      }),
    ).rejects.toThrow();
    stdout.mockRestore();
    stderr.mockRestore();
    const out = lines.join("\n");
    expect(out).not.toContain("ayse.yilmaz@example.com");
    expect(out).not.toContain("0555 123 45 67");
    expect(out).toContain("prisma:error");
    expect(out).toContain("auditLog.create");
  });
});
