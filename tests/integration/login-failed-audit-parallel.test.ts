import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { hashPassword, dummyVerifyPassword } from "@/lib/auth/password";

// ---------------------------------------------------------------------------
// BAŞARISIZ GİRİŞ: DENETİM YAZIMI PARİTE TURUYLA AYNI ANDA (09-23 saldırgan turu; F1 11-17'de taşındı).
//
// Denetim satırı yalnız BİLİNEN hesapta yazılıyor ve kova tüketiminden SONRA sırayla
// bekleniyordu → bilinen hesabın hatalı girişi fazladan bir DB turu kadar yavaş = "bu e-posta
// kayıtlı" zamanlama sinyali. Milisaniye ölçmek kararsız bir test olurdu; bunun yerine SIRA
// davranışsal olarak sınanır.
// F1'den beri hesap kovasının hakkı doğrulamadan ÖNCE ayrılıyor; başarısız dalda bilinmeyen hesabın da tek DB turu olsun diye kovanın
// satırına değeri değiştirmeyen bir YAZMA (`rateLimitTouch`, parite turu) denetim yazımıyla AYNI ANDA koşar. Pin oraya taşındı: parite
// yazması, denetim yazımı BAŞLAMADAN tamamlanamaz. Sıralı kodda bu kilitlenir (parite, hiç başlamayacak denetimi bekler) → zaman aşımı.
// İkinci test bilinmeyen hesabın da başarısız dalda TAM BİR parite yazması yaptığını sayar (silinirse "kayıtlı e-posta" sinyali doğar).
// ---------------------------------------------------------------------------

let auditStarted: () => void = () => {};
let auditStartedP: Promise<void> = Promise.resolve();
let waitForAudit = true;

vi.mock("@/lib/rate-limit", async (orig) => {
  const actual = await orig<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    rateLimitTouch: vi.fn(async (key: string) => {
      if (key.startsWith("login-acct:") && waitForAudit) await auditStartedP;
      return actual.rateLimitTouch(key);
    }),
  };
});
vi.mock("@/lib/auth/password", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/password")>();
  return { ...actual, dummyVerifyPassword: vi.fn(actual.dummyVerifyPassword) };
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

import { __resetRateLimit, rateLimitTouch } from "@/lib/rate-limit";
import { POST } from "@/app/api/auth/login/route";

describe("başarısız giriş — denetim yazımı paralel", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    auditStartedP = new Promise<void>((r) => (auditStarted = r));
    waitForAudit = true;
    vi.mocked(rateLimitTouch).mockClear();
    vi.mocked(dummyVerifyPassword).mockClear();
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

  it("bilinmeyen hesap + yanlış parola: başarısız dalda da TAM BİR parite yazması yapılır (sahte bcrypt'ten SONRA)", async () => {
    waitForAudit = false; // bu dalda denetim yok — pariteyi bekletme
    const res = await POST(
      new NextRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "6.6.6.7" },
        body: JSON.stringify({ email: "yok@example.com", password: "yanlis-parola" }),
      }),
    );
    expect(res.status).toBe(401);
    const peeks = vi.mocked(rateLimitTouch).mock.calls.filter(([k]) => k === "login-acct:yok@example.com");
    expect(peeks).toHaveLength(1);
    expect(vi.mocked(rateLimitTouch).mock.invocationCallOrder[0]!).toBeGreaterThan(vi.mocked(dummyVerifyPassword).mock.invocationCallOrder[0] ?? Infinity);
    expect(await prisma.auditLog.count({ where: { action: "auth.login_failed" } })).toBe(0);
  });
});
