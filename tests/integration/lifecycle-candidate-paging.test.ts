import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { seedAutoMessage } from "../helpers/auto-message";

// ---------------------------------------------------------------------------
// MESAJ A26 (Codex 11-10) — GÖNDERİLEMEYEN ADAYLAR SIRAYI TIKAMAZ. Gerçek PostgreSQL, kanal taklit.
// Karşılama / giriş / çıkış göndericileri en erken tarihli 25 adayı alıp döngüde eliyordu. Metni olmayan (ya da metni doldurulamayan)
// dairenin rezervasyonları damgalanmadığı için her geçişte yine ilk 25'i dolduruyor, arkalarındaki gönderilebilir rezervasyona sıra HİÇ
// gelmiyordu — mesaj sessizce gitmiyordu. Adaylar artık sayfa sayfa okunur; "geçişte en çok 25 mesaj" kuralı aynı.
// ---------------------------------------------------------------------------

vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: undefined })),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { sendDueWelcomes, sendDueCheckins, sendDueCheckouts, currentHourInTimeZone } from "@/lib/automation";
import { sendOnChannel } from "@/lib/messaging";
import { tombstoneKeyHash, currentKeyFingerprint } from "@/lib/erasure";

const mockSend = vi.mocked(sendOnChannel);
const DAY = 86_400_000;

/** Şu an yerel saati 08–11 arası olan sabit kaymalı bir saat dilimi (çıkış mesajı yalnız o aralıkta gider). */
function morningZone(): string {
  for (let off = -12; off <= 14; off++) {
    const tz = off === 0 ? "Etc/GMT" : `Etc/GMT${off > 0 ? "-" : "+"}${Math.abs(off)}`;
    const h = currentHourInTimeZone(tz, new Date());
    if (h >= 9 && h <= 10) return tz;
  }
  throw new Error("sabah dilimi bulunamadı");
}

async function seedOrg(timezone = "Europe/Istanbul") {
  const org = await prisma.organization.create({
    data: {
      name: "Org",
      timezone,
      aiSignature: "Lale",
      autoWelcome: true,
      autoWelcomeEnabledAt: new Date(0),
      autoCheckin: true,
      autoCheckinEnabledAt: new Date(0),
      autoCheckout: true,
      autoCheckoutEnabledAt: new Date(0),
    },
  });
  const blocked = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 1" } });
  const good = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 2" } });
  return { orgId: org.id, blockedId: blocked.id, goodId: good.id };
}

/** `count` rezervasyon: gelişleri `firstInDays` günden başlayıp dakikalarla artar (sıra belirli). */
async function seedReservations(propertyId: string, prefix: string, count: number, at: (i: number) => { arrival: Date; departure: Date }) {
  await prisma.reservation.createMany({
    data: Array.from({ length: count }, (_, i) => {
      const { arrival, departure } = at(i);
      return { propertyId, guestName: `Misafir ${prefix}${i}`, arrivalDate: arrival, departureDate: departure, channel: "airbnb", status: "confirmed", sourceReference: `${prefix}-${i}` };
    }),
  });
}
const upcoming = (firstInDays: number) => (i: number) => {
  const arrival = new Date(Date.now() + firstInDays * DAY + i * 60_000);
  return { arrival, departure: new Date(arrival.getTime() + 2 * DAY) };
};

