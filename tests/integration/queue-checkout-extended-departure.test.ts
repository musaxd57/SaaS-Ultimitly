import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { seedAutoMessage } from "../helpers/auto-message";
import { stayDay } from "../helpers/stay-dates";

// ---------------------------------------------------------------------------
// KUYRUK YOLU (G1 tur 3 bulgusu) — otomatik mesaj zinciri: kuyruktaki ÇIKIŞ mesajı, çıkış tarihi İLERİ alındıktan sonra (konu 6).
//
// Çıkış mesajı "çıkış günü sabahı" hatırlatmasıdır: doğrudan yol aday seçiminde de son talepte de "çıkış BUGÜN" ister (`sendDueCheckouts`,
// Y4 talep şartı), `sendDueCheckouts` yorumu "asıl gönderim anı vetosu işçide yaşar ve AYNI kuralı kullanır (iki yol ayrışamaz)" der.
// İşçinin çıkış vetosu ise yalnız "çıkış günü GEÇTİ mi" diye bakar (`lifecycleVeto` `today > departureDay`); çıkış ileri alınınca satır
// pencerede sayılır. Giriş mesajında aynı durum için erteleme var (`checkinNotYetDue`, Y4: "ileri tarihe taşınan rezervasyonun giriş mesajı
// erken GİTMEZ"); çıkışta yok.
// Gecikme ürünün kendi tutmasıyla gerçekçi: satır kuyruktayken aynı rezervasyon ikinci bir dairede kayıtlı görünür → işçi tutar (11-18
// akşam, 20 dk'da bir yeniden bakar). O arada misafir konaklamayı iki gün uzatır (kanal çıkışı ileri alır), ev sahibi yanlış kaydı kaldırır →
// bir sonraki geçişte "bugün çıkış günü" mesajı çıkışa iki gün varken gider.
// DÜZELTİLDİ (11-20, `outbox/worker.ts` `checkoutNotYetDue`): çıkış ileri alındıysa satır iptal edilmez, yeni çıkış gününün gönderim
// penceresine (işletme saatiyle 08:00) ertelenir — giriş mesajının ertelemesiyle (Y4) aynı kural.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("@/lib/report-error", async (orig) => ({ ...(await orig<typeof import("@/lib/report-error")>()), reportError: vi.fn().mockResolvedValue(undefined) }));

import { enqueueProactive } from "@/lib/outbox/enqueue";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";

const REF = "res-checkout-ext-1";

async function seed() {
  // Saat dilimi UTC: `stayDay(0)` (UTC günü) her saatte işletmenin "bugün"üdür.
  const org = await prisma.organization.create({
    data: { name: "Org", timezone: "UTC", autoCheckout: true, autoCheckoutEnabledAt: new Date(0), aiSignature: "Lale", autoReplyHospitable: true },
  });
  const p1 = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 1" } });
  const p2 = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 2" } });
  await seedAutoMessage(p1.id, "checkout", "Bugün çıkış gününüz, anahtarı kutuya bırakmanızı rica ederiz.");
  await seedAutoMessage(p2.id, "checkout", "Bugün çıkış gününüz, anahtarı kutuya bırakmanızı rica ederiz.");
  const r = await prisma.reservation.create({
    data: { propertyId: p1.id, guestName: "Bircan", arrivalDate: stayDay(-2), departureDate: stayDay(0), channel: "airbnb", status: "confirmed", sourceReference: REF },
  });
  // Çıkış günü sabahı gönderici satırı kuyruğa koydu (rezervasyon o an tek dairede).
  const enq = await enqueueProactive({
    organizationId: org.id,
    reservationId: r.id,
    externalReservationId: REF,
    channel: "airbnb",
    messageType: "checkout",
    body: "Bugün çıkış gününüz, anahtarı kutuya bırakmanızı rica ederiz.",
    idempotencyKey: `checkout:${org.id}:${REF}`,
  });
  return { orgId: org.id, p2Id: p2.id, reservationId: r.id, outboxId: enq.outboxId };
}

