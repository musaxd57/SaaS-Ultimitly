import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// "KARAR BEKLİYOR" — talep satırı P2002 ile okuma ARASINDA silindiyse (öteki yolun e-postası düştü, talebi geri verdi) temkinli yön
// "uçuşta": kart damgası geri verilir, sonraki geçiş bildirir (Haiku 10-23 öğle; `notifyHostReplyWaiting` ile aynı kural).
// Prisma temsilcisine casus sonraki testlere sızabildiği için AYRI dosyada (CLAUDE.md).
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) } }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { emailService } from "@/lib/email";
import { notifyTurnDecisions } from "@/lib/decisions/notify";
import { openTurnDecisions } from "@/lib/decisions/store";
import { REPLY_WAITING_MAIL_PREFIX, REPLY_WAITING_SENT } from "@/lib/host-reply-waiting";

const mockMail = vi.mocked(emailService.sendReporting);

describe("karar bildirimi — talep arada silindi", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockMail.mockResolvedValue({ ok: true } as never);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 P2002 sonrası okuma null → 'in_flight', kart damgası geri verilir (okuma 'gönderildi' görseydi 'deduped' olurdu)", async () => {
    const org = await prisma.organization.create({ data: { name: "Org", timezone: "Europe/Istanbul", alertEmail: "host@example.com" } });
    const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
    const conversation = await prisma.conversation.create({
      data: { propertyId: property.id, guestIdentifier: "Ada", channel: "airbnb", externalReservationId: "r-1" },
    });
    const m = await prisma.message.create({ data: { conversationId: conversation.id, direction: "inbound", senderName: "Ada", body: "13:00'te girebilir miyiz?" } });
    const [card] = await openTurnDecisions(prisma, {
      organizationId: org.id,
      conversationId: conversation.id,
      reservationId: null,
      lang: "tr",
      now: new Date(),
      decisions: [{ kind: "early_checkin", messageId: m.id, itemId: null, requestedTime: "13:00", dayKey: null }],
    });
    // Satır "gönderildi" onaylı durur (oluşturma P2002 alır); okuma anında silinmiş gibi null döner.
    await prisma.systemLock.create({
      data: { name: `${REPLY_WAITING_MAIL_PREFIX}${m.id}`, lockedUntil: new Date(Date.now() + 3_600_000), holder: REPLY_WAITING_SENT },
    });
    const spy = vi.spyOn(prisma.systemLock, "findUnique").mockResolvedValueOnce(null as never);
    let outcome: string;
    let reads: number;
    try {
      outcome = await notifyTurnDecisions({
        organizationId: org.id,
        conversation: { id: conversation.id, guestIdentifier: "Ada" },
        property: { name: "Lale" },
        decisions: [card],
        messageIds: [m.id],
        lockMessageId: m.id,
      });
      reads = spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
    expect(reads).toBe(1);
    expect(outcome).toBe("in_flight");
    expect(mockMail).not.toHaveBeenCalled();
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: card.id } })).notifiedAt).toBeNull();
  });
});
