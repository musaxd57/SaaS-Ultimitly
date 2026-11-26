import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Codex 11-04 P2 — operatörün "yarım kalmış 2FA kurulumu" temizliği okuma ile yazma arasında müşterinin 2FA'yı ETKİNLEŞTİRMESİYLE yarışır.
// Eskiden yazma koşulsuzdu: yeni canlı faktör sessizce siliniyor, oturum sürümü artmıyor, denetime "bayat artık" yazılıyordu. AYRI dosya:
// Prisma temsilcisine `vi.spyOn` sonraki testlere sızar (CLAUDE.md dersi).
// ---------------------------------------------------------------------------

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/admin/reset-2fa/route";

const OPERATOR_EMAIL = "operator@lixusai.com";
const req = (body: unknown) =>
  new NextRequest("http://localhost/api/admin/reset-2fa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function operator(): Promise<SessionPayload> {
  const org = await prisma.organization.create({ data: { name: "Op Org" } });
  const user = await prisma.user.create({ data: { organizationId: org.id, name: "Op", email: OPERATOR_EMAIL, passwordHash: "x", role: "owner" } });
  return { userId: user.id, organizationId: org.id, role: "owner", email: OPERATOR_EMAIL, name: "Op", sessionEpoch: 0, mfa: true };
}

async function customerWithPendingSetup() {
  const org = await prisma.organization.create({ data: { name: "Müşteri Org" } });
  return prisma.user.create({
    data: { organizationId: org.id, name: "Müşteri", email: "musteri@example.com", passwordHash: "x", role: "owner", twoFactorSecret: "pending-secret", sessionEpoch: 2 },
  });
}

describe("admin 2FA sıfırlama — okuma ile yazma arasındaki etkinleştirme", () => {
  // TEK test: Prisma temsilcisindeki casus geri alınırsa (`restoreAllMocks`) temsilcinin yöntemi bozuluyor — yarışsız yol
  // `admin-reset-2fa.test.ts`te (stale_cleared) sınanır; bu dosya yalnız yarışı taşır.
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR_EMAIL);
    session = await operator();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 operatör 'kapalı + bayat kurulum' okudu → müşteri o arada ETKİNLEŞTİRDİ → yeni faktör SİLİNMEZ, 409, denetime hiçbir şey yazılmaz", async () => {
    const customer = await customerWithPendingSetup();
    const enabledAt = new Date();
    const realFind = prisma.user.findUnique.bind(prisma.user);
    vi.spyOn(prisma.user, "findUnique").mockImplementationOnce((async (args: Parameters<typeof prisma.user.findUnique>[0]) => {
      const snap = await realFind(args);
      // Müşteri 2FA'yı tamamlar (POST /api/account/2fa enable): faktör canlı + oturum sürümü artar.
      await prisma.user.update({ where: { id: customer.id }, data: { twoFactorEnabledAt: enabledAt, twoFactorSecret: "live-secret", sessionEpoch: { increment: 1 } } });
      return snap;
    }) as never);
    const res = await POST(req({ email: customer.email }));
    expect(res.status).toBe(409);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after.twoFactorEnabledAt?.getTime()).toBe(enabledAt.getTime());
    expect(after.twoFactorSecret).toBe("live-secret");
    expect(after.sessionEpoch).toBe(3);
    expect(await prisma.auditLog.count({ where: { action: { startsWith: "admin.2fa" } } })).toBe(0);
  });

});
