import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { seedAutoMessage } from "../helpers/auto-message";

// KUYRUK — ÇIKIŞ GÜNÜ 12:00'DEN SONRA ÇIKIŞ HATIRLATMASI GİTMEZ (kurucu 11-20 öğlen A3: "Ben gitmesin diyorum. 12:00 mevcut sabah
// hatırlatmasının son saati"). Repro sert kontrolün (inceleyici); düzeltme `worker.ts lifecycleVeto`. Eski not: `lifecycle-window.ts` yorumu "kuyruk işçisi aynı sınırı okur — çıkış günü öğleden sonra artık
// gönderilecek bir çıkış mesajı yoktur" diyor. İşçi yalnız BAŞLANGIÇ saatini okur: iki dairede kayıt yüzünden tutulan çıkış satırı, ev sahibi
// kopyayı çıkış günü 15:00'te kaldırınca 15:00'te gider ("Bugün çıkış gününüz…"). Doğrudan yol 12:00'den sonra hiç göndermez.

vi.mock("@/lib/hospitable-credentials", async (orig) => ({
  ...(await orig<typeof import("@/lib/hospitable-credentials")>()),
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/report-error", async (orig) => ({ ...(await orig<typeof import("@/lib/report-error")>()), reportError: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/messaging", async (orig) => ({ ...(await orig<typeof import("@/lib/messaging")>()), sendOnChannel: vi.fn() }));

import { sendOnChannel } from "@/lib/messaging";
import { sendDueCheckouts } from "@/lib/automation";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";

const REF = "res-co-pm-1";
const now0 = new Date();
const day = (n: number, hour = 0) => new Date(Date.UTC(now0.getUTCFullYear(), now0.getUTCMonth(), now0.getUTCDate() + n, hour));

describe("A3 — tutulan çıkış satırı çıkış günü öğleden sonra", () => {
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
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    vi.mocked(sendOnChannel).mockResolvedValue({ ok: true, providerMessageId: "d1" } as never);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("kopya 15:00'te kaldırılınca çıkış mesajı 15:00'te GİTMEMELİ (doğrudan yol 12:00'den sonra göndermez)", async () => {
    const org = await prisma.organization.create({
      data: { name: "Org", timezone: "UTC", autoCheckout: true, autoCheckoutEnabledAt: new Date(0), aiSignature: "Lale", autoReplyHospitable: true },
    });
    const p1 = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 1" } });
    const p2 = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 2" } });
    await seedAutoMessage(p1.id, "checkout", "Bugün çıkış gününüz, anahtarı kutuya bırakmanızı rica ederiz.");
    await prisma.reservation.create({
      data: { propertyId: p1.id, guestName: "Bircan", arrivalDate: day(-2), departureDate: day(0), channel: "airbnb", status: "confirmed", sourceReference: REF },
    });
    clock(day(0, 9));
    expect((await sendDueCheckouts(org.id)).sent).toBe(1);
    const copy = await prisma.reservation.create({
      data: { propertyId: p2.id, guestName: "Bircan", arrivalDate: day(-2), departureDate: day(0), channel: "manual", status: "confirmed", sourceReference: REF },
    });
    await drain();
    expect(sends).toHaveLength(0); // tutuldu
    clock(day(0, 15));
    await prisma.reservation.delete({ where: { id: copy.id } });
    await drain();
    expect(sends, "çıkış günü 15:00'te çıkış mesajı gitti").toEqual([]);
    const row = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: org.id } });
    expect({ status: row.status, code: row.lastErrorCode }).toEqual({ status: "canceled", code: "window_passed" });
    // Eski sabah mesajı DİRİLMEZ (kurucu): gönderici bu saatte aday seçmez, satır diriltilebilir kümede değil.
    await sendDueCheckouts(org.id);
    await drain();
    expect(sends).toEqual([]);
  });

  it("aşırı uygulama yok: kopya 11:00'de kaldırılınca çıkış mesajı GİDER (pencere içinde)", async () => {
    const org = await prisma.organization.create({
      data: { name: "Org", timezone: "UTC", autoCheckout: true, autoCheckoutEnabledAt: new Date(0), aiSignature: "Lale", autoReplyHospitable: true },
    });
    const p1 = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 1" } });
    const p2 = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 2" } });
    await seedAutoMessage(p1.id, "checkout", "Bugün çıkış gününüz, anahtarı kutuya bırakmanızı rica ederiz.");
    await prisma.reservation.create({
      data: { propertyId: p1.id, guestName: "Bircan", arrivalDate: day(-2), departureDate: day(0), channel: "airbnb", status: "confirmed", sourceReference: REF },
    });
    clock(day(0, 9));
    expect((await sendDueCheckouts(org.id)).sent).toBe(1);
    const copy = await prisma.reservation.create({
      data: { propertyId: p2.id, guestName: "Bircan", arrivalDate: day(-2), departureDate: day(0), channel: "manual", status: "confirmed", sourceReference: REF },
    });
    await drain();
    expect(sends).toHaveLength(0);
    clock(day(0, 11));
    await prisma.reservation.delete({ where: { id: copy.id } });
    await prisma.messageOutbox.updateMany({ where: { organizationId: org.id }, data: { availableAt: new Date(Date.now() - 1000) } });
    await drain();
    expect(sends).toEqual(["checkout"]);
  });
});
