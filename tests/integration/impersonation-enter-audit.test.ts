import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// K8 (kurucu kararı 09-28): bürünme başlangıcı (a) imzalı `impersonatedAt` damgasını yazar — müşteriden müşteriye geçişte İLK
// başlangıç korunur (süre uzatılamaz); (b) başlangıç kaydını ÇEREZDEN ÖNCE yazar ve kayıt yazılamazsa bürünme BAŞLAMAZ.
// Ayrı dosya: Prisma temsilcisine `vi.spyOn` sonraki testlere sızar (CLAUDE.md).
// ---------------------------------------------------------------------------

const cookies: SessionPayload[] = [];
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return { ...actual, setSessionCookie: vi.fn(async (p: SessionPayload) => void cookies.push(p)) };
});

import { enterOrganization } from "@/lib/admin";

async function seed() {
  const org = await prisma.organization.create({ data: { name: "Müşteri Org" } });
  await prisma.user.create({ data: { organizationId: org.id, email: "owner@x.com", name: "Sahip", passwordHash: "x", role: "owner" } });
  const opOrg = await prisma.organization.create({ data: { name: "Lixus" } });
  const op = await prisma.user.create({ data: { organizationId: opOrg.id, email: "ops@lixusai.com", name: "Op", passwordHash: "x", role: "owner" } });
  const operator: SessionPayload = {
    userId: op.id,
    organizationId: opOrg.id,
    role: "owner",
    email: op.email,
    name: "Op",
    sessionEpoch: 0,
    mfa: true,
  };
  return { orgId: org.id, operator };
}

describe("K8 — bürünme başlangıcı", () => {
  beforeEach(async () => {
    await resetDb();
    cookies.length = 0;
  });
  afterEach(() => vi.restoreAllMocks());

  it("🚨 başlangıç damgası yazılır; başlangıç kaydı salt-okunur işaretiyle var", async () => {
    const { orgId, operator } = await seed();
    const before = Math.floor(Date.now() / 1000);
    expect(await enterOrganization(operator, orgId)).toBe(true);
    expect(cookies).toHaveLength(1);
    expect(cookies[0].impersonatedAt).toBeGreaterThanOrEqual(before);
    expect(cookies[0].impersonatedAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "impersonate.enter" } });
    expect(JSON.parse(audit.metadataJson ?? "{}")).toMatchObject({ readOnly: true });
  });

  it("🚨 müşteriden müşteriye geçişte İLK başlangıç korunur (süre uzatılamaz)", async () => {
    const { orgId, operator } = await seed();
    const started = Math.floor(Date.now() / 1000) - 5400; // 1,5 saat önce
    await enterOrganization({ ...operator, actorUserId: operator.userId, actorSessionEpoch: 0, impersonatedAt: started }, orgId);
    expect(cookies[0].impersonatedAt).toBe(started);
  });

  it("🚨 başlangıç kaydı yazılamazsa bürünme BAŞLAMAZ (çerez yazılmaz)", async () => {
    const { orgId, operator } = await seed();
    vi.spyOn(prisma.auditLog, "create").mockRejectedValueOnce(new Error("db down"));
    await expect(enterOrganization(operator, orgId)).rejects.toThrow("db down");
    expect(cookies).toHaveLength(0);
  });
});
