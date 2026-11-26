import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// KALİTE KONSOLU RET KAYDI SINIRLI (derin ajan turu 2, D-2). Eskiden her ret bir denetim satırı yazıyordu, hız sınırı yoktu: herhangi bir
// müşteri oturumu döngüyle operatör panelinin "son 50 denetim kaydı"nı süpürüp gerçek güvenlik olaylarını listeden itebiliyordu. Şimdi
// kullanıcı başına saatte en çok AI_QUALITY_DENIED_AUDIT_PER_HOUR satır; ret (401) her seferinde AYNEN döner.
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { GET as viewGet } from "@/app/api/admin/ai-quality/route";
import { POST as labelPost } from "@/app/api/admin/ai-quality/labels/route";
import { AI_QUALITY_DENIED_AUDIT_PER_HOUR } from "@/lib/ai-quality/gate";

async function makeOwner(email: string): Promise<SessionPayload> {
  const org = await prisma.organization.create({ data: { name: `Org ${email}` } });
  const user = await prisma.user.create({ data: { organizationId: org.id, name: "U", email, passwordHash: "x", role: "owner" } });
  return { userId: user.id, organizationId: org.id, role: "owner", email, name: "U", sessionEpoch: 0, mfa: true } as SessionPayload;
}

const viewReq = () => new NextRequest("http://localhost/api/admin/ai-quality?orgId=x&purpose=quality_review");
const labelReq = () =>
  new NextRequest("http://localhost/api/admin/ai-quality/labels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orgId: "x", generationId: "y", label: "correct", purpose: "quality_review" }),
  });

describe("kalite konsolu — ret kaydı kullanıcı başına sınırlı", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.rateLimitCounter.deleteMany();
    vi.stubEnv("SUPERADMIN_EMAILS", "operator@lixusai.com");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("aynı kullanıcı sınırın üstünde dener: her istek 401, denetim satırı tam sınır kadar", async () => {
    session = await makeOwner("musteri@example.com");
    const tries = AI_QUALITY_DENIED_AUDIT_PER_HOUR + 5;
    for (let i = 0; i < tries; i++) {
      // Görüntüleme ve etiket uçları aynı sayacı paylaşır.
      const res = i % 2 === 0 ? await viewGet(viewReq()) : await labelPost(labelReq());
      expect(res.status).toBe(401);
    }
    const rows = await prisma.auditLog.findMany({ where: { action: "ai_quality.denied" } });
    expect(rows).toHaveLength(AI_QUALITY_DENIED_AUDIT_PER_HOUR);
    expect(new Set(rows.map((r) => r.organizationId))).toEqual(new Set([session.organizationId]));
  });

  it("sınır KULLANICI başınadır: bir kullanıcının seli başka kullanıcının ret kaydını susturmaz", async () => {
    session = await makeOwner("a@example.com");
    for (let i = 0; i < AI_QUALITY_DENIED_AUDIT_PER_HOUR + 3; i++) await viewGet(viewReq());
    const other = await makeOwner("b@example.com");
    session = other;
    expect((await viewGet(viewReq())).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: "ai_quality.denied", organizationId: other.organizationId } })).toBe(1);
  });
});
