import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { drainOutboxOnce } from "@/lib/outbox/worker";
import type { OutboxSendFn } from "@/lib/outbox/worker";

// ---------------------------------------------------------------------------
// Tur 7 T7-OB-5 (kurucu önceliği 11-05, migration 91) — 48 saatlik teslim etkisi onarıcısı, teslimden SONRA ev sahibinin elle "Yeni"
// yaptığı konuşmayı her geçişte "Cevaplandı"ya çeviriyordu (onarıcı "etki hiç uygulanmadı" ile "ev sahibi bilerek açtı"yı ayıramıyordu).
// Satır artık teslim etkisinin değerlendirildiğini taşır (`deliveryEffectAt`); onarıcı yalnız boş satırları, en çok BİR KEZ onarır.
// ---------------------------------------------------------------------------

const send: OutboxSendFn = vi.fn(async () => ({ ok: true, providerMessageId: "PM-OB5" }));
const drain = () => drainOutboxOnce({ send, tokenFor: async () => "t" });

async function conv(propertyId: string, status: string) {
  return prisma.conversation.create({ data: { propertyId, guestIdentifier: "Ayşe", channel: "airbnb", status, externalReservationId: "res-ob5" } });
}

describe("teslim etkisi onarıcısı — ev sahibinin durum seçimi korunur (T7-OB-5)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("🚨 kuyruktan teslim edilen cevap → 'Cevaplandı'; ev sahibi 'Yeni' yapınca sonraki geçişler EZMEZ", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await conv(propertyId, "new");
    await prisma.message.create({ data: { conversationId: c.id, direction: "inbound", senderName: "Ayşe", body: "Otopark var mı?", createdAt: new Date(Date.now() - 120_000) } });
    const reply = await prisma.message.create({ data: { conversationId: c.id, direction: "outbound", senderName: "Host", authorType: "host", body: "Evet, var." } });
    await prisma.messageOutbox.create({
      data: {
        availableAt: new Date(), organizationId: orgId, conversationId: c.id, messageId: reply.id, channel: "airbnb",
        externalReservationId: "res-ob5", messageType: "manual", body: "Evet, var.", idempotencyKey: "ob5-1", status: "pending",
      },
    });
    await drain();
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("answered");
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: "ob5-1" } })).deliveryEffectAt).not.toBeNull();

    await prisma.conversation.update({ where: { id: c.id }, data: { status: "new" } }); // ev sahibi elle "Yeni"
    await drain();
    await drain();
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("new");
  });

  it("KONTROL — etkisi gerçekten kaçmış satır (damgasız) BİR KEZ onarılır ve damgalanır; sonra ev sahibinin 'Yeni'si korunur", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await conv(propertyId, "new");
    const reply = await prisma.message.create({ data: { conversationId: c.id, direction: "outbound", senderName: "Host", authorType: "host", body: "x", createdAt: new Date(Date.now() - 3_600_000) } });
    await prisma.messageOutbox.create({
      data: {
        availableAt: new Date(), organizationId: orgId, conversationId: c.id, messageId: reply.id, channel: "airbnb",
        externalReservationId: "res-ob5", messageType: "manual", body: "x", idempotencyKey: "ob5-2", status: "sent",
        sentAt: new Date(Date.now() - 3_600_000), providerMessageId: "PM-2",
      },
    });
    await drain();
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("answered");
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: "ob5-2" } })).deliveryEffectAt).not.toBeNull();
    await prisma.conversation.update({ where: { id: c.id }, data: { status: "new" } });
    await drain();
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("new");
  });

  it("🚨 hızlı uyandırma turunda (onarıcı ATLANIR) teslim edilen cevap da damgalanır: sonraki periyodik tur ev sahibinin 'Yeni'sini ezmez", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await conv(propertyId, "new");
    const reply = await prisma.message.create({ data: { conversationId: c.id, direction: "outbound", senderName: "Host", authorType: "host", body: "Evet." } });
    await prisma.messageOutbox.create({
      data: {
        availableAt: new Date(), organizationId: orgId, conversationId: c.id, messageId: reply.id, channel: "airbnb",
        externalReservationId: "res-ob5", messageType: "manual", body: "Evet.", idempotencyKey: "ob5-fast", status: "pending",
      },
    });
    await drainOutboxOnce({ send, tokenFor: async () => "t", skipHeal: true }); // hızlı uyandırma turu
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: "ob5-fast" } })).deliveryEffectAt).not.toBeNull();
    await prisma.conversation.update({ where: { id: c.id }, data: { status: "new" } });
    await drain(); // periyodik tur (onarıcı koşar)
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("new");
  });
});

