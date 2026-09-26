import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { getHostPerformanceScore, ratePct } from "@/lib/reports";

// ---------------------------------------------------------------------------
// PERFORMANS SKORU — POPÜLASYON DENETİMİ (08-08, hepsi ölçülerek bulundu)
//
// Üç ayrı kusur, tek kart:
//  1) Şikayet oranının PAYI `createdAt` ile, PAYDASI `lastMessageAt` ile
//     pencereleniyordu → iki farklı küme. Aynı veriden hem "%0" hem "%167"
//     üretilebiliyordu (aşağıdaki iki senaryo tam olarak bunlar).
//  2) Bir dairesi olan ama henüz hiç rezervasyonu olmayan YENİ org, tek bileşen
//     olarak doluluk %0 aldığı için ilk gün "0/100 · F · Kritik" görüyordu.
//  3) Yanıt oranı QR concierge ("chat") thread'lerini de sayıyordu — bot orada
//     saniyeler içinde cevaplar, oran şişer. Kardeş kart (`aiReplies`) o kanalı
//     BİLEREK dışlıyor, yani aynı sayfada iki popülasyon vardı.
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const agoMs = (ms: number) => new Date(Date.now() - ms);

describe("performans skoru — pay ve payda AYNI popülasyondan gelir", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Tek konuşma: oluşturulma anı, son mesaj anı ve durum AYRI AYRI verilir —
   *  kusurun tamamı bu üçünün birbirinden bağımsız olmasından doğuyordu. */
  async function conv(opts: {
    createdAt: Date;
    lastMessageAt: Date;
    status?: string;
    channel?: string;
  }) {
    return prisma.conversation.create({
      data: {
        propertyId,
        guestIdentifier: "G",
        channel: opts.channel ?? "airbnb",
        status: opts.status ?? "answered",
        createdAt: opts.createdAt,
        lastMessageAt: opts.lastMessageAt,
      },
    });
  }

  it("ESKİ HÂLDE %0 OKUYORDU: 40 gün önce açılmış ama HÂLÂ yazışılan şikayetler sayılır", async () => {
    // 4 şikayet: 40 gün önce açıldı (pay penceresinin DIŞINDA), 2 gün önce hâlâ
    // yazışılıyor (paydanın İÇİNDE) → eski kod payı 0 sayıp "%0" basıyordu.
    for (let i = 0; i < 4; i++) {
      await conv({ createdAt: ago(40), lastMessageAt: ago(2), status: "problem" });
    }
    // 6 sağlıklı aktif thread.
    for (let i = 0; i < 6; i++) {
      await conv({ createdAt: ago(2), lastMessageAt: ago(2) });
    }
    // TUZAK: pencerenin TAMAMEN dışında kalan şikayetler. Bunlar ne paya ne
    // paydaya girmeli — payı "pencereden bağımsız say" diye gevşeten bir
    // değişiklik burada %90'a fırlar.
    for (let i = 0; i < 5; i++) {
      await conv({ createdAt: ago(60), lastMessageAt: ago(60), status: "problem" });
    }

    const score = await getHostPerformanceScore(orgId);
    expect(score.breakdown.complaintRate).toBe(40); // 4 / 10 — eski kod: 0
  });

  it("ESKİ HÂLDE %167 OKUYORDU: Hospitable ithalinde createdAt=ithal anı, lastMessageAt=sağlayıcı damgası", async () => {
    // Bağlantı kurulduğu an 5 eski thread "problem" olarak ithal edilir:
    // createdAt = ŞİMDİ (pay penceresinde), lastMessageAt = 40 gün önce (payda
    // penceresinin dışında) → eski kod 5/3 = %167 basıyordu ve arayüz bunu
    // kelepçesiz yazdırıyordu.
    for (let i = 0; i < 5; i++) {
      await conv({ createdAt: new Date(), lastMessageAt: ago(40), status: "problem" });
    }
    for (let i = 0; i < 3; i++) {
      await conv({ createdAt: new Date(), lastMessageAt: ago(1) });
    }

    const score = await getHostPerformanceScore(orgId);
    expect(score.breakdown.complaintRate).toBe(0); // 0 / 3 — eski kod: 167
    expect(score.breakdown.complaintRate!).toBeLessThanOrEqual(100);
  });

  it("QR concierge ('chat') hem yanıt oranından hem şikayet paydasından DIŞLANIR", async () => {
    // Gerçek kanal: misafir 30 saat önce sordu, kimse cevaplamadı → SLA doldu.
    const real = await conv({ createdAt: ago(3), lastMessageAt: ago(2), status: "problem" });
    await prisma.message.create({
      data: {
        conversationId: real.id,
        direction: "inbound",
        senderName: "G",
        body: "b",
        createdAt: agoMs(30 * 60 * 60 * 1000),
      },
    });
    // Sağlıklı ikinci gerçek thread (şikayet oranının paydası 2 olsun).
    await conv({ createdAt: ago(3), lastMessageAt: ago(2) });

    // 8 QR sohbeti: bot 1 saniyede cevaplıyor.
    for (let i = 0; i < 8; i++) {
      const c = await conv({ createdAt: ago(1), lastMessageAt: ago(1), channel: "chat" });
      await prisma.message.create({
        data: {
          conversationId: c.id,
          direction: "inbound",
          senderName: "G",
          body: "b",
          createdAt: agoMs(24 * 60 * 60 * 1000),
        },
      });
      await prisma.message.create({
        data: {
          conversationId: c.id,
          direction: "outbound",
          senderName: "GuestOps AI",
          body: "b",
          createdAt: agoMs(24 * 60 * 60 * 1000 - 1000),
        },
      });
    }

    const score = await getHostPerformanceScore(orgId);
    // Kanal filtresi yokken: 8 anında yanıt + 1 kaçırılan = %89.
    expect(score.breakdown.responseRate).toBe(0);
    // Kanal filtresi yokken: 1 / 10 = %10.
    expect(score.breakdown.complaintRate).toBe(50);
  });

  it("YENİ ORG: dairesi var, rezervasyonu yok → boş durum (F/Kritik DEĞİL)", async () => {
    const score = await getHostPerformanceScore(orgId);
    expect(score.breakdown.occupancyRate).toBeNull();
    expect(score.hasData).toBe(false); // eski kod: true → "0/100 · F · Kritik"
    expect(score.grade).not.toBe("F");
    expect(score.label).not.toBe("Kritik");
  });

  it("REZERVASYONU OLAN org'da GERÇEK %0 doluluk aynen sayılır (metrik susturulmadı)", async () => {
    // Geçmişte kalmış, bu geceyi kapsamayan bir konaklama: veri VAR, doluluk 0.
    await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Eski Misafir",
        arrivalDate: ago(10),
        departureDate: ago(8),
        status: "confirmed",
      },
    });

    const score = await getHostPerformanceScore(orgId);
    expect(score.breakdown.occupancyRate).toBe(0);
    expect(score.hasData).toBe(true);
    expect(score.grade).toBe("F"); // gerçek veriye dayanan gerçek not
  });

  it("İPTAL EDİLMİŞ rezervasyon 'veri' saymaz — org hâlâ boş durumda", async () => {
    await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "İptal",
        arrivalDate: ago(2),
        departureDate: ago(1),
        status: "cancelled",
      },
    });

    const score = await getHostPerformanceScore(orgId);
    expect(score.breakdown.occupancyRate).toBeNull();
    expect(score.hasData).toBe(false);
  });
});

describe("ratePct — yüzde SÖZLEŞMESİ (0..100, bölünecek şey yoksa null)", () => {
  it("payda payı aşarsa 100'e KELEPÇELENİR (arayüz ham basıyor)", () => {
    expect(ratePct(5, 3)).toBe(100);
    expect(ratePct(1000, 1)).toBe(100);
  });

  it("kelepçe SADECE sınırda çalışır — normal oranlar olduğu gibi kalır", () => {
    expect(ratePct(1, 4)).toBe(25);
    expect(ratePct(2, 3)).toBe(67); // yuvarlama korunur
    expect(ratePct(0, 7)).toBe(0);
    expect(ratePct(4, 4)).toBe(100);
  });

  it("negatif pay 0'a kelepçelenir; payda yoksa null (0/NaN/Infinity DEĞİL)", () => {
    expect(ratePct(-3, 4)).toBe(0);
    expect(ratePct(0, 0)).toBeNull();
    expect(ratePct(3, 0)).toBeNull();
    expect(ratePct(3, -1)).toBeNull();
  });
});
