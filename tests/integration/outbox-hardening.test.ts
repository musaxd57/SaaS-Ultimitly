import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// Outbox flag-açılış sertleştirmesi (Codex 07-23):
//  (1) STATE GATE — state.ts'in kapalı geçiş haritası artık settle()'da RUNTIME
//      uygulanır: yasadışı bir geçiş (ör. reconciling→pending — token-miss
//      bug'ının tam sınıfı) YAZILMAZ, reportError ile yüzeylenir; claim doğal
//      olarak expire olur ve satır GERÇEK durumundan akışa döner.
//  (2) DELIVERY-EFFECT HEALER — applyDeliveryEffect best-effort'tur; settle(sent)
//      ile yan-etki arasındaki çökme "teslim edildi ama thread answered olmadı /
//      *SentAt damgalanmadı / externalId bağlanmadı" bırakabilir. Her drain bu
//      etkileri İDEMPOTENT yeniden uygular.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { reportError } from "@/lib/report-error";
import { drainOutboxOnce, __internals } from "@/lib/outbox/worker";
import type { OutboxSendFn } from "@/lib/outbox/worker";

const mockReport = vi.mocked(reportError);
const noSend: OutboxSendFn = vi.fn(async () => ({ ok: true, providerMessageId: "NOPE" }));

async function seedOrgProp() {
  const org = await prisma.organization.create({ data: { name: "Hardening Org" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "D1" } });
  return { orgId: org.id, propertyId: property.id };
}

describe("outbox sertleştirme — state gate + delivery-effect healer", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("STATE GATE: yasadışı reconciling→pending geçişi REDDEDİLİR (yazılmaz + raporlanır); yasal geçiş geçer", async () => {
    const { orgId } = await seedOrgProp();
    const created = await prisma.messageOutbox.create({
      data: {
        organizationId: orgId, conversationId: null, messageId: null, reservationId: null,
        channel: "airbnb", externalReservationId: "res-g1", messageType: "manual", body: "x",
        idempotencyKey: "gate-1", status: "reconciling", claimedBy: "tok-1",
        claimExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    const row = {
      id: created.id, organizationId: orgId, conversationId: null, messageId: null,
      reservationId: null, channel: "airbnb", externalReservationId: "res-g1",
      messageType: "manual", body: "x", status: "reconciling", attemptCount: 1,
    };
    // Yasadışı: reconciling → pending (kör re-POST kapısı). Yazılmamalı.
    const refused = await __internals.settle(row as never, "tok-1", "reconciling", {
      status: "pending", claimedBy: null, claimExpiresAt: null,
    });
    expect(refused).toBe(false);
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("reconciling");
    expect(mockReport).toHaveBeenCalledWith("outbox-illegal-transition", expect.any(Error));
    // Yasal: reconciling → ambiguous geçer (gate yalnız yasadışıyı keser).
    const ok = await __internals.settle(row as never, "tok-1", "reconciling", {
      status: "ambiguous", claimedBy: null, claimExpiresAt: null,
    });
    expect(ok).toBe(true);
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("ambiguous");
  });

  it("HEALER: sent reply'ın kaçan 'answered' + externalId etkileri sonraki drain'de iyileşir; closed/holding_ack'e DOKUNULMAZ", async () => {
    const { orgId, propertyId } = await seedOrgProp();
    const mkConv = (status: string, gid: string) =>
      prisma.conversation.create({
        data: { propertyId, guestIdentifier: gid, channel: "airbnb", status, externalReservationId: `res-${gid}` },
      });
    // (a) Teslim edilmiş manuel reply — etkiler kaçmış: thread "new", externalId null.
    const c1 = await mkConv("new", "g1");
    const m1 = await prisma.message.create({
      data: { conversationId: c1.id, direction: "outbound", senderName: "Host", body: "x" },
    });
    await prisma.messageOutbox.create({
      data: {
        organizationId: orgId, conversationId: c1.id, messageId: m1.id, channel: "airbnb",
        externalReservationId: "res-g1", messageType: "manual", body: "x", idempotencyKey: "h1",
        status: "sent", sentAt: new Date(Date.now() - 60 * 60 * 1000), providerMessageId: "PMX-1",
      },
    });
    // (b) closed thread'li sent reply → healer statüye DOKUNMAZ.
    const c2 = await mkConv("closed", "g2");
    await prisma.messageOutbox.create({
      data: {
        organizationId: orgId, conversationId: c2.id, messageId: null, channel: "airbnb",
        externalReservationId: "res-g2", messageType: "manual", body: "x", idempotencyKey: "h2",
        status: "sent", sentAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    // (c) holding_ack → thread "problem" KALMALI (tasarım gereği healer kapsamı dışı).
    const c3 = await mkConv("problem", "g3");
    await prisma.messageOutbox.create({
      data: {
        organizationId: orgId, conversationId: c3.id, messageId: null, channel: "airbnb",
        externalReservationId: "res-g3", messageType: "holding_ack", body: "x", idempotencyKey: "h3",
        status: "sent", sentAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    await drainOutboxOnce({ send: noSend, tokenFor: async () => "t" });
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: c1.id } })).status).toBe("answered"); // iyileşti
    expect((await prisma.message.findUniqueOrThrow({ where: { id: m1.id } })).externalId).toBe("PMX-1"); // link iyileşti
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: c2.id } })).status).toBe("closed"); // dokunulmadı
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: c3.id } })).status).toBe("problem"); // dokunulmadı
    expect(noSend).not.toHaveBeenCalled(); // healer asla provider'a gitmez
  });

  it("HEALER: lifecycle sent + damga null → *SentAt satırın GERÇEK sentAt'iyle damgalanır; ikinci koşu no-op", async () => {
    const { orgId, propertyId } = await seedOrgProp();
    const deliveredAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const res = await prisma.reservation.create({
      data: {
        propertyId, guestName: "G", channel: "airbnb", status: "confirmed",
        arrivalDate: new Date(Date.now() - 3 * 86_400_000), departureDate: new Date(),
        sourceReference: "res-heal", // checkoutSentAt bilinçli NULL — kaçmış etki
      },
    });
    await prisma.messageOutbox.create({
      data: {
        organizationId: orgId, conversationId: null, messageId: null, reservationId: res.id,
        channel: "airbnb", externalReservationId: "res-heal", messageType: "checkout", body: "x",
        idempotencyKey: "hl1", status: "sent", sentAt: deliveredAt,
      },
    });
    await drainOutboxOnce({ send: noSend, tokenFor: async () => "t" });
    const healed = await prisma.reservation.findUniqueOrThrow({ where: { id: res.id } });
    expect(healed.checkoutSentAt?.getTime()).toBe(deliveredAt.getTime()); // "now" değil, gerçek teslim anı
    // İdempotent: ikinci drain damgayı DEĞİŞTİRMEZ.
    await drainOutboxOnce({ send: noSend, tokenFor: async () => "t" });
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: res.id } })).checkoutSentAt?.getTime()).toBe(
      deliveredAt.getTime(),
    );
  });
});
