import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { hashPassword } from "@/lib/auth/password";

// ---------------------------------------------------------------------------
// BAŞARISIZ GİRİŞ: DENETİM YAZIMI KOVA TÜKETİMİYLE AYNI ANDA (09-23 saldırgan turu).
//
// Denetim satırı yalnız BİLİNEN hesapta yazılıyor ve kova tüketiminden SONRA sırayla
// bekleniyordu → bilinen hesabın hatalı girişi fazladan bir DB turu kadar yavaş = "bu e-posta
// kayıtlı" zamanlama sinyali. Milisaniye ölçmek kararsız bir test olurdu; bunun yerine SIRA
// davranışsal olarak sınanır: kova yazımı, denetim yazımı BAŞLAMADAN tamamlanamaz. Sıralı kodda
// bu kilitlenir (kova, hiç başlamayacak denetimi bekler) → test zaman aşımıyla düşer.
// ---------------------------------------------------------------------------

let auditStarted: () => void = () => {};
let auditStartedP: Promise<void> = Promise.resolve();

vi.mock("@/lib/rate-limit", async (orig) => {
  const actual = await orig<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    rateLimit: vi.fn(async (key: string, limit: number, windowMs: number) => {
      if (key.startsWith("login-acct:")) await auditStartedP;
      return actual.rateLimit(key, limit, windowMs);
    }),
  };
});
vi.mock("@/lib/audit", async (orig) => {
  const actual = await orig<typeof import("@/lib/audit")>();
  return {
    ...actual,
    writeAudit: vi.fn(async (entry: Parameters<typeof actual.writeAudit>[0]) => {
      auditStarted();
      return actual.writeAudit(entry);
    }),
  };
});

import { __resetRateLimit } from "@/lib/rate-limit";
import { POST } from "@/app/api/auth/login/route";

describe("başarısız giriş — denetim yazımı paralel", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    auditStartedP = new Promise<void>((r) => (auditStarted = r));
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "U",
        email: "u@example.com",
        passwordHash: await hashPassword("dogru-parola-1"),
        role: "owner",
        emailVerifiedAt: new Date(),
      },
    });
  });

  it(
    "bilinen hesap + yanlış parola: 401 döner (sıralı kodda kilitlenirdi) ve iz yazılır",
    async () => {
      const res = await POST(
        new NextRequest("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "6.6.6.6" },
          body: JSON.stringify({ email: "u@example.com", password: "yanlis-parola" }),
        }),
      );
      expect(res.status).toBe(401);
      expect(await prisma.auditLog.count({ where: { action: "auth.login_failed" } })).toBe(1);
    },
    5_000,
  );
});
