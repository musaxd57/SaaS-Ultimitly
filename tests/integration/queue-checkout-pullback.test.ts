import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { seedAutoMessage } from "../helpers/auto-message";

// ---------------------------------------------------------------------------
// KUYRUK — ERTELENEN ÇIKIŞ SATIRI, ÇIKIŞ GERİ ALININCA ÖNE ÇEKİLİR (G1 tur 5 T5-B1, 11-20; düzeltildi: `sendDueCheckouts` giriş göndericisinin
// Y4 kuralıyla vadeyi şimdiye çeker). Yeni kod: çıkış ertelemesi (`checkoutNotYetDue`, `4f5bbacd`, T3-B3 düzeltmesi) × çıkış GERİ alınır.
//
// Kuyruktaki çıkış satırı, çıkış ileri alınınca yeni çıkış gününün 08:00'ine ertelenir. Çıkış sonra GERİ alınırsa (uzatmanın bir gecesi
// iptal) satırın vadesi öne çekilmez: gönderici yeni çıkış günü sabahı adayı görür, `enqueueProactive` "zaten var" der (bekleyen satır
// diriltilmez, vadesi de değişmez); satır eski vadesinde (bir gün sonra 08:00) talep edilince çıkış günü GEÇMİŞ olur → `window_passed`
// ile iptal. Misafir çıkış hatırlatmasını hiç almaz. Giriş mesajında aynı durum için vade öne çekme VAR (`sendDueCheckins`: "ertelenmiş
// satır tarih yeniden pencereye girdiyse beklemez — vadesi şimdiye çekilir", Y4); çıkışta yok. Doğrudan yol aynı son durumda gönderir.
// Satırın çıkışın ileri alınmasından ÖNCE kuyruğa girmesi ürünün kendi tutmasıyla (iki dairede kayıt, 11-18 akşam) — T3-B3 senaryosu.
// Saat sahte `Date` (yalnız `Date`), işletme dilimi UTC.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable-credentials", async (orig) => ({
  ...(await orig<typeof import("@/lib/hospitable-credentials")>()),
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/report-error", async (orig) => ({ ...(await orig<typeof import("@/lib/report-error")>()), reportError: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/messaging", async (orig) => ({ ...(await orig<typeof import("@/lib/messaging")>()), sendOnChannel: vi.fn() }));

import { sendOnChannel } from "@/lib/messaging";
import { sendDueCheckouts } from "@/lib/automation";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";

const REF = "res-co-back-1";
const now0 = new Date();
const day = (n: number, hour = 0) => new Date(Date.UTC(now0.getUTCFullYear(), now0.getUTCMonth(), now0.getUTCDate() + n, hour));

async function seed() {
  const org = await prisma.organization.create({
    data: { name: "Org", timezone: "UTC", autoCheckout: true, autoCheckoutEnabledAt: new Date(0), aiSignature: "Lale", autoReplyHospitable: true },
  });
  const p1 = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 1" } });
  const p2 = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 2" } });
  for (const p of [p1.id, p2.id]) await seedAutoMessage(p, "checkout", "Bugün çıkış gününüz, anahtarı kutuya bırakmanızı rica ederiz.");
  const r = await prisma.reservation.create({
    data: { propertyId: p1.id, guestName: "Bircan", arrivalDate: day(-2), departureDate: day(0), channel: "airbnb", status: "confirmed", sourceReference: REF },
  });
  return { orgId: org.id, p2: p2.id, reservationId: r.id };
}

