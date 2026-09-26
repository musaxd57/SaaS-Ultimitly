import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { loadConversationState, loadConversationStateForConversation } from "@/lib/ai/conversation-state-loader";

// ---------------------------------------------------------------------------
// Konuşma Anlama Durumu v1 dilim B — yükleyici (bayrak AÇIK). Karar kayıtları ve yaşam döngüsü damgaları KİRACI kapsamlı
// okunur: başka bir kiracının aynı tetikleyici kimliğini taşıyan kaydı ya da rezervasyonu özete SIZMAZ (değişmez 16).
// Bayrak kapalıyken sorgu atılmadığı ayrı dosyada (`conversation-state-loader-off.test.ts`; spy sızmasın diye).
// ---------------------------------------------------------------------------

async function seedOrg(name: string) {
  const org = await prisma.organization.create({ data: { name } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Ayşe",
      arrivalDate: new Date("2026-06-10T00:00:00Z"),
      departureDate: new Date("2026-06-12T00:00:00Z"),
      channel: "airbnb",
      status: "confirmed",
      welcomeSentAt: new Date("2026-06-09T10:00:00Z"),
    },
  });
  const conversation = await prisma.conversation.create({
    data: { propertyId: property.id, channel: "airbnb", guestIdentifier: "Ayşe", status: "new", reservationId: reservation.id },
  });
  return { orgId: org.id, propertyId: property.id, reservationId: reservation.id, conversationId: conversation.id };
}

async function addMessage(
  conversationId: string,
  direction: "inbound" | "outbound",
  body: string,
  at: number,
  author: { senderName: string; authorType: "guest" | "ai" | "host" } = { senderName: "Ayşe", authorType: "guest" },
) {
  return prisma.message.create({
    data: { conversationId, direction, ...author, body, createdAt: new Date(Date.UTC(2026, 5, 10, 8, 0, at)) },
    select: { id: true, direction: true, senderName: true, authorType: true, systemEventType: true, body: true },
  });
}

async function held(organizationId: string, triggerId: string, riskType: string) {
  await prisma.riskEvent.create({
    data: {
      organizationId,
      surface: "auto_reply",
      triggerId,
      finalDecision: "human_review",
      riskLevel: "medium",
      riskType,
      reason: "low_confidence_or_risky",
    },
  });
}

describe("loadConversationState — bayrak açık", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("karar kaydından açık konu + yaşam döngüsü damgası (tutulan mesajdan sonra misafire hiçbir şey gitmedi)", async () => {
    const a = await seedOrg("A");
    const m1 = await addMessage(a.conversationId, "inbound", "Klima çalışmıyor", 1);
    const m2 = await addMessage(a.conversationId, "inbound", "Haber var mı?", 2);
    await held(a.orgId, m1.id, "complaint");

    const s = await loadConversationState({ organizationId: a.orgId, messages: [m1, m2], reservationId: a.reservationId });
    expect(s).toEqual({
      outbound: 0,
      hostOutbound: 0,
      unansweredGuest: 2,
      items: [{ topic: "complaint", status: "pending_host" }],
      lifecycleSent: ["welcome"],
    });
  });

  it("🚨 KİRACI: başka org'un aynı tetikleyici kimliğini taşıyan kaydı ve başka org'un rezervasyonu okunmaz", async () => {
    const a = await seedOrg("A");
    const b = await seedOrg("B");
    const m1 = await addMessage(a.conversationId, "inbound", "Erken girebilir miyiz?", 1);
    // B kiracısında, A'nın mesaj kimliğiyle bir karar kaydı (kimlik çakışması / kötü niyetli satır).
    await held(b.orgId, m1.id, "complaint");

    const s = await loadConversationState({ organizationId: a.orgId, messages: [m1], reservationId: b.reservationId });
    expect(s?.items).toEqual([]);
    expect(s?.lifecycleSent).toEqual([]); // B'nin rezervasyonu A kapsamında bulunmaz
  });

  it("yalnız cevap yüzeylerinin kararı okunur: kelime ağının `alerts` kaydı konu adı olmaz", async () => {
    const a = await seedOrg("A");
    const m1 = await addMessage(a.conversationId, "inbound", "Klima çalışmıyor", 1);
    await prisma.riskEvent.create({
      data: { organizationId: a.orgId, surface: "alerts", triggerId: m1.id, finalDecision: "human_review", riskType: "complaint", reason: "keyword_escalated" },
    });
    const s = await loadConversationState({ organizationId: a.orgId, messages: [m1] });
    expect(s?.items).toEqual([]);
  });

  it("QR girişi konuşmanın mesajlarını KİRACI kapsamlı kendisi okur; başka org'un konuşması boş özet verir", async () => {
    const a = await seedOrg("A");
    const b = await seedOrg("B");
    const m1 = await addMessage(a.conversationId, "inbound", "Havlu lazım", 1);
    await addMessage(a.conversationId, "outbound", "Talebiniz kaydedildi; ev sahibiniz görebilir.", 2, {
      senderName: "GuestOps AI",
      authorType: "ai",
    });
    await prisma.riskEvent.create({
      data: {
        organizationId: a.orgId,
        surface: "guest_chat",
        triggerId: m1.id,
        finalDecision: "human_review",
        riskLevel: "medium",
        riskType: "human_request",
        reason: "escalated_to_human",
      },
    });

    const s = await loadConversationStateForConversation({
      organizationId: a.orgId,
      conversationId: a.conversationId,
      reservationId: a.reservationId,
    });
    expect(s?.items).toEqual([{ topic: "human", status: "deferred_to_host" }]);
    expect(s?.outbound).toBe(1);
    expect(s?.unansweredGuest).toBe(0);
    // QR: cevaplanan mesaj henüz kayıtlı değil → sayıma katılır (kanal ve gelen kutusuyla aynı anlam).
    const pending = await loadConversationStateForConversation({
      organizationId: a.orgId,
      conversationId: a.conversationId,
      reservationId: a.reservationId,
      pendingGuestMessage: true,
    });
    expect(pending?.unansweredGuest).toBe(1);
    expect(pending?.items).toEqual(s?.items);

    const foreign = await loadConversationStateForConversation({ organizationId: b.orgId, conversationId: a.conversationId });
    expect(foreign).toEqual({ outbound: 0, hostOutbound: 0, unansweredGuest: 0, items: [], lifecycleSent: [] });
  });
});
