import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { drainOutboxOnce } from "@/lib/outbox/worker";

// ---------------------------------------------------------------------------
// Codex 11-17 C3 — teslim etkisinin DÖRDÜNCÜ parçası: kalıcı hatadan sonra yeniden kuyruğa alınıp teslim edilen yapay zekâ cevabı, kendi
// düşüşüyle ev sahibinde yeniden açılmış (`pending_host`) öğeleri yeniden kapatır (`recloseItemsDeliveredBy`). Bu adım düşerse satır yine
// "değerlendirildi" diye damgalanıyordu ve onarıcıda bu adım HİÇ yoktu → öğe kalıcı olarak açık kalıyordu (güvenli yön: fazladan açık iş,
// gizlenmiş iş değil). Artık damga yok + onarıcı adımı yeniden dener. Prisma casusu sonraki testlere sızmasın diye AYRI dosya.
// ---------------------------------------------------------------------------

describe("öğe yeniden kapatma yazılamazsa damga yok, onarıcı yeniden dener", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("🚨 yeniden kapatma düştü → satır damgasız, öğe ev sahibinde açık; arıza geçince onarıcı öğeyi kapatır ve damgalar (yeniden göndermez)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.organization.update({ where: { id: orgId }, data: { autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0 } });
    const c = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "Ayşe", channel: "airbnb", status: "new", externalReservationId: "res-rc" } });
    const guest = await prisma.message.create({
      data: { conversationId: c.id, direction: "inbound", senderName: "Ayşe", authorType: "guest", body: "Wifi şifresi nedir?", createdAt: new Date(Date.now() - 60_000) },
    });
    const ai = await prisma.message.create({
      data: { conversationId: c.id, direction: "outbound", senderName: "GuestOps AI", authorType: "ai", aiIntent: "wifi", body: "Wifi şifresi kapının yanında." },
    });
    // Önceki kesin hatayla ev sahibinde yeniden açılmış öğe: bu cevaba bağlı, `pending_host`.
    const item = await prisma.conversationItem.create({
      data: { organizationId: orgId, conversationId: c.id, messageId: guest.id, kind: "wifi", sources: "lexical", status: "pending_host", answeredByMessageId: ai.id },
    });
    await prisma.messageOutbox.create({
      data: {
        availableAt: new Date(), organizationId: orgId, conversationId: c.id, messageId: ai.id, channel: "airbnb",
        externalReservationId: "res-rc", messageType: "ai", body: ai.body, idempotencyKey: "reclose-1", status: "pending",
      },
    });
    const realUpdateMany = prisma.conversationItem.updateMany.bind(prisma.conversationItem);
    let failing = true; // casus geri yüklenmez (Prisma temsilcisi bozulur) — bayrakla gerçek fonksiyona geçilir
    vi.spyOn(prisma.conversationItem, "updateMany").mockImplementation(((args: { data?: { status?: unknown } }) =>
      failing && args?.data?.status === "answered" ? Promise.reject(new Error("db hiccup")) : realUpdateMany(args as never)) as never);
    const send = vi.fn(async () => ({ ok: true, providerMessageId: "PM-RC" }));

    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: "reclose-1" } })).deliveryEffectAt).toBeNull();
    expect((await prisma.conversationItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("pending_host");

    failing = false; // arıza geçti
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect((await prisma.conversationItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("answered");
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: "reclose-1" } })).deliveryEffectAt).not.toBeNull();
    expect(send).toHaveBeenCalledTimes(1); // onarıcı asla yeniden göndermez
  });

  it("KONTROL — onarıcı ev sahibinin arada kapattığı öğeye dokunmaz (yalnız bu mesaja bağlı ve hâlâ pending_host olanlar)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.organization.update({ where: { id: orgId }, data: { autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0 } });
    const c = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "Ayşe", channel: "airbnb", status: "new", externalReservationId: "res-rc2" } });
    const guest = await prisma.message.create({
      data: { conversationId: c.id, direction: "inbound", senderName: "Ayşe", authorType: "guest", body: "Wifi şifresi nedir?", createdAt: new Date(Date.now() - 60_000) },
    });
    const ai = await prisma.message.create({
      data: { conversationId: c.id, direction: "outbound", senderName: "GuestOps AI", authorType: "ai", aiIntent: "wifi", body: "Wifi şifresi kapının yanında." },
    });
    // Teslim sonrası, onarıcı koşmadan önce ev sahibi "Tamamlandı" dedi → `done`; onarıcı onu "answered"a çevirmez.
    const item = await prisma.conversationItem.create({
      data: { organizationId: orgId, conversationId: c.id, messageId: guest.id, kind: "wifi", sources: "lexical", status: "done", answeredByMessageId: ai.id },
    });
    await prisma.messageOutbox.create({
      data: {
        organizationId: orgId, conversationId: c.id, messageId: ai.id, channel: "airbnb", externalReservationId: "res-rc2", messageType: "ai",
        body: ai.body, idempotencyKey: "reclose-2", status: "sent", sentAt: new Date(), providerMessageId: "PM-RC2",
      },
    });
    const send = vi.fn(async () => ({ ok: true, providerMessageId: "x" }));
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect((await prisma.conversationItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("done");
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: "reclose-2" } })).deliveryEffectAt).not.toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});
