import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { hashPassword } from "@/lib/auth/password";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// U42 (Codex 10-07, 15c8663) — SİLME TARAFI: rotanın abonelik denetimi işlem DIŞINDA; denetimden SONRA, silme işleminden ÖNCE bir
// ödeme olayı AKTİF abonelik yazarsa eski kod hesabı (ve kademeli olarak o aktif aboneliği) siliyordu — Paddle faturalamaya devam eder.
// Araya girme: `deleteAccountData`ın işlemden önceki ilk okumasında (görev fotoğrafları) gerçek bir abonelik yazılır. Doğru sonuç:
// işlemin ilk adımı (org kilitliyken) faturalı aboneliği yeniden görür → 409, org yerinde. (Prisma temsilcisine casus → AYRI dosya,
// dosya düzeyinde geçirgen casus; geri alınmaz.)
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

import { POST } from "@/app/api/account/delete/route";

let interleave: (() => Promise<void>) | null = null;
const realFindMany = prisma.taskUpdate.findMany.bind(prisma.taskUpdate);
vi.spyOn(prisma.taskUpdate, "findMany").mockImplementation((async (args: Parameters<typeof realFindMany>[0]) => {
  const hook = interleave;
  interleave = null;
  if (hook) await hook();
  return realFindMany(args);
}) as never);

const PW = "dogru-sifre-42";
async function seed() {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "U", email: `u${Math.random()}@x.com`, passwordHash: await hashPassword(PW), role: "owner" },
  });
  session = { userId: user.id, organizationId: org.id, role: "owner", email: user.email, name: "U", sessionEpoch: 0 };
  return org.id;
}
const req = () =>
  new NextRequest("http://localhost/api/account/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PW }),
  });

describe("U42 — denetimle silme arasında aktifleşen abonelik hesabı SİLDİRMEZ", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    interleave = null;
  });

  it("🚨 dış denetim geçti → ödeme olayı aktif abonelik yazdı → 409, org ve abonelik yerinde", async () => {
    const orgId = await seed();
    interleave = async () => {
      await prisma.subscription.create({ data: { organizationId: orgId, provider: "paddle", status: "active", planCode: "pro", providerRef: "sub_1" } });
    };
    const res = await POST(req());
    expect(res.status).toBe(409); // ⬅️ ARIZADA 200: org ve aktif abonelik kademeli silinmişti
    expect(await prisma.organization.count({ where: { id: orgId } })).toBe(1);
    expect(await prisma.subscription.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("KONTROL: araya bir şey girmezse hesap silinir", async () => {
    const orgId = await seed();
    expect((await POST(req())).status).toBe(200);
    expect(await prisma.organization.count({ where: { id: orgId } })).toBe(0);
  });
});
