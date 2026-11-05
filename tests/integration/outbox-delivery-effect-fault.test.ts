import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { drainOutboxOnce } from "@/lib/outbox/worker";
import { reportError } from "@/lib/report-error";

// ---------------------------------------------------------------------------
// T7-OB-5 inceleme (Haiku 11-05): teslim etkisinin bir parçası (devir kilidi) yazılamazsa satır "değerlendirildi" diye DAMGALANMAZ —
// onarıcı sonraki geçişte yeniden dener. Prisma casusu sonraki testlere sızmasın diye AYRI dosya (repo kuralı).
// ---------------------------------------------------------------------------

describe("teslim etkisi yazılamazsa damga yok, onarıcı yeniden dener", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("🚨 devir kilidi yazılamadı → satır damgasız; arıza geçince onarıcı kilidi kurar ve damgalar", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.organization.update({ where: { id: orgId }, data: { autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0 } });
    const c = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "Ayşe", channel: "airbnb", status: "new", externalReservationId: "res-f" } });
    const ai = await prisma.message.create({
      data: { conversationId: c.id, direction: "outbound", senderName: "GuestOps AI", authorType: "ai", aiIntent: "human_request", body: "Ev sahibine iletiyorum." },
    });
    await prisma.messageOutbox.create({
      data: {
        availableAt: new Date(), organizationId: orgId, conversationId: c.id, messageId: ai.id, channel: "airbnb",
        externalReservationId: "res-f", messageType: "ai", body: ai.body, idempotencyKey: "fault-1", status: "pending",
      },
    });
    const realUpdate = prisma.conversation.update.bind(prisma.conversation);
    const realUpdateMany = prisma.conversation.updateMany.bind(prisma.conversation);
    let failing = true; // casus geri yüklenmez (Prisma temsilcisi bozulur) — bayrakla gerçek fonksiyona geçilir
    const hold = (args: { data?: Record<string, unknown> }) => failing && args?.data && "autoReplyHoldUntil" in args.data;
    vi.spyOn(prisma.conversation, "update").mockImplementation(((args: never) =>
      hold(args) ? Promise.reject(new Error("db hiccup")) : realUpdate(args)) as never);
    vi.spyOn(prisma.conversation, "updateMany").mockImplementation(((args: never) =>
      hold(args) ? Promise.reject(new Error("db hiccup")) : realUpdateMany(args)) as never);
    const send = vi.fn(async () => ({ ok: true, providerMessageId: "PM-F" }));
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: "fault-1" } })).deliveryEffectAt).toBeNull();
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: c.id } })).autoReplyHoldUntil).toBeNull();

    failing = false; // arıza geçti
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: c.id } })).autoReplyHoldUntil).not.toBeNull();
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: "fault-1" } })).deliveryEffectAt).not.toBeNull();
    expect(send).toHaveBeenCalledTimes(1); // onarıcı asla yeniden göndermez
  });
});
