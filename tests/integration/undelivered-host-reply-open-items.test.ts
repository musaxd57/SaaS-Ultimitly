import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { listConversationItems, openItemCounts } from "@/lib/conversation-items/store";
import { listConversationDecisions, openTurnDecisions, claimDecisionNotification } from "@/lib/decisions/store";
import { __resetOutboxPresence } from "@/lib/outbox/presence";

// ---------------------------------------------------------------------------
// Codex 11-17 C2 — misafire KESİNLİKLE ulaşmamış ev sahibi cevabı açık ihtiyacı gizlemez. "Ev sahibi yazdı" türetmesi (öğe defteri +
// karar kartı) teslim durumuna hiç bakmıyordu: kuyrukta başarısız / engellenmiş / iptal edilmiş cevap balonda "Gönderilemedi" derken
// "Klima çalışmıyor" öğesi açık işlerden ve rozetten düşüyordu. Kural `operator-replies.ts` ile AYNI (talimat 09-07 §5, tek kaynak
// `NOT_DELIVERED_STATUSES`). Belirsiz (`ambiguous` / `review`) ve yerel cevap için davranış DEĞİŞMEZ (ürün kararı S-1 / S-2 bekliyor).
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const TZ = "Europe/Istanbul";
const utcDay = (offset: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
};

async function world() {
  const org = await prisma.organization.create({ data: { name: "Org", timezone: TZ } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" } });
  const arrival = utcDay(1);
  const reservation = await prisma.reservation.create({
    data: { propertyId: property.id, guestName: "Ada", arrivalDate: arrival, departureDate: new Date(arrival.getTime() + 2 * DAY), status: "confirmed", channel: "airbnb" },
  });
  const conversation = await prisma.conversation.create({
    data: { propertyId: property.id, reservationId: reservation.id, guestIdentifier: "Ada", channel: "airbnb", externalReservationId: "r-c2" },
  });
  const msg = (body: string, minutesAgo: number, direction: "inbound" | "outbound" = "inbound") =>
    prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction,
        senderName: direction === "inbound" ? "Ada" : "Ev Sahibi",
        authorType: direction === "inbound" ? "guest" : "host",
        body,
        createdAt: new Date(Date.now() - minutesAgo * 60_000),
      },
    });
  /** Ev sahibinin cevabı + kuyruk satırı (`messageId` bağlı) verilen durumda. */
  const hostReplyWithOutbox = async (status: string, minutesAgo: number) => {
    const m = await msg("Teknisyen yarın gelecek.", minutesAgo, "outbound");
    await prisma.messageOutbox.create({
      data: {
        organizationId: org.id,
        conversationId: conversation.id,
        messageId: m.id,
        messageType: "manual",
        channel: "airbnb",
        externalReservationId: "r-c2",
        body: m.body,
        idempotencyKey: `k-${m.id}`,
        status,
      },
    });
    return m;
  };
  return { org, conversation, reservation, arrivalKey: arrival.toISOString().slice(0, 10), msg, hostReplyWithOutbox };
}