describe("kuyruk yolu — kuyruktaki çıkış mesajı, çıkış ileri alındıktan sonra", () => {
  const sends: string[] = [];
  const send: OutboxSendFn = async (row) => {
    sends.push(row.id);
    return { ok: true, providerMessageId: `p${sends.length}` };
  };
  const drain = () => drainOutboxOnce({ send, tokenFor: async () => "t" });

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    sends.length = 0;
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
  });
  afterEach(() => vi.unstubAllEnvs());

  /** İkinci dairede kopya → işçi tutar → kopya kaldırılır → 20 dk geçer (yeniden bakma vadesi). `extend` arada çıkışı ileri alır. */
  async function holdThenRelease(s: Awaited<ReturnType<typeof seed>>, extend: boolean) {
    const copy = await prisma.reservation.create({
      data: { propertyId: s.p2Id, guestName: "Bircan", arrivalDate: stayDay(-2), departureDate: stayDay(0), channel: "manual", status: "confirmed", sourceReference: REF },
    });
    await drain();
    expect(sends).toHaveLength(0); // tutuldu (iki dairede etkin kayıt)
    const held = await prisma.messageOutbox.findUniqueOrThrow({ where: { id: s.outboxId } });
    expect(held.status).toBe("pending");
    if (extend) await prisma.reservation.update({ where: { id: s.reservationId }, data: { departureDate: stayDay(2) } }); // kanal: +2 gece
    await prisma.reservation.delete({ where: { id: copy.id } }); // ev sahibi yanlış kaydı kaldırdı
    await prisma.messageOutbox.update({ where: { id: s.outboxId }, data: { availableAt: new Date(Date.now() - 1000) } }); // 20 dk geçti
    await drain();
  }

  it("KONTROL (yeşil): çıkış değişmedi — tutma kalkınca çıkış günü mesajı gider", async () => {
    const s = await seed();
    await holdThenRelease(s, false);
    expect(sends).toHaveLength(1);
  });

  it("🚨 çıkış iki gün ileri alındı — 'bugün çıkış gününüz' mesajı çıkışa iki gün varken GİTMEZ, yeni çıkış gününe ertelenir", async () => {
    const s = await seed();
    await holdThenRelease(s, true);
    const row = await prisma.messageOutbox.findUniqueOrThrow({ where: { id: s.outboxId } });
    // Doğrudan yolun kuralı ("iki yol ayrışamaz"): çıkış bugün değil → gönderim yok. Satır İPTAL edilmez (rezervasyon başına tek anahtar),
    // yeni çıkış gününün gönderim penceresine (işletme saati UTC, 08:00) ertelenir.
    expect({ sends: sends.length, status: row.status }).toEqual({ sends: 0, status: "pending" });
    const newDeparture = stayDay(2);
    expect(row.availableAt.toISOString()).toBe(new Date(newDeparture.getTime() + 8 * 3_600_000).toISOString());
  });
});

describe("çıkış ertelemesi iptal edilmiş rezervasyonu ERTELEMEZ (aşırı uygulama yok)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 rezervasyon iptal + çıkış ileri alındı → satır ertelenmez, iptal edilir (reservation_cancelled)", async () => {
    const s = await seed();
    await prisma.reservation.update({ where: { id: s.reservationId }, data: { status: "cancelled", departureDate: stayDay(2) } });
    const sent: string[] = [];
    await drainOutboxOnce({
      send: async (row) => {
        sent.push(row.id);
        return { ok: true, providerMessageId: "x" };
      },
      tokenFor: async () => "t",
    });
    expect(sent).toEqual([]);
    expect(await prisma.messageOutbox.findUniqueOrThrow({ where: { id: s.outboxId } })).toMatchObject({ status: "canceled", lastErrorCode: "reservation_cancelled" });
  });
});
