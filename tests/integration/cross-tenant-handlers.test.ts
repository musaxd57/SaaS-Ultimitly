import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// KİRACILAR ARASI YALITIM — DAVRANIŞSAL (09-23, denetim ajanı; değişmez 16)
//
// `api-route-scoping.test.ts` her rotanın org-kapsamlı sorgu YAZDIĞINI yapısal olarak
// pinler; ama yapısal pin "sorgu yazılmış" der, "başka kiracının kimliğiyle gelen istek
// hiçbir şeye dokunamıyor" demez. Ajan sekiz tutamacın bu davranışsal pini TAŞIMADIĞINI
// saydı. Bu dosya her birini B kiracısının oturumuyla, A kiracısının kaynak kimlikleriyle
// çağırır: yanıt 2xx OLMAZ ve A'nın verisi DEĞİŞMEZ. Anti-vakumluk: aynı çağrılar A'nın
// kendi oturumuyla çalışır (ret, bozuk istekten değil kapsamdan gelir).
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
  suggestReply: vi.fn(async () => {
    throw new Error("AI ÇAĞRILMAMALI — kiracılar arası istek kapsamda durmalıydı");
  }),
}));
vi.mock("@/lib/import/sync", async (orig) => ({
  ...(await orig<typeof import("@/lib/import/sync")>()),
  syncCalendarSource: vi.fn(async () => ({ ok: true, imported: 0, updated: 0, canceled: 0, skipped: 0 })),
}));

import { syncCalendarSource } from "@/lib/import/sync";
import { PATCH as kbPatch } from "@/app/api/kb/[id]/route";
import { POST as kbCopy } from "@/app/api/kb/[id]/copy/route";
import { PATCH as resPatch, DELETE as resDelete } from "@/app/api/reservations/[id]/route";
import { POST as calSync } from "@/app/api/calendar-sources/[id]/sync/route";
import { POST as rotateIcal } from "@/app/api/properties/[id]/rotate-ical/route";
import { GET as propGet, PATCH as propPatch } from "@/app/api/properties/[id]/route";
import { PATCH as convPatch, DELETE as convDelete } from "@/app/api/conversations/[id]/route";
import { POST as aiSuggest } from "@/app/api/conversations/[id]/ai-suggest/route";

const owner = (organizationId: string, userId: string): SessionPayload => ({
  userId,
  organizationId,
  role: "owner",
  email: `${userId}@x.com`,
  name: userId,
  sessionEpoch: 0,
});
const json = (body: unknown) =>
  new NextRequest("http://localhost/api/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const bare = () => new NextRequest("http://localhost/api/x");
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function seedVictim() {
  const org = await prisma.organization.create({ data: { name: "A" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "a", email: "a@x.com", passwordHash: "x", role: "owner" },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Lale 1", icalToken: "tok-victim-ical" },
  });
  const kb = await prisma.knowledgeBaseItem.create({
    data: { propertyId: property.id, category: "wifi", title: "Wi-Fi", content: "Ag: Lale", reviewState: "approved", source: "host_manual" },
  });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Misafir",
      arrivalDate: new Date(Date.now() + 86_400_000),
      departureDate: new Date(Date.now() + 3 * 86_400_000),
      channel: "manual",
      status: "confirmed",
      notes: "orijinal not",
    },
  });
  const source = await prisma.calendarSource.create({
    data: { propertyId: property.id, label: "Airbnb", url: "https://example.com/feed.ics" },
  });
  const conversation = await prisma.conversation.create({
    data: { propertyId: property.id, guestIdentifier: "g", channel: "airbnb", status: "new" },
  });
  await prisma.message.create({
    data: { conversationId: conversation.id, direction: "inbound", body: "Merhaba", senderName: "g" },
  });
  return { org, user, property, kb, reservation, source, conversation };
}

describe("kiracılar arası yalıtım — sekiz tutamaç, davranışsal", () => {
  let v: Awaited<ReturnType<typeof seedVictim>>;

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    v = await seedVictim();
    const attackerOrg = await prisma.organization.create({ data: { name: "B" } });
    const attacker = await prisma.user.create({
      data: { organizationId: attackerOrg.id, name: "b", email: "b@x.com", passwordHash: "x", role: "owner" },
    });
    await prisma.property.create({ data: { organizationId: attackerOrg.id, name: "B-1" } });
    session = owner(attackerOrg.id, attacker.id);
  });

  const notOk = (status: number) => expect(status >= 200 && status < 300, `durum ${status}`).toBe(false);

  it("🚨 B kiracısı A'nın kaynaklarını ne okuyabilir ne değiştirebilir", async () => {
    notOk((await kbPatch(json({ content: "ele gecirildi" }), ctx(v.kb.id))).status);
    notOk((await kbCopy(json({ targetPropertyIds: [] }), ctx(v.kb.id))).status);
    notOk((await resPatch(json({ notes: "ele gecirildi" }), ctx(v.reservation.id))).status);
    notOk((await resDelete(bare(), ctx(v.reservation.id))).status);
    notOk((await calSync(bare(), ctx(v.source.id))).status);
    notOk((await rotateIcal(bare(), ctx(v.property.id))).status);
    const got = await propGet(bare(), ctx(v.property.id));
    notOk(got.status);
    expect(await got.text()).not.toContain("tok-victim-ical");
    notOk((await propPatch(json({ name: "ele gecirildi" }), ctx(v.property.id))).status);
    notOk((await convPatch(json({ status: "closed" }), ctx(v.conversation.id))).status);
    notOk((await convDelete(bare(), ctx(v.conversation.id))).status);
    notOk((await aiSuggest(json({ tone: "warm" }), ctx(v.conversation.id))).status);

    // A'nın verisi BİREBİR aynı.
    expect((await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: v.kb.id } })).content).toBe("Ag: Lale");
    expect(await prisma.knowledgeBaseItem.count()).toBe(1); // kopya da oluşmadı
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: v.reservation.id } })).notes).toBe("orijinal not");
    expect(vi.mocked(syncCalendarSource)).not.toHaveBeenCalled();
    const prop = await prisma.property.findUniqueOrThrow({ where: { id: v.property.id } });
    expect(prop.name).toBe("Lale 1");
    expect(prop.icalToken).toBe("tok-victim-ical");
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: v.conversation.id } })).status).toBe("new");
  });

  it("ANTİ-VAKUM: aynı çağrılar A'nın KENDİ oturumuyla çalışır (ret kapsamdan geliyor, bozuk istekten değil)", async () => {
    session = owner(v.org.id, v.user.id);
    expect((await propGet(bare(), ctx(v.property.id))).status).toBe(200);
    expect((await resPatch(json({ notes: "sahip degistirdi" }), ctx(v.reservation.id))).status).toBe(200);
    expect((await convPatch(json({ status: "closed" }), ctx(v.conversation.id))).status).toBe(200);
    expect((await kbPatch(json({ content: "sahip guncelledi" }), ctx(v.kb.id))).status).toBe(200);
    expect((await calSync(bare(), ctx(v.source.id))).status).toBe(200);
    expect(vi.mocked(syncCalendarSource)).toHaveBeenCalledTimes(1);
  });
});