describe("kuyruk — çıkış ertelemesi, çıkış geri alınınca (T5-B1)", () => {
  const sends: string[] = [];
  const send: OutboxSendFn = async (row) => {
    sends.push(String(row.messageType));
    return { ok: true, providerMessageId: `p${sends.length}` };
  };
  const drain = () => drainOutboxOnce({ send, tokenFor: async () => "t" });
  const clock = (d: Date) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(d);
  };

  beforeEach(async () => {
    vi.useRealTimers();
    await resetDb();
    vi.clearAllMocks();
    sends.length = 0;
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.mocked(sendOnChannel).mockResolvedValue({ ok: true, providerMessageId: "d1" } as never);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("KONTROL (yeşil): doğrudan yol — çıkış (son hâli) yarın; yarın 09:00'da çıkış mesajı gider", async () => {
    const s = await seed();
    await prisma.reservation.update({ where: { id: s.reservationId }, data: { departureDate: day(1) } });
    clock(day(1, 9));
    expect((await sendDueCheckouts(s.orgId)).sent).toBe(1);
  });

  it("🚨 kuyruk — çıkış +2 gün (satır ertelendi), sonra +1 güne geri alındı → yeni çıkış günü mesaj GİDER (vade öne çekilir)", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    const s = await seed();
    // Çıkış günü 09:00: gönderici satırı kuyruğa koydu; aynı rezervasyon ikinci dairede de görünüyor → işçi tutar.
    clock(day(0, 9));
    expect((await sendDueCheckouts(s.orgId)).sent).toBe(1);
    const copy = await prisma.reservation.create({
      data: { propertyId: s.p2, guestName: "Bircan", arrivalDate: day(-2), departureDate: day(0), channel: "manual", status: "confirmed", sourceReference: REF },
    });
    await drain();
    expect(sends).toHaveLength(0);
    // Misafir iki gece uzattı (kanal çıkışı +2), ev sahibi yanlış kaydı kaldırdı; 20 dk sonra işçi satırı yeni çıkış gününe erteler.
    await prisma.reservation.update({ where: { id: s.reservationId }, data: { departureDate: day(2) } });
    await prisma.reservation.delete({ where: { id: copy.id } });
    clock(new Date(day(0, 9).getTime() + 30 * 60_000));
    await drain();
    const deferred = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: s.orgId } });
    expect({ status: deferred.status, availableAt: deferred.availableAt.toISOString() }).toEqual({ status: "pending", availableAt: day(2, 8).toISOString() });
    // Uzatmanın bir gecesi iptal: çıkış yarın.
    await prisma.reservation.update({ where: { id: s.reservationId }, data: { departureDate: day(1) } });
    // Yarın 09:00: gönderici adayı görür (çıkış bugün), işçi geçer.
    clock(day(1, 9));
    await sendDueCheckouts(s.orgId);
    await drain();
    // Ertesi gün 09:00: satır eski vadesinde talep edilir.
    clock(day(2, 9));
    await drain();
    const row = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: s.orgId } });
    console.log(`[co-back] satır=${row.status}/${row.lastErrorCode} gönderim=${sends.length}`);
    // Doğrudan yol + giriş mesajının öne çekme kuralı: yeni çıkış günü (yarın) çıkış mesajı GİDER (düzeltmeden önce hiç gitmiyordu).
    expect(sends).toEqual(["checkout"]);
  });

  // Aşırı uygulama: öne çekme YALNIZ zamanı gelmediği için bekleyen satıra (hata bilgisi boş). Sağlayıcının "çok fazla istek" beklemesindeki
  // satırın vadesi her geçişte (2 dk) silinmemeli — giriş göndericisinin kuralıyla aynı (S8, 11-11).
  it.each([
    { kind: null, pulled: true },
    { kind: "rate_limited", pulled: false },
  ])("öne çekme yalnız hata bilgisi boş bekleyen satırda (lastErrorKind=$kind → öne çekildi=$pulled)", async ({ kind, pulled }) => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    const s = await seed();
    clock(day(0, 9));
    expect((await sendDueCheckouts(s.orgId)).sent).toBe(1);
    const later = new Date(day(0, 9).getTime() + 45 * 60_000);
    await prisma.messageOutbox.updateMany({ where: { organizationId: s.orgId }, data: { availableAt: later, lastErrorKind: kind } });
    await sendDueCheckouts(s.orgId);
    const row = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: s.orgId } });
    expect(row.availableAt.getTime() <= day(0, 9).getTime()).toBe(pulled);
    if (!pulled) expect(row.availableAt.toISOString()).toBe(later.toISOString());
  });
});
