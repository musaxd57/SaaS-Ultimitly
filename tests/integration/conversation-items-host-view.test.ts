import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// KONUŞMA ÖĞELERİ — EV SAHİBİ GÖRÜNÜMÜ (dilim d; kurucu kararı "Liste + konuşma + Dikkat").
//  · Liste rozeti: konuşma başına AÇIK iş sayısı ("ev sahibi yazdı" düşülür).
//  · Dikkat: ev sahibine bırakılan istek konuşma başına TEK satır; aynı konuşmanın "cevapsız" satırının yerini alır.
//  · "Tamamlandı": yalnız sahip/yönetici, yalnız kendi kiracısının ve o konuşmanın öğesi.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { PATCH } from "@/app/api/conversations/[id]/items/[itemId]/route";
import { heldRequestsByConversation, listConversationItems, openItemCounts } from "@/lib/conversation-items/store";
import { findAttentionItems } from "@/modules/intelligence/incidents/attention";

const as = (orgId: string, role: "owner" | "manager" | "staff" = "owner") => {
  session = { userId: `u-${role}`, organizationId: orgId, role, email: `${role}@test.com`, name: role, sessionEpoch: 0 } as SessionPayload;
};
const patch = (conversationId: string, itemId: string, body: unknown) =>
  PATCH(
    new NextRequest(`http://localhost/api/conversations/${conversationId}/items/${itemId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: conversationId, itemId }) },
  );

async function seedConversation(orgId: string, propertyId: string, body: string, minutesAgo = 600) {
  const at = new Date(Date.now() - minutesAgo * 60_000);
  const c = await prisma.conversation.create({
    data: {
      propertyId,
      channel: "airbnb",
      guestIdentifier: "Alex",
      externalReservationId: `res-${Math.random()}`,
      status: "answered",
      lastMessageAt: at,
      messages: { create: [{ direction: "inbound", senderName: "Alex", authorType: "guest", body, createdAt: at }] },
    },
    include: { messages: true },
  });
  return { conversationId: c.id, messageId: c.messages[0].id, at };
}

async function item(
  orgId: string,
  conversationId: string,
  messageId: string,
  over: { kind?: string; sensitivity?: string; status?: string } = {},
) {
  return prisma.conversationItem.create({
    data: {
      organizationId: orgId,
      conversationId,
      messageId,
      kind: over.kind ?? "payment_invoice",
      sensitivity: over.sensitivity ?? "sensitive",
      sources: "lexical",
      status: over.status ?? "pending_host",
      createdAt: new Date(),
    },
  });
}

describe("Tamamlandı uç noktası", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("sahip kapatır; kapanmış öğe yeniden açılmaz (acil de yalnız böyle kapanır)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const { conversationId, messageId } = await seedConversation(orgId, propertyId, "IBAN?");
    const it1 = await item(orgId, conversationId, messageId);
    const em = await item(orgId, conversationId, messageId, { kind: "emergency", sensitivity: "emergency" });
    as(orgId);
    const res = await patch(conversationId, it1.id, { action: "done" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "done" });
    expect((await patch(conversationId, em.id, { action: "done" })).status).toBe(200);
    expect((await prisma.conversationItem.findUniqueOrThrow({ where: { id: em.id } })).status).toBe("done");
    // İkinci kez: durum aynen (kapanmış öğe geri açılmaz).
    expect(await (await patch(conversationId, it1.id, { action: "done" })).json()).toEqual({ status: "done" });
  });

  it("🚨 kiracı ve konuşma kapsamı: başka org'un öğesi ya da başka konuşmanın öğesi 404 (öğe DEĞİŞMEZ)", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    const ca = await seedConversation(a.orgId, a.propertyId, "IBAN?");
    const cb = await seedConversation(b.orgId, b.propertyId, "IBAN?");
    const itemB = await item(b.orgId, cb.conversationId, cb.messageId);
    as(a.orgId);
    expect((await patch(cb.conversationId, itemB.id, { action: "done" })).status).toBe(404);
    expect((await patch(ca.conversationId, itemB.id, { action: "done" })).status).toBe(404);
    expect((await prisma.conversationItem.findUniqueOrThrow({ where: { id: itemB.id } })).status).toBe("pending_host");
  });

  it("yalnız sahip/yönetici; tanınmayan işlem 400", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const { conversationId, messageId } = await seedConversation(orgId, propertyId, "IBAN?");
    const it1 = await item(orgId, conversationId, messageId);
    as(orgId, "staff");
    expect((await patch(conversationId, it1.id, { action: "done" })).status).toBe(403);
    as(orgId, "manager");
    expect((await patch(conversationId, it1.id, { action: "reopen" })).status).toBe(400);
    expect((await prisma.conversationItem.findUniqueOrThrow({ where: { id: it1.id } })).status).toBe("pending_host");
    expect((await patch(conversationId, it1.id, { action: "done" })).status).toBe(200);
  });
});

describe("liste rozeti + konuşma kartı + Dikkat", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("açık iş sayısı: kapanmış öğe ve ev sahibinin SONRADAN yazdığı öğe sayılmaz", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c1 = await seedConversation(orgId, propertyId, "IBAN? Otopark?");
    await item(orgId, c1.conversationId, c1.messageId);
    await item(orgId, c1.conversationId, c1.messageId, { kind: "parking", sensitivity: "none", status: "open" });
    await item(orgId, c1.conversationId, c1.messageId, { kind: "wifi", sensitivity: "none", status: "answered" });
    const c2 = await seedConversation(orgId, propertyId, "Daire kirli");
    await item(orgId, c2.conversationId, c2.messageId, { kind: "complaint_issue" });
    await prisma.message.create({
      data: { conversationId: c2.conversationId, direction: "outbound", authorType: "host", senderName: "Ev sahibi", body: "Hemen bakıyorum." },
    });
    const counts = await openItemCounts(prisma, { organizationId: orgId, conversationIds: [c1.conversationId, c2.conversationId] });
    expect(counts.get(c1.conversationId)).toBe(2);
    expect(counts.has(c2.conversationId)).toBe(false);
    // Kart: görünen durumlar (ev sahibi yazdı türetilir).
    const views = await listConversationItems(prisma, { organizationId: orgId, conversationId: c2.conversationId });
    expect(views.map((v) => v.effective)).toEqual(["host_replied"]);
  });

  it("Dikkat: bırakılan istek konuşma başına TEK satır, cevapsız satırının YERİNİ alır; ev sahibi yazınca kaybolur", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    // 10 saattir cevapsız + bırakılan IBAN isteği (öğe kipinde hepsi tutulan tur).
    const c = await seedConversation(orgId, propertyId, "IBAN'ınızı atar mısınız?", 600);
    await prisma.conversation.update({ where: { id: c.conversationId }, data: { status: "new" } });
    await item(orgId, c.conversationId, c.messageId);
    await item(orgId, c.conversationId, c.messageId, { kind: "complaint_issue" });
    const rows = await findAttentionItems(orgId);
    expect(rows.map((r) => r.kind)).toEqual(["held_request"]);
    expect(rows[0]).toMatchObject({
      certainty: "inferred",
      requestKinds: ["payment_invoice", "complaint_issue"],
      requestCount: 2,
      href: `/inbox/${c.conversationId}`,
    });
    // Ev sahibi yazdı → bırakılan istek satırı düşer (iş onun elinde); son söz artık bizde → cevapsız satırı da yok.
    await prisma.message.create({
      data: { conversationId: c.conversationId, direction: "outbound", authorType: "host", senderName: "Ev sahibi", body: "Ödemeler Airbnb üzerinden." },
    });
    expect(await findAttentionItems(orgId)).toEqual([]);
  });

  it("kiracı yalıtımı: başka org'un bırakılan isteği görünmez", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    const cb = await seedConversation(b.orgId, b.propertyId, "IBAN?");
    await item(b.orgId, cb.conversationId, cb.messageId);
    expect(await heldRequestsByConversation(prisma, { organizationId: a.orgId, propertyIds: [a.propertyId, b.propertyId], since: new Date(0) })).toEqual(
      [],
    );
    expect(await heldRequestsByConversation(prisma, { organizationId: b.orgId, propertyIds: [b.propertyId], since: new Date(0) })).toHaveLength(1);
  });
});
