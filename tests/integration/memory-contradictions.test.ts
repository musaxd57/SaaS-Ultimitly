import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// DEĞİŞMEZ 13 / karar 26 (kurucu 10-11) — olası çelişki uyarısı, gerçek PostgreSQL: bilgi tabanı → hafıza (gerçek eşitleme), konuşma
// öğeleri, "Bilerek böyle" rotası, kiracılar arası (değişmez 16), bilgi tabanı değişince uyarının geri gelmesi.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { getMemoryContradictions, bootstrapMemoryFromKnowledgeBase } from "@/modules/intelligence";
import { POST } from "@/app/api/properties/[id]/memory-acknowledge/route";

const ack = (propertyId: string, memoryIds: unknown) =>
  POST(
    new NextRequest(`http://localhost/api/properties/${propertyId}/memory-acknowledge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memoryIds }),
    }),
    { params: Promise.resolve({ id: propertyId }) },
  );
let userSeq = 0;
/** Denetim kaydı gerçek kullanıcıya bağlanır (yabancı anahtar) → oturum GERÇEK kullanıcıyla. */
const asUser = async (orgId: string, role = "owner") => {
  const u = await prisma.user.create({
    data: { organizationId: orgId, name: "Sahip", email: `u${++userSeq}-${orgId}@x.com`, passwordHash: "x", role },
  });
  session = { userId: u.id, organizationId: orgId, role, email: u.email, name: "Sahip", sessionEpoch: 0 } as SessionPayload;
};

async function seed(complaints = 3) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const kb = await prisma.knowledgeBaseItem.create({
    data: { propertyId, category: "wifi", title: "Wi-Fi", content: "Ağ LaleNet, şifre kartta.", isActive: true, source: "host", reviewState: "approved" },
  });
  await bootstrapMemoryFromKnowledgeBase(orgId, propertyId);
  for (let i = 0; i < complaints; i++) {
    const convo = await prisma.conversation.create({ data: { propertyId, guestIdentifier: `Misafir ${i}`, channel: "airbnb" } });
    const at = new Date(Date.now() - (i + 1) * 3_600_000);
    for (const kind of ["complaint_issue", "wifi"]) {
      await prisma.conversationItem.create({
        data: { organizationId: orgId, conversationId: convo.id, messageId: `m-${convo.id}`, kind, sources: "understanding", createdAt: at },
      });
    }
  }
  return { orgId, propertyId, kb };
}

describe("olası çelişki — bilgi tabanı ↔ şikâyet", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("🚨 3 misafir Wi-Fi'dan şikâyet + bilgi tabanında Wi-Fi kalemi → uyarı; 'Bilerek böyle' → kalkar; kalem değişince → geri gelir", async () => {
    const s = await seed(3);
    const w = await getMemoryContradictions(s.orgId, s.propertyId);
    expect(w).toHaveLength(1);
    expect(w[0].kind).toBe("kb_vs_complaints");
    expect(w[0].text).toContain("3 misafir");

    await asUser(s.orgId);
    const res = await ack(s.propertyId, w[0].memoryIds);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { count: number }).count).toBe(1);
    expect(await getMemoryContradictions(s.orgId, s.propertyId)).toEqual([]);
    const audit = await prisma.auditLog.findFirst({ where: { action: "property.memory_contradiction_acknowledged" } });
    expect(audit).not.toBeNull();

    // Ev sahibi bilgiyi güncelledi → hafıza yeniden eşitlenir → işaret eski kalır → uyarı yeniden değerlendirilir.
    await new Promise((r) => setTimeout(r, 5));
    await prisma.knowledgeBaseItem.update({ where: { id: s.kb.id }, data: { content: "Ağ LaleNet-5G, şifre kartta." } });
    await bootstrapMemoryFromKnowledgeBase(s.orgId, s.propertyId);
    expect(await getMemoryContradictions(s.orgId, s.propertyId)).toHaveLength(1);
  });

  it("KONTROL: 2 misafir → uyarı yok", async () => {
    const s = await seed(2);
    expect(await getMemoryContradictions(s.orgId, s.propertyId)).toEqual([]);
  });

  it("bilgi tabanı ↔ mülk ayarı saat çelişkisi → uyarı (bilgi tabanı sayfasıyla aynı metin)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty({ checkInTime: "15:00" });
    await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "checkin", title: "Giriş", content: "Giriş saati 14:00'tür.", isActive: true, source: "host", reviewState: "approved" },
    });
    await bootstrapMemoryFromKnowledgeBase(orgId, propertyId);
    const w = await getMemoryContradictions(orgId, propertyId);
    expect(w.some((x) => x.kind === "kb_vs_kb")).toBe(true);
  });
});

describe("POST /api/properties/[id]/memory-acknowledge — kiracı + rol (değişmez 16)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("🚨 başka kiracının mülk kimliği → 404; hiçbir kalem işaretlenmez", async () => {
    const s = await seed(3);
    const { orgId: otherOrg } = await makeOrgWithProperty();
    await asUser(otherOrg);
    const w = await getMemoryContradictions(s.orgId, s.propertyId);
    const res = await ack(s.propertyId, w[0].memoryIds);
    expect(res.status).toBe(404);
    expect(await prisma.propertyMemory.count({ where: { humanOverrideAt: { not: null } } })).toBe(0);
  });

  it("🚨 kendi mülkü ama BAŞKA mülkün / kiracının kalem kimliği → işaretlenmez (count 0)", async () => {
    const a = await seed(3);
    const b = await seed(3);
    await asUser(a.orgId);
    const foreign = (await getMemoryContradictions(b.orgId, b.propertyId))[0].memoryIds;
    const res = await ack(a.propertyId, foreign);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { count: number }).count).toBe(0);
    expect(await getMemoryContradictions(b.orgId, b.propertyId)).toHaveLength(1);
  });

  it("🚨 AYNI kiracının BAŞKA mülkünün kalemi bu mülk üzerinden işaretlenmez; o mülkün şikâyetleri bu mülkte sayılmaz (mutasyon C8, C10)", async () => {
    const a = await seed(0); // A: Wi-Fi kalemi var, şikâyet yok
    const b = await prisma.property.create({ data: { organizationId: a.orgId, name: "Lale 7" } });
    await prisma.knowledgeBaseItem.create({
      data: { propertyId: b.id, category: "wifi", title: "Wi-Fi", content: "Ağ B.", isActive: true, source: "host", reviewState: "approved" },
    });
    await bootstrapMemoryFromKnowledgeBase(a.orgId, b.id);
    for (let i = 0; i < 3; i++) {
      const convo = await prisma.conversation.create({ data: { propertyId: b.id, guestIdentifier: `B ${i}`, channel: "airbnb" } });
      for (const kind of ["complaint_issue", "wifi"]) {
        await prisma.conversationItem.create({ data: { organizationId: a.orgId, conversationId: convo.id, messageId: `mb-${convo.id}`, kind, sources: "understanding" } });
      }
    }
    expect(await getMemoryContradictions(a.orgId, a.propertyId)).toEqual([]); // B'nin şikâyetleri A'ya yazılmaz
    const bWarn = await getMemoryContradictions(a.orgId, b.id);
    expect(bWarn).toHaveLength(1);
    await asUser(a.orgId);
    const res = await ack(a.propertyId, bWarn[0].memoryIds);
    expect(((await res.json()) as { count: number }).count).toBe(0);
    expect(await getMemoryContradictions(a.orgId, b.id)).toHaveLength(1);
  });

  it("🚨 tutarsız satır: bu mülke yazılmış ama YABANCI kiracıya ait hafıza kalemi işaretlenmez (mutasyon C9)", async () => {
    const a = await seed(3);
    const { orgId: otherOrg } = await makeOrgWithProperty();
    const stray = await prisma.propertyMemory.create({
      data: {
        organizationId: otherOrg,
        propertyId: a.propertyId,
        kind: "fact",
        category: "wifi",
        title: "x",
        source: "kb_item",
        sourceRef: "stray",
        evidenceJson: "[]",
        confidence: 0.5,
        observedAt: new Date(Date.now() - 86_400_000),
      },
    });
    await asUser(a.orgId);
    const res = await ack(a.propertyId, [stray.id]);
    expect(((await res.json()) as { count: number }).count).toBe(0);
    expect((await prisma.propertyMemory.findUniqueOrThrow({ where: { id: stray.id } })).humanOverrideAt).toBeNull();
  });

  it("personel → 403; boş / bozuk gövde → 400", async () => {
    const s = await seed(3);
    await asUser(s.orgId, "staff");
    expect((await ack(s.propertyId, ["x"])).status).toBe(403);
    await asUser(s.orgId);
    expect((await ack(s.propertyId, [])).status).toBe(400);
    expect((await ack(s.propertyId, "x")).status).toBe(400);
    expect((await ack(s.propertyId, Array.from({ length: 51 }, (_, i) => `id${i}`))).status).toBe(400);
  });
});