describe("yaşam döngüsü göndericileri — gönderilemeyen adaylar sırayı tıkamaz (A26)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 karşılama: metni OLMAYAN dairenin 30 erken rezervasyonu, metni olan dairenin rezervasyonunu engellemez", async () => {
    const { orgId, blockedId, goodId } = await seedOrg();
    await seedReservations(blockedId, "blk", 30, upcoming(1));
    await seedAutoMessage(goodId, "welcome", "Merhaba {isim}, rezervasyonunuz için teşekkürler.");
    await seedReservations(goodId, "ok", 1, upcoming(5));

    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(1); // ⬅️ ESKİDE 0 (ilk 25 aday hep metinsiz daireden geliyordu)
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(String(mockSend.mock.calls[0][1])).toContain("teşekkürler");
    expect(await prisma.reservation.count({ where: { propertyId: goodId, welcomeSentAt: { not: null } } })).toBe(1);
    expect(out.considered).toBe(31);
  });

  it("🚨 karşılama: metni DOLDURULAMAYAN dairenin 30 erken rezervasyonu da engellemez; atlananlar sayılır, hiçbiri gönderilmez", async () => {
    const { orgId, blockedId, goodId } = await seedOrg();
    await seedAutoMessage(blockedId, "welcome", "Merhaba {isim}, kapı kodu [KOD] olacak.");
    await seedReservations(blockedId, "blk", 30, upcoming(1));
    await seedAutoMessage(goodId, "welcome", "Merhaba {isim}, rezervasyonunuz için teşekkürler.");
    await seedReservations(goodId, "ok", 1, upcoming(5));

    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(1); // ⬅️ ESKİDE 0
    expect(out.unfilled).toBe(30);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await prisma.reservation.count({ where: { propertyId: blockedId, welcomeSentAt: { not: null } } })).toBe(0);
  });

  it("KONTROL: geçişte en çok 25 mesaj kuralı AYNI — 40 gönderilebilir aday: ilk geçiş 25 (en erken gelenler), ikinci geçiş kalan 15", async () => {
    const { orgId, blockedId, goodId } = await seedOrg();
    await seedAutoMessage(goodId, "welcome", "Merhaba {isim}, rezervasyonunuz için teşekkürler.");
    await seedReservations(blockedId, "blk", 1, upcoming(1)); // en öndeki gönderilemeyen aday: sayfa ortasında da 25 sınırı aşılmaz
    await seedReservations(goodId, "ok", 40, upcoming(2));

    expect((await sendDueWelcomes(orgId)).sent).toBe(25);
    const stamped = await prisma.reservation.findMany({ where: { welcomeSentAt: { not: null } }, select: { sourceReference: true } });
    expect(new Set(stamped.map((r) => r.sourceReference))).toEqual(new Set(Array.from({ length: 25 }, (_, i) => `ok-${i}`)));
    expect((await sendDueWelcomes(orgId)).sent).toBe(15);
    expect(mockSend).toHaveBeenCalledTimes(40);
    expect((await sendDueWelcomes(orgId)).sent).toBe(0); // hepsi damgalı — yeniden gönderim yok
  });

  it("okuma SINIRLI: gönderilemeyen aday sayısı okuma sınırını (8 sayfa × 25) aşarsa arkadaki aday bu geçişte beklemeye devam eder (sınırsız tarama yok)", async () => {
    const { orgId, blockedId, goodId } = await seedOrg();
    await seedReservations(blockedId, "blk", 205, upcoming(1));
    await seedAutoMessage(goodId, "welcome", "Merhaba {isim}, rezervasyonunuz için teşekkürler.");
    await seedReservations(goodId, "ok", 1, upcoming(5));
    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(0);
    expect(out.considered).toBe(200);
  });

  it("aynı rezervasyonun kopya satırları (aynı kaynak kimliği) sayfalar arasında da TEK mesaj üretir", async () => {
    const { orgId, blockedId, goodId } = await seedOrg();
    await seedReservations(blockedId, "blk", 26, upcoming(1));
    await seedAutoMessage(goodId, "welcome", "Merhaba {isim}, rezervasyonunuz için teşekkürler.");
    // Aynı rezervasyon iki dairede kayıtlı (kopya): ikisinin de metni var, yine TEK mesaj gider.
    const twin = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: orgId, name: "Lale 3" } });
    await seedAutoMessage(twin.id, "welcome", "Merhaba {isim}, rezervasyonunuz için teşekkürler.");
    const arrival = new Date(Date.now() + 5 * DAY);
    await prisma.reservation.createMany({
      data: [goodId, twin.id].map((propertyId) => ({ propertyId, guestName: "Kopya Misafir", arrivalDate: arrival, departureDate: new Date(arrival.getTime() + DAY), channel: "airbnb", status: "confirmed", sourceReference: "dup-1" })),
    });
    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("🚨 giriş bilgisi: metni olmayan dairenin 30 erken rezervasyonu, metni olan dairenin giriş mesajını engellemez", async () => {
    const { orgId, blockedId, goodId } = await seedOrg();
    // Giriş mesajı gelişe yakın pencerede gider: hepsi bugün içinde, engelleyenler daha erken.
    const soon = (baseMin: number) => (i: number) => {
      const arrival = new Date(Date.now() + (baseMin + i) * 60_000);
      return { arrival, departure: new Date(arrival.getTime() + 2 * DAY) };
    };
    await seedReservations(blockedId, "blk", 30, soon(30));
    await seedAutoMessage(goodId, "checkin", "Merhaba {isim}, giriş 15:00'ten itibaren; anahtar kutusu kapının sağında.");
    await seedReservations(goodId, "ok", 1, soon(120));

    const out = await sendDueCheckins(orgId);
    expect(out.sent).toBe(1); // ⬅️ ESKİDE 0
    expect(String(mockSend.mock.calls[0][1])).toContain("anahtar kutusu");
  });

  it("🚨 çıkış: metni olmayan dairenin bugün çıkan 30 rezervasyonu, metni olan dairenin çıkış mesajını engellemez", async () => {
    const { orgId, blockedId, goodId } = await seedOrg(morningZone());
    const leavingToday = (baseSec: number) => (i: number) => ({ arrival: new Date(Date.now() - 2 * DAY), departure: new Date(Date.now() + (baseSec + i) * 1_000) });
    await seedReservations(blockedId, "blk", 30, leavingToday(0));
    await seedAutoMessage(goodId, "checkout", "Merhaba {isim}, çıkış saati 11:00; anahtarı kutuya bırakabilirsiniz.");
    await seedReservations(goodId, "ok", 1, leavingToday(600));

    const out = await sendDueCheckouts(orgId);
    expect(out.sent).toBe(1); // ⬅️ ESKİDE 0
    expect(String(mockSend.mock.calls[0][1])).toContain("anahtarı kutuya");
  });

  // ── Opus incelemesi 11-11: aynı tıkanma, BAŞKA SEBEP — metni olan ama bu geçişte hiçbir koşulda gönderilmeyecek adaylar ──────────────
  // Açıkça silinmiş (KVKK) misafirin ve kuyruğun sahiplendiği rezervasyonun satırı da damgalanmaz → her geçişte en öne gelir. Eskiden bu
  // 25 aday listeyi dolduruyor, döngüde tek tek atlanıyor, arkadaki gönderilebilir rezervasyona sıra hiç gelmiyordu.
  const WELCOME = "Merhaba {isim}, rezervasyonunuz için teşekkürler.";
  async function outboxRows(orgId: string, prefix: string, count: number, status: string, type = "welcome") {
    await prisma.messageOutbox.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        organizationId: orgId,
        channel: "airbnb",
        externalReservationId: `${prefix}-${i}`,
        messageType: type,
        body: "kuyruktaki eski metin",
        idempotencyKey: `${type}:${orgId}:${prefix}-${i}`,
        status,
      })),
    });
  }

  it("🚨 açıkça SİLİNMİŞ (KVKK) 30 misafirin erken rezervasyonu, arkadaki gönderilebilir rezervasyonu engellemez; silinenlere mesaj GİTMEZ", async () => {
    const { orgId, blockedId, goodId } = await seedOrg();
    await seedAutoMessage(blockedId, "welcome", WELCOME);
    await seedReservations(blockedId, "blk", 30, upcoming(1));
    await prisma.erasureTombstone.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        organizationId: orgId,
        keyType: "source_reference",
        keyHash: tombstoneKeyHash(orgId, "source_reference", `blk-${i}`)!,
        keyFingerprint: currentKeyFingerprint(),
        erasedAt: new Date(),
      })),
    });
    await seedAutoMessage(goodId, "welcome", WELCOME);
    await seedReservations(goodId, "ok", 1, upcoming(5));

    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(1); // ⬅️ ESKİDE 0
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await prisma.reservation.count({ where: { propertyId: blockedId, welcomeSentAt: { not: null } } })).toBe(0);
    expect(await prisma.reservation.count({ where: { propertyId: goodId, welcomeSentAt: { not: null } } })).toBe(1);
  });

  it("🚨 kuyruk KAPALI: kuyruğun sahiplendiği (incelemede bekleyen) 30 rezervasyon, arkadaki gönderilebilir rezervasyonu engellemez; onlara ikinci kez GÖNDERİLMEZ", async () => {
    const { orgId, blockedId, goodId } = await seedOrg();
    await seedAutoMessage(blockedId, "welcome", WELCOME);
    await seedReservations(blockedId, "blk", 30, upcoming(1));
    await outboxRows(orgId, "blk", 30, "review");
    await seedAutoMessage(goodId, "welcome", WELCOME);
    await seedReservations(goodId, "ok", 1, upcoming(5));

    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(1); // ⬅️ ESKİDE 0
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await prisma.reservation.count({ where: { propertyId: blockedId, welcomeSentAt: { not: null } } })).toBe(0);
  });

  it("KONTROL (kuyruk KAPALI): kuyrukta KESİN başarısız (`failed`) satırı olan rezervasyon elenmez — doğrudan yol yeniden dener (eski kural aynen)", async () => {
    const { orgId, goodId } = await seedOrg();
    await seedAutoMessage(goodId, "welcome", WELCOME);
    await seedReservations(goodId, "ok", 2, upcoming(2));
    await outboxRows(orgId, "ok", 1, "failed"); // ok-0: kuyrukta kesin başarısız
    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(2);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("KONTROL (kuyruk KAPALI): BAŞKA türün kuyruk satırı (giriş mesajı) karşılamayı elemez", async () => {
    const { orgId, goodId } = await seedOrg();
    await seedAutoMessage(goodId, "welcome", WELCOME);
    await seedReservations(goodId, "ok", 1, upcoming(2));
    await outboxRows(orgId, "ok", 1, "review", "checkin");
    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
  });

  it("🚨 kuyruk AÇIK: kuyrukta zaten satırı olan (kesin başarısız dahil) 30 rezervasyon, arkadaki rezervasyonun kuyruğa girmesini engellemez", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    const { orgId, blockedId, goodId } = await seedOrg();
    await seedAutoMessage(blockedId, "welcome", WELCOME);
    await seedReservations(blockedId, "blk", 30, upcoming(1));
    await outboxRows(orgId, "blk", 30, "failed"); // yeniden kuyruğa verme "zaten var" der — hiçbiri bir daha gönderilmez
    await seedAutoMessage(goodId, "welcome", WELCOME);
    await seedReservations(goodId, "ok", 1, upcoming(5));

    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(1); // ⬅️ ESKİDE 0 (25 "zaten var" adayı listeyi dolduruyordu)
    expect(mockSend).not.toHaveBeenCalled(); // gönderim işçinin işi
    const queued = await prisma.messageOutbox.findMany({ where: { organizationId: orgId, externalReservationId: "ok-0" }, select: { status: true, messageType: true } });
    expect(queued).toEqual([{ status: "pending", messageType: "welcome" }]);
    expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(31); // eski satırlar çoğalmadı
  });

  it("KONTROL (kuyruk AÇIK): BEKLEYEN (`pending`) kuyruk satırı elenmez — ertelenmiş giriş mesajının vadesi tarih pencereye girince şimdiye çekilir", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    const { orgId, goodId } = await seedOrg();
    await seedAutoMessage(goodId, "checkin", "Merhaba {isim}, giriş 15:00'ten itibaren; anahtar kutusu kapının sağında.");
    const arrival = new Date(Date.now() + 60 * 60_000);
    await prisma.reservation.create({
      data: { propertyId: goodId, guestName: "Misafir", arrivalDate: arrival, departureDate: new Date(arrival.getTime() + 2 * DAY), channel: "airbnb", status: "confirmed", sourceReference: "ok-0" },
    });
    // İşçinin ertelediği satır: bekliyor, vadesi 80 gün sonra (varış ileri alınmıştı; şimdi yeniden pencerede).
    await prisma.messageOutbox.create({
      data: {
        organizationId: orgId, channel: "airbnb", externalReservationId: "ok-0", messageType: "checkin", body: "eski metin",
        idempotencyKey: `checkin:${orgId}:ok-0`, status: "pending", availableAt: new Date(Date.now() + 80 * DAY),
      },
    });
    expect((await sendDueCheckins(orgId)).sent).toBe(0); // yeni satır yok (tek anahtar)
    const row = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(row.availableAt.getTime()).toBeLessThanOrEqual(Date.now()); // ⬅️ ön eleme bu satırı eleseydi vade 80 gün sonra kalırdı
  });

  it("giriş bilgisi ve çıkış göndericileri de aynı ön elemeyi KENDİ türleriyle kullanır (kuyruğun sahiplendiği 30 rezervasyon arkadakini engellemez)", async () => {
    const { orgId, blockedId, goodId } = await seedOrg(morningZone());
    // Giriş: hepsi bugün içinde, kuyruğun sahiplendikleri daha erken.
    const soon = (baseMin: number) => (i: number) => {
      const arrival = new Date(Date.now() + (baseMin + i) * 60_000);
      return { arrival, departure: new Date(arrival.getTime() + 2 * DAY) };
    };
    await seedAutoMessage(blockedId, "checkin", "Merhaba {isim}, giriş 15:00'ten itibaren.");
    await seedAutoMessage(goodId, "checkin", "Merhaba {isim}, giriş 15:00'ten itibaren; anahtar kutusu kapının sağında.");
    await seedReservations(blockedId, "cin", 30, soon(30));
    await outboxRows(orgId, "cin", 30, "review", "checkin");
    await seedReservations(goodId, "cinok", 1, soon(120));
    const checkins = await sendDueCheckins(orgId);
    expect(checkins.sent).toBe(1); // ⬅️ ESKİDE 0
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(String(mockSend.mock.calls[0][1])).toContain("anahtar kutusu");

    // Çıkış: bugün çıkanlar, kuyruğun sahiplendikleri daha erken.
    mockSend.mockClear();
    const leavingToday = (baseSec: number) => (i: number) => ({ arrival: new Date(Date.now() - 2 * DAY), departure: new Date(Date.now() + (baseSec + i) * 1_000) });
    await seedAutoMessage(blockedId, "checkout", "Merhaba {isim}, çıkış saati 11:00.");
    await seedAutoMessage(goodId, "checkout", "Merhaba {isim}, çıkış saati 11:00; anahtarı kutuya bırakabilirsiniz.");
    await seedReservations(blockedId, "cout", 30, leavingToday(0));
    await outboxRows(orgId, "cout", 30, "review", "checkout");
    await seedReservations(goodId, "coutok", 1, leavingToday(600));
    const checkouts = await sendDueCheckouts(orgId);
    expect(checkouts.sent).toBe(1); // ⬅️ ESKİDE 0
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(String(mockSend.mock.calls[0][1])).toContain("anahtarı kutuya");
  });
});