describe("C2 — kesin gitmemiş ev sahibi cevabı 'ev sahibi yazdı' sayılmaz", () => {
  beforeEach(async () => {
    await resetDb();
    __resetOutboxPresence();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function openItem(w: Awaited<ReturnType<typeof world>>) {
    const guest = await w.msg("Klima çalışmıyor.", 60);
    return prisma.conversationItem.create({
      data: { organizationId: w.org.id, conversationId: w.conversation.id, messageId: guest.id, kind: "maintenance", sensitivity: "normal", sources: "lexical", status: "open" },
    });
  }

  describe.each(["failed", "blocked", "canceled"])("kuyruk durumu %s", (status) => {
    it("🚨 öğe defteri: öğe AÇIK kalır (listConversationItems + openItemCounts)", async () => {
      const w = await world();
      const item = await openItem(w);
      await w.hostReplyWithOutbox(status, 30);
      const views = await listConversationItems(prisma, { organizationId: w.org.id, conversationId: w.conversation.id });
      expect(views.find((v) => v.id === item.id)?.effective).toBe("open");
      const counts = await openItemCounts(prisma, { organizationId: w.org.id, conversationIds: [w.conversation.id] });
      expect(counts.get(w.conversation.id)).toBe(1);
    });

    it("🚨 karar kartı: bekleyen kart 'yanıtladınız' OLMAZ (bekliyor kalır)", async () => {
      const w = await world();
      const asked = await w.msg("13:00'te girebilir miyiz?", 60);
      const [card] = await openTurnDecisions(prisma, {
        organizationId: w.org.id,
        conversationId: w.conversation.id,
        reservationId: w.reservation.id,
        lang: "tr",
        now: new Date(),
        decisions: [{ kind: "early_checkin", messageId: asked.id, itemId: null, requestedTime: "13:00", dayKey: w.arrivalKey }],
      });
      await w.hostReplyWithOutbox(status, 30);
      const views = await listConversationDecisions(prisma, { organizationId: w.org.id, conversationId: w.conversation.id, timeZone: TZ, now: new Date() });
      expect(views.find((v) => v.id === card.id)?.effective).toBe("pending");
    });

    it("🚨 karar kartı bildirim damgası: gitmemiş cevap 'elle cevapladı' sayılmaz → yeni karta damga miras kalır", async () => {
      const w = await world();
      const base = { organizationId: w.org.id, conversationId: w.conversation.id, reservationId: w.reservation.id, lang: "tr", now: new Date() };
      const m1 = await w.msg("13:00'te girebilir miyiz?", 60);
      const [old] = await openTurnDecisions(prisma, { ...base, decisions: [{ kind: "early_checkin", messageId: m1.id, itemId: null, requestedTime: "13:00", dayKey: w.arrivalKey }] });
      expect(await claimDecisionNotification(prisma, { organizationId: w.org.id, id: old.id, now: new Date() })).toBe(true);
      await w.hostReplyWithOutbox(status, 50);
      const m2 = await w.msg("Peki 12:00 olur mu?", 30);
      const [fresh] = await openTurnDecisions(prisma, { ...base, decisions: [{ kind: "early_checkin", messageId: m2.id, itemId: null, requestedTime: "12:00", dayKey: w.arrivalKey }] });
      expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: fresh.id } })).notifiedAt).not.toBeNull();
    });
  });

  // KONTROL: kanal KABUL ettiyse ya da sonuç BELİRSİZSE (ulaşmış olabilir) bugünkü davranış — "ev sahibi yazdı".
  describe.each(["sent", "pending", "ambiguous", "review"])("KONTROL — kuyruk durumu %s", (status) => {
    it("öğe 'ev sahibi yazdı', rozet düşer; bekleyen kart 'yanıtladınız'", async () => {
      const w = await world();
      const item = await openItem(w);
      const asked = await w.msg("13:00'te girebilir miyiz?", 55);
      const [card] = await openTurnDecisions(prisma, {
        organizationId: w.org.id,
        conversationId: w.conversation.id,
        reservationId: w.reservation.id,
        lang: "tr",
        now: new Date(),
        decisions: [{ kind: "early_checkin", messageId: asked.id, itemId: null, requestedTime: "13:00", dayKey: w.arrivalKey }],
      });
      await w.hostReplyWithOutbox(status, 30);
      const views = await listConversationItems(prisma, { organizationId: w.org.id, conversationId: w.conversation.id });
      expect(views.find((v) => v.id === item.id)?.effective).toBe("host_replied");
      expect((await openItemCounts(prisma, { organizationId: w.org.id, conversationIds: [w.conversation.id] })).get(w.conversation.id)).toBeUndefined();
      const cards = await listConversationDecisions(prisma, { organizationId: w.org.id, conversationId: w.conversation.id, timeZone: TZ, now: new Date() });
      expect(cards.find((v) => v.id === card.id)?.effective).toBe("host_replied");
    });
  });

  it("KONTROL — gitmemiş cevaptan SONRA teslim edilmiş ikinci cevap 'ev sahibi yazdı' sayılır (süzgeç yalnız o mesajı düşer)", async () => {
    const w = await world();
    const item = await openItem(w);
    await w.hostReplyWithOutbox("failed", 30);
    await w.hostReplyWithOutbox("sent", 20);
    const views = await listConversationItems(prisma, { organizationId: w.org.id, conversationId: w.conversation.id });
    expect(views.find((v) => v.id === item.id)?.effective).toBe("host_replied");
  });

  it("KONTROL — kuyruk hiç kullanılmamışsa (doğrudan yol) ev sahibi cevabı bugünkü gibi 'ev sahibi yazdı'", async () => {
    const w = await world();
    const item = await openItem(w);
    await w.msg("Teknisyen yarın gelecek.", 30, "outbound");
    const views = await listConversationItems(prisma, { organizationId: w.org.id, conversationId: w.conversation.id });
    expect(views.find((v) => v.id === item.id)?.effective).toBe("host_replied");
  });
});
