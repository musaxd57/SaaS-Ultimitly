import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/properties/route";

function createReq(name: string) {
  return new NextRequest("http://localhost/api/properties", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}
const owner = (orgId: string): SessionPayload => ({
  userId: "u",
  organizationId: orgId,
  role: "owner",
  email: "o@x.com",
  name: "O",
  sessionEpoch: 0,
});

const noCtx = { params: Promise.resolve({} as Record<string, never>) };

async function seedProperties(orgId: string, n: number) {
  for (let i = 0; i < n; i++) {
    await prisma.property.create({ data: { organizationId: orgId, name: `Var ${i}` } });
  }
}

// The plan-limit gate on property creation. CARDINAL RULE: while billing is
// dormant (BILLING_ENFORCED unset) it must NEVER block — only once enforcement
// is switched on does the per-plan cap apply.
describe("POST /api/properties — plan limit gate", () => {
  let orgId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    session = owner(orgId);
  });
  afterEach(() => {
    delete process.env.BILLING_ENFORCED;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("DORMANT: a free-plan org over its limit can still add (never blocks)", async () => {
    await prisma.subscription.create({
      data: { organizationId: orgId, planCode: "free", status: "active", provider: "paddle" },
    });
    await seedProperties(orgId, 2); // free cap is 2 — already at it
    delete process.env.BILLING_ENFORCED;
    const res = await POST(createReq("Üçüncü"), noCtx);
    expect(res.status).toBe(201);
  });

  it("ENFORCED: a free-plan org at its 2-property cap is blocked (403 + upgrade message)", async () => {
    await prisma.subscription.create({
      data: { organizationId: orgId, planCode: "free", status: "active", provider: "paddle" },
    });
    await seedProperties(orgId, 2);
    process.env.BILLING_ENFORCED = "true";
    const res = await POST(createReq("Üçüncü"), noCtx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/plan/i);
    // nothing created
    expect(await prisma.property.count({ where: { organizationId: orgId } })).toBe(2);
  });

  it("ENFORCED: under the cap, the create succeeds", async () => {
    await prisma.subscription.create({
      data: { organizationId: orgId, planCode: "free", status: "active", provider: "paddle" },
    });
    await seedProperties(orgId, 1);
    process.env.BILLING_ENFORCED = "true";
    const res = await POST(createReq("İkinci"), noCtx);
    expect(res.status).toBe(201);
  });

  it("ENFORCED RACE (Codex #17): concurrent creates at limit-1 can NOT overshoot the cap", async () => {
    // The gate is count-then-create: 4 simultaneous requests all counted 1 < 2
    // and would all have created. The post-create reconciliation (ordered by
    // createdAt,id; own row outside the limit deletes itself) must leave
    // EXACTLY the plan cap in the DB, with exactly one 201.
    await prisma.subscription.create({
      data: { organizationId: orgId, planCode: "free", status: "active", provider: "paddle" },
    });
    await seedProperties(orgId, 1); // free cap is 2 → one slot left
    process.env.BILLING_ENFORCED = "true";

    const responses = await Promise.all(
      Array.from({ length: 4 }, (_, i) => POST(createReq(`Yarış ${i}`), noCtx)),
    );
    const created = responses.filter((r) => r.status === 201);
    const blocked = responses.filter((r) => r.status === 403);
    expect(created).toHaveLength(1);
    expect(blocked).toHaveLength(3);
    expect(await prisma.property.count({ where: { organizationId: orgId } })).toBe(2);
  });

  it("🚨 10-10 (tam koşuda ölçülen yarış): eşzamanlı eklemenin commit'i GECİKSE de sınır aşılmaz — istek sıraya girer", async () => {
    // Eski uzlaştırma oluşturduktan sonra `createdAt` sırasına bakıyordu: diğer isteğin satırı henüz commit edilmemişse
    // görünmüyor, iki istek de kendini sınır içinde sanıyordu (4 eşzamanlı istekte 2 oluşturma). Bu test o sıralamayı ZORLAR:
    // başka bir işlem daire ekler (yalnız ekleme — eski koddaki eşzamanlı istek gibi kilit almaz) ve commit'i bekletir; o sırada
    // gelen istek beklemeli (yeni kodun kuruluş kilidi eklemenin yabancı anahtar kilidiyle çakışır), sonra 403 almalı.
    await prisma.subscription.create({
      data: { organizationId: orgId, planCode: "free", status: "active", provider: "paddle" },
    });
    await seedProperties(orgId, 1); // free cap is 2 → one slot left
    process.env.BILLING_ENFORCED = "true";

    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let markLocked!: () => void;
    const lockTaken = new Promise<void>((r) => (markLocked = r));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.property.create({ data: { organizationId: orgId, name: "Paralel ekleme" } });
        markLocked();
        await held;
      },
      { timeout: 20_000 },
    );
    await lockTaken;
    const pending = POST(createReq("Sonraki"), noCtx);
    await new Promise((r) => setTimeout(r, 300)); // istek kilitte beklesin (eski kod beklemeden oluşturuyordu)
    release();
    await holder;
    const res = await pending;
    expect(res.status).toBe(403);
    expect(await prisma.property.count({ where: { organizationId: orgId } })).toBe(2);
  });

  it("ENFORCED: an expired-trial org is blocked with a subscription message", async () => {
    await prisma.subscription.create({
      data: {
        organizationId: orgId,
        planCode: "pro",
        status: "trialing",
        provider: "trial",
        trialEndsAt: new Date(Date.now() - 86_400_000),
      },
    });
    process.env.BILLING_ENFORCED = "true";
    const res = await POST(createReq("Yeni"), noCtx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/abone/i);
  });

  it("ENFORCED: a grandfathered org (no subscription) stays unlimited", async () => {
    await seedProperties(orgId, 5);
    process.env.BILLING_ENFORCED = "true";
    const res = await POST(createReq("Altıncı"), noCtx);
    expect(res.status).toBe(201);
  });

  it("🚨 gece-4 S6-07: aynı adla EŞZAMANLI iki istek → yalnız biri oluşturur (ad denetimi kuruluş kilidi içinde); faturalandırma uyurken de", async () => {
    const results = await Promise.all([POST(createReq("Lale Suit"), noCtx), POST(createReq("lale suit"), noCtx)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await prisma.property.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("gece-4 S6-06: yalnız boşluktan oluşan ad reddedilir (\"\" olarak kaydedilmez)", async () => {
    const res = await POST(createReq("   "), noCtx);
    expect(res.status).toBe(400);
    expect(await prisma.property.count({ where: { organizationId: orgId } })).toBe(0);
  });
});
