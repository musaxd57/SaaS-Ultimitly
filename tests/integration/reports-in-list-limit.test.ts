import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { getHostPerformanceScore } from "@/lib/reports";

// ---------------------------------------------------------------------------
// RAPOR YANIT ORANI ZİNCİRİ BÜYÜK İŞLETMEDE ÇÖKMEZ (ölçek turu 11-04, DB-4).
//
// Zincir son 30 günün konuşmalarının BÜTÜN mesajlarını alıp gelen mesaj kimliklerini `riskEvent.triggerId IN (…)`, giden kimlikleri
// `messageOutbox.messageId IN (…)` ile soruyordu. PostgreSQL bir hazır ifadede en çok 32.767 bağ değişkeni kabul eder ve Prisma listeyi
// parçalamaz → `P2035 too many bind variables` ile Raporlar sayfası 500 veriyordu (sentetik 200 dairede ölçüldü). Burada sınırı tek
// konuşmada 33.000 gelen mesajla aşıyoruz (ham SQL `generate_series` — hızlı tohum).
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

describe("performans skoru — 32.767 bağ değişkeni sınırının üstünde", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("33.000 gelen mesajlı işletmede skor hesaplanır, cevap ve 'cevap gerekmez' kaydı yine sayılır", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const lastAt = new Date(Date.now() - 2 * DAY);
    const conv = await prisma.conversation.create({
      data: {
        propertyId,
        channel: "airbnb",
        guestIdentifier: "G-big",
        externalReservationId: "big",
        status: "answered",
        lastMessageAt: lastAt,
      },
    });
    const N = 33_000;
    const base = Date.now() - 5 * DAY;
    // Gelen mesajlar 5 gün önce, saniyede bir; ardından tek giden cevap (1 saat sonra).
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Message" ("id", "conversationId", "direction", "senderName", "body", "createdAt")
       SELECT 'big-in-' || g, $1, 'inbound', 'G', 'soru', to_timestamp(($2::bigint + g * 1000) / 1000.0)
       FROM generate_series(1, ${N}) AS g`,
      conv.id,
      base,
    );
    await prisma.message.create({
      data: {
        id: "big-out-1",
        conversationId: conv.id,
        direction: "outbound",
        senderName: "Ev sahibi",
        authorType: "host",
        body: "cevap",
        createdAt: new Date(base + N * 1000 + 60 * 60 * 1000),
      },
    });
    expect(await prisma.message.count({ where: { conversationId: conv.id } })).toBe(N + 1);

    // Eskiden burada P2035 fırlıyordu (riskEvent.triggerId IN 33.000 kimlik).
    const score = await getHostPerformanceScore(orgId);
    expect(score.sampleConversations).toBe(1);
    // Gelen mesaj dizisi ~9 saat, cevap 1 saat sonra → 24 saat içinde cevaplandı.
    expect(score.breakdown.responseRate).toBe(100);

    // Giden cevap kuyrukta teslim edilmemiş sayılırsa (kuyruk satırı `status != sent`) cevap SAYILMAZ — kuyruk sorgusu da dilimli
    // yoldan geçiyor ve sonucu gerçekten okunuyor.
    await prisma.messageOutbox.create({
      data: {
        organizationId: orgId,
        conversationId: conv.id,
        messageId: "big-out-1",
        idempotencyKey: "big-out-1",
        channel: "airbnb",
        status: "failed",
        body: "cevap",
      },
    });
    const after = await getHostPerformanceScore(orgId);
    expect(after.breakdown.responseRate).toBe(0);
  }, 120_000);
});
