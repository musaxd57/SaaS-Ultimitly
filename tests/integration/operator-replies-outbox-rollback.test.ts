import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { countPriorOperatorReplies } from "@/lib/operator-replies";
import { __resetOutboxPresence } from "@/lib/outbox/presence";

describe("selam sayımı — O1 geri dönüşü (Opus F3)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    __resetOutboxPresence();
  });

  // Opus F3 (10-16, O1 geri dönüş): anahtar KAPATILDIKTAN sonra kuyrukta misafire ulaşmamış (başarısız) bir cevap kaldıysa süzgeç açık
  // kalır — selam sayımı onu "verilmiş cevap" saymaz (eskiden anahtar kapanınca süzgeç de kapanıyordu).
  it("🚨 anahtar kapalı + kuyrukta başarısız satır → ulaşmamış cevap sayılmaz", async () => {
    await resetDb();
    __resetOutboxPresence();
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await prisma.conversation.create({ data: { propertyId, channel: "airbnb", guestIdentifier: "M", lastMessageAt: new Date() } });
    const delivered = await prisma.message.create({ data: { conversationId: c.id, direction: "outbound", senderName: "Ev sahibi", body: "Merhaba, hoş geldiniz", externalId: "p-1" } });
    const lost = await prisma.message.create({ data: { conversationId: c.id, direction: "outbound", senderName: "Ev sahibi", body: "Wi-Fi şifresi …" } });
    await prisma.messageOutbox.create({
      data: { organizationId: orgId, conversationId: c.id, messageId: lost.id, channel: "airbnb", body: lost.body, idempotencyKey: "k", status: "failed" },
    });
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "");
    expect(await countPriorOperatorReplies(c.id)).toBe(1); // ⬅️ ESKİDE 2 (ulaşmamış cevap da sayılıyordu)
    expect(delivered.id).toBeTruthy();
  });

  it("KONTROL: kuyruk hiç kullanılmadıysa (tablo boş) anahtar kapalıyken ulaşmamış biçimli mesaj sayılır (bugünkü davranış)", async () => {
    await resetDb();
    __resetOutboxPresence();
    const { propertyId } = await makeOrgWithProperty();
    const c = await prisma.conversation.create({ data: { propertyId, channel: "airbnb", guestIdentifier: "M", lastMessageAt: new Date() } });
    await prisma.message.create({ data: { conversationId: c.id, direction: "outbound", senderName: "Ev sahibi", body: "Merhaba", externalId: "p-1" } });
    await prisma.message.create({ data: { conversationId: c.id, direction: "outbound", senderName: "Ev sahibi", body: "Dahili not gibi" } });
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "");
    expect(await countPriorOperatorReplies(c.id)).toBe(2);
  });
});
