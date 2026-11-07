import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// HOST KARAR MOTORU — "KARAR BEKLİYOR" E-POSTASI: tur başına TEK bildirim.
//  · Kilit turun SON mesajı (K10 "Misafir cevabınızı bekliyor" ile aynı) — kart turun daha eski bir mesajına bağlı olsa da.
//  · Hassas öğe acil e-postası turun HERHANGİ bir mesajına gittiyse e-posta yok, ama kart damgalanır (sonraki tur atmasın).
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
import { HELD_MAIL_PREFIX } from "@/lib/conversation-items/flow";

const mockMail = vi.mocked(emailService.sendReporting);

async function world() {
  const org = await prisma.organization.create({ data: { name: "Org", timezone: "Europe/Istanbul", alertEmail: "host@example.com" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" } });
  const conversation = await prisma.conversation.create({
    data: { propertyId: property.id, guestIdentifier: "Ada", channel: "airbnb", externalReservationId: "r-1" },
  });
  const m1 = await prisma.message.create({
    data: { conversationId: conversation.id, direction: "inbound", senderName: "Ada", body: "13:00'te girebilir miyiz?", createdAt: new Date(Date.now() - 120_000) },
  });
  const m2 = await prisma.message.create({ data: { conversationId: conversation.id, direction: "inbound", senderName: "Ada", body: "?" } });
  const [card] = await openTurnDecisions(prisma, {
    organizationId: org.id,
    conversationId: conversation.id,
    reservationId: null,
    lang: "tr",
    now: new Date(),
    decisions: [{ kind: "early_checkin", messageId: m1.id, itemId: null, requestedTime: "13:00", dayKey: null }],
  });
  const notify = (now?: Date) =>
    notifyTurnDecisions({
      ...(now ? { now } : {}),
      organizationId: org.id,
      conversation: { id: conversation.id, guestIdentifier: "Ada" },
      property: { name: "Lale" },
      decisions: [card],
      messageIds: [m1.id, m2.id],
      lockMessageId: m2.id,
    });
  return { card, m1, m2, notify };
}

describe("karar bildirimi — tur başına tek e-posta", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockMail.mockResolvedValue({ ok: true } as never);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("kilit turun SON mesajında (K10 ile aynı): o mesaj için 'Misafir cevabınızı bekliyor' gittiyse 'Karar bekliyor' gitmez", async () => {
    const w = await world();
    await prisma.systemLock.create({
      data: { name: `${REPLY_WAITING_MAIL_PREFIX}${w.m2.id}`, lockedUntil: new Date(Date.now() + 3_600_000), holder: REPLY_WAITING_SENT },
    });
    expect(await w.notify()).toBe("deduped");
    expect(mockMail).not.toHaveBeenCalled();
  });

  it("🚨 Opus 10-23 öğle B7: öteki yolun e-postası UÇUŞTAYSA (onaysız, yeni talep) 'in_flight' — kart damgası geri verilir, sonraki geçiş bildirebilir", async () => {
    const w = await world();
    await prisma.systemLock.create({ data: { name: `${REPLY_WAITING_MAIL_PREFIX}${w.m2.id}`, lockedUntil: new Date(Date.now() + 3_600_000) } });
    expect(await w.notify()).toBe("in_flight");
    expect(mockMail).not.toHaveBeenCalled();
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: w.card.id } })).notifiedAt).toBeNull();
    // Onaysız ama eski talep (10 dk'dan eski) sonuçlanmış sayılır → "deduped", damga kalır.
    expect(await w.notify(new Date(Date.now() + 11 * 60_000))).toBe("deduped");
  });

  it("hassas öğe e-postası turun ESKİ mesajına gittiyse e-posta yok, kart yine damgalanır", async () => {
    const w = await world();
    await prisma.systemLock.create({ data: { name: `${HELD_MAIL_PREFIX}${w.m1.id}`, lockedUntil: new Date(Date.now() + 3_600_000) } });
    expect(await w.notify()).toBe("deduped");
    expect(mockMail).not.toHaveBeenCalled();
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: w.card.id } })).notifiedAt).not.toBeNull();
  });

  it("KONTROL: kilit yoksa TEK e-posta; kilit turun son mesajında alınır", async () => {
    const w = await world();
    expect(await w.notify()).toBe("mailed");
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(await prisma.systemLock.count({ where: { name: `${REPLY_WAITING_MAIL_PREFIX}${w.m2.id}` } })).toBe(1);
  });
});
