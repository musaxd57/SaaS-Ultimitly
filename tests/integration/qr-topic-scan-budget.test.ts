import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// QR KONU TARAMASI — KARAKTER BÜTÇESİ (09-23 denetimi, ÖLÇÜLDÜ)
//
// `buildGuestChatContextWindow` her QR POST'unda pencere DIŞINDA açık kalan konuları
// bulmak için 120 mesaja kadar `classifyFallback` çalıştırıyordu ve bu döngünün KARAKTER
// bütçesi YOKTU (pencerenin kendisinde var). Aşım POST'ları da kaydedildiği için tek bir
// misafir birkaç dakikada 120 adet 2.000 karakterlik düşmanca mesaj biriktirip her sonraki
// POST'ta paylaşılan Node sürecini ~20 sn (eski sınıflandırıcı) dondurabiliyordu.
//
// Pin SÜREYE değil ÇAĞRI SAYISINA bakar (CI makinesinin hızına bağlı sahte kırmızı yok):
// sınıflandırıcı gerçek hâliyle sarılır, yalnız çağrılar sayılır.
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai/fallback", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai/fallback")>();
  return { ...actual, classifyFallback: vi.fn(actual.classifyFallback) };
});

import { classifyFallback } from "@/lib/ai/fallback";
import {
  buildGuestChatContextWindow,
  ensureGuestChatConversation,
  QR_TOPIC_SCAN_CHAR_BUDGET,
} from "@/lib/guest-chat";

const mockClassify = vi.mocked(classifyFallback);
const DAY = 86_400_000;
/** Düşmanca ama nötr (kapanış/şikâyet DEĞİL) 2.000 karakterlik misafir metni. */
const ADV = "a'".repeat(1000);

async function seedConversation(messages: { direction: "inbound" | "outbound"; body: string }[]) {
  const { propertyId } = await makeOrgWithProperty();
  const reservation = await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Test Misafir",
      arrivalDate: new Date(Date.now() - DAY),
      departureDate: new Date(Date.now() + 2 * DAY),
      status: "confirmed",
      channel: "manual",
      currency: "EUR",
    },
  });
  const conversationId = await ensureGuestChatConversation(propertyId, {
    id: reservation.id,
    guestName: reservation.guestName,
  });
  const t0 = Date.now() - 60 * 60_000;
  await prisma.message.createMany({
    data: messages.map((m, i) => ({
      conversationId,
      direction: m.direction,
      senderName: m.direction === "inbound" ? "Misafir" : "Ev sahibi",
      body: m.body,
      createdAt: new Date(t0 + i * 1000),
    })),
  });
  return conversationId;
}

describe("QR konu taraması — sınıflandırma karakter bütçesi", () => {
  beforeEach(async () => {
    await resetDb();
    mockClassify.mockClear();
  });

  it("🚨 120 × 2.000 karakterlik misafir mesajı → sınıflandırma BÜTÇEYLE sınırlı (eskiden 120)", async () => {
    const conversationId = await seedConversation(Array.from({ length: 120 }, () => ({ direction: "inbound" as const, body: ADV })));

    await buildGuestChatContextWindow(conversationId);

    const tavan = Math.floor(QR_TOPIC_SCAN_CHAR_BUDGET / ADV.length);
    expect(mockClassify.mock.calls.length, "tarama bütçesi uygulanmıyor").toBeLessThanOrEqual(tavan);
    expect(mockClassify.mock.calls.length, "anti-vakumluk: tarama hiç çalışmadı").toBeGreaterThan(0);
  });

  it("olağan uzun sohbet ETKİLENMEZ: kısa mesajların hepsi taranır, 100 mesaj önceki şikâyet açık konu kalır", async () => {
    const msgs: { direction: "inbound" | "outbound"; body: string }[] = [
      { direction: "inbound", body: "Klima çalışmıyor, içerisi çok sıcak." },
    ];
    for (let i = 0; i < 59; i++) {
      msgs.push({ direction: "outbound", body: "Havlular banyodaki dolapta." });
      msgs.push({ direction: "inbound", body: `Havlular nerede acaba? (${i})` });
    }
    msgs.push({ direction: "outbound", body: "Dolapta." });
    const conversationId = await seedConversation(msgs);

    const w = await buildGuestChatContextWindow(conversationId);

    const inbound = msgs.filter((m) => m.direction === "inbound").length;
    expect(mockClassify.mock.calls.length, "bütçe olağan sohbeti kırptı").toBe(inbound);
    expect(w.openTopics).toContain("complaint");
  });

  it("bütçe yalnız MİSAFİR metnini sayar: uzun host cevapları eski şikâyeti taramadan İTMEZ", async () => {
    // Maliyeti sınıflandırma üretir ve yalnız misafir satırı sınıflanır. Host metnini de
    // saymak, 2.000 karakterlik host cevapları olan olağan bir sohbette şikâyet notunu
    // sebepsiz yere düşürürdü.
    const msgs: { direction: "inbound" | "outbound"; body: string }[] = [
      { direction: "inbound", body: "Klima çalışmıyor, içerisi çok sıcak." },
      ...Array.from({ length: 13 }, () => ({ direction: "outbound" as const, body: "Bilgi: ".repeat(285) })),
      { direction: "inbound", body: "Havlular nerede acaba?" },
    ];
    const conversationId = await seedConversation(msgs);

    const w = await buildGuestChatContextWindow(conversationId);

    expect(w.openTopics).toContain("complaint");
  });

  it("BİLİNEN SINIR (bütçe gerçekten uygulanıyor): şikâyet bütçenin GERİSİNDE kalırsa not taşınmaz", async () => {
    // Bütçe = 24.000; 13 × 2.000 karakterlik misafir mesajı şikâyeti tarama dışına iter.
    // Bedeli yalnız bir BAĞLAM notudur: kapı GÜNCEL mesaja bakar, devir kararı etkilenmez.
    const msgs: { direction: "inbound" | "outbound"; body: string }[] = [
      { direction: "inbound", body: "Klima çalışmıyor, içerisi çok sıcak." },
      ...Array.from({ length: 13 }, () => ({ direction: "inbound" as const, body: ADV })),
    ];
    const conversationId = await seedConversation(msgs);

    const w = await buildGuestChatContextWindow(conversationId);

    expect(w.openTopics).not.toContain("complaint");
  });
});
