import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeUser } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// K23 (Codex 11-25): hesap silmenin SON kontrolü (silme işleminin ilk adımı, kilit altında) sahipliği ana işletme AYNASINDAN okuyordu
// (`User.organizationId` / `User.role`); oturum ise üyelikten doğrulanır. Parola doğrulandıktan sonra kişinin üyeliği kaldırılır ya da rolü
// üyelikte düşürülürse silme yine de sürüyordu. Artık son kontrol üyelik satırını kilitler ve oturumla AYNI kuralı uygular
// (`membershipMatchesSession` + rol sahip). Araya girme parola doğrulamasının hemen ardından gerçek veritabanı yazımıyla kurulur.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return { ...actual, clearSessionCookie: vi.fn().mockResolvedValue(undefined) };
});
let afterVerify: (() => Promise<void>) | null = null;
vi.mock("@/lib/auth/password", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/password")>();
  return {
    ...actual,
    verifyPassword: vi.fn(async (...a: Parameters<typeof actual.verifyPassword>) => {
      const r = await actual.verifyPassword(...a);
      const hook = afterVerify;
      afterVerify = null;
      if (hook) await hook();
      return r;
    }),
  };
});

import { hashPassword } from "@/lib/auth/password";
import { POST } from "@/app/api/account/delete/route";

const PW = "dogru-sifre-42";
const req = () =>
  new NextRequest("http://localhost/api/account/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PW }),
  });

async function seed() {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  const user = await makeUser({ data: { organizationId: org.id, name: "U", email: `u${Math.random()}@example.com`, passwordHash: await hashPassword(PW), role: "owner" } });
  const m = await prisma.membership.findFirstOrThrow({ where: { userId: user.id, organizationId: org.id } });
  session = { userId: user.id, organizationId: org.id, role: "owner", email: user.email, name: "U", sessionEpoch: user.sessionEpoch, membershipId: m.id, membershipEpoch: m.epoch };
  return { orgId: org.id, userId: user.id };
}
const membershipOf = (s: { userId: string; orgId: string }) => ({ userId: s.userId, organizationId: s.orgId });

describe("K23 — hesap silmenin son kontrolü ÜYELİKTEN", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    afterVerify = null;
  });

  it("🚨 parola doğrulandı → üyelik kaldırıldı (ayna hâlâ 'sahip') → silme sürmez (401, işletme yerinde)", async () => {
    const s = await seed();
    afterVerify = async () => {
      await prisma.membership.updateMany({ where: membershipOf(s), data: { status: "revoked", revokedAt: new Date(), epoch: { increment: 1 } } });
    };
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(await prisma.organization.count({ where: { id: s.orgId } })).toBe(1);
  });

  it("🚨 parola doğrulandı → rol ÜYELİKTE yöneticiye düşürüldü → silme sürmez", async () => {
    const s = await seed();
    afterVerify = async () => {
      await prisma.membership.updateMany({ where: membershipOf(s), data: { role: "manager", epoch: { increment: 1 } } });
    };
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(await prisma.organization.count({ where: { id: s.orgId } })).toBe(1);
  });

  it("🚨 rol ÜYELİKTE düştü ama kuşak ARTMADI (yalnız rol satırı değişti) → silme yine sürmez: rol denetimi kuşaktan bağımsız", async () => {
    const s = await seed();
    afterVerify = async () => {
      await prisma.membership.updateMany({ where: membershipOf(s), data: { role: "manager" } });
    };
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(await prisma.organization.count({ where: { id: s.orgId } })).toBe(1);
  });

  it("🚨 parola doğrulandı → üyelik kuşağı arttı (rol aynı) → oturum kuralıyla aynı: silme sürmez", async () => {
    const s = await seed();
    afterVerify = async () => {
      await prisma.membership.updateMany({ where: membershipOf(s), data: { epoch: { increment: 1 } } });
    };
    expect((await POST(req())).status).toBe(401);
    expect(await prisma.organization.count({ where: { id: s.orgId } })).toBe(1);
  });

  it("KONTROL: araya bir şey girmezse hesap silinir", async () => {
    const s = await seed();
    expect((await POST(req())).status).toBe(200);
    expect(await prisma.organization.count({ where: { id: s.orgId } })).toBe(0);
  });
});
