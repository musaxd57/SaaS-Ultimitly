import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { seedAutoMessage } from "../helpers/auto-message";
import { stayDay } from "../helpers/stay-dates";

// ---------------------------------------------------------------------------
// KUYRUK YOLU — BAYAT KARŞILAMA / GİRİŞ KAPALI DÖNEMDEN SONRA (G1 tur 4 T4-B1, düzeltildi 11-20: `lifecycleVeto` `LIFECYCLE_STALE_AFTER_MS`) — kalıcı kuyruk (açılış kipi: `DURABLE_OUTBOX_ENABLED=1`, `AUTO_REPLY_ENABLED=1`) × KAPALI DÖNEM (konu 1).
//
// Doğrudan yol karşılama ve giriş mesajını yalnız "varış bugün ya da sonra" olan rezervasyona gönderir (`sendDueWelcomes` /
// `sendDueCheckins`: `onOrAfterTodayWhere("arrivalDate")`). Kuyruk yolunda bu kural yalnız ABONELİK kapalı dönemine uygulanmış (N1, kurucu
// 10-17 "kesinlikle bayat mesaj gitmemeli": `lifecycleVeto` `spannedBillingBlock`). İki öteki kapalı dönemde satır bekler ve dönem bitince
// "tarih vetolarıyla normal işlenir" — ama karşılamanın HİÇ tarih vetosu yok, giriş mesajınınki çıkış gününe bağlı:
//  · operatörün "bekleyen gönderimleri duraklat"ı (`OUTBOX_DELIVERY_PAUSED=1`): duraklatma kuyruğa YENİ iş almayı durdurmaz → dönem boyunca
//    her yeni karşılama / giriş satırı birikir; açılınca varışı geçmiş konaklamaya "giriş bilgileriniz" ve konaklaması BİTMİŞ misafire
//    karşılama gider;
//  · genel kapatma (`AUTO_REPLY_ENABLED` "1" değil): kapatmadan önce kuyruğa girmiş satır aynı şekilde.
// Saat sahte `Date` ile ileri alınır (yalnız `Date`; zamanlayıcılar gerçek). Doğrudan yol AYNI saatte AYNI rezervasyona hiçbir şey göndermez
// (KONTROL). Kuyruk yolunun kapalı dönemsiz hâli de gönderir (KONTROL) — kayıp yok, yalnız bayat gönderim.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable-credentials", async (orig) => ({
  ...(await orig<typeof import("@/lib/hospitable-credentials")>()),
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/report-error", async (orig) => ({ ...(await orig<typeof import("@/lib/report-error")>()), reportError: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/messaging", async (orig) => ({ ...(await orig<typeof import("@/lib/messaging")>()), sendOnChannel: vi.fn() }));

import { sendOnChannel } from "@/lib/messaging";
import { sendDueCheckins, sendDueWelcomes } from "@/lib/automation";
import { drainOutboxOnce, reactivateBlockedOutbox, type OutboxSendFn } from "@/lib/outbox/worker";

const DAY = 86_400_000;

async function seed(ref: string) {
  // Saat dilimi UTC: `stayDay` (UTC günü) işletmenin günüyle aynı.
  const org = await prisma.organization.create({
    data: {
      name: "Org",
      timezone: "UTC",
      autoWelcome: true,
      autoWelcomeEnabledAt: new Date(0),
      autoCheckin: true,
      autoCheckinEnabledAt: new Date(0),
      aiSignature: "Lale",
      autoReplyHospitable: true,
    },
  });
  const property = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 3" } });
  await seedAutoMessage(property.id, "welcome", "Merhaba {isim}, rezervasyonunuz için teşekkürler; görüşmek üzere.");
  await seedAutoMessage(property.id, "checkin", "Merhaba {isim}, girişiniz bugün 15:00; kapı kodu 4821.");
  // Varış 2 gün sonra, çıkış 4 gün sonra (gerçek saate göre).
  const r = await prisma.reservation.create({
    data: { propertyId: property.id, guestName: "Bircan", arrivalDate: stayDay(2), departureDate: stayDay(4), channel: "airbnb", status: "confirmed", sourceReference: ref },
  });
  return { orgId: org.id, reservationId: r.id };
}

describe("kuyruk yolu — kapalı dönemden sonra bayat karşılama / giriş mesajı GİTMEZ (kuyruk açık)", () => {
  const sends: string[] = [];
  const send: OutboxSendFn = async (row) => {
    sends.push(`${row.messageType}`);
    return { ok: true, providerMessageId: `p${sends.length}` };
  };
  const drain = () => drainOutboxOnce({ send, tokenFor: async () => "t" });
  const realNow = Date.now();
  const clockPlusDays = (n: number) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(realNow + n * DAY));
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

  it("KONTROL (yeşil): DOĞRUDAN yol — 5 gün sonra (konaklama bitti) karşılama yok; 3 gün sonra (varış dün) giriş mesajı yok", async () => {
    const s = await seed("res-direct-1");
    clockPlusDays(5);
    expect((await sendDueWelcomes(s.orgId)).sent).toBe(0);
    vi.setSystemTime(new Date(realNow + 3 * DAY));
    expect((await sendDueCheckins(s.orgId)).sent).toBe(0);
    expect(vi.mocked(sendOnChannel)).not.toHaveBeenCalled();
  });

  it("KONTROL (yeşil): kuyruk — kapalı dönem yokken karşılama ve giriş mesajı varıştan önce gider", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    const s = await seed("res-queue-ok-1");
    await sendDueWelcomes(s.orgId);
    await sendDueCheckins(s.orgId);
    await drain();
    await drain();
    expect(sends.sort()).toEqual(["checkin", "welcome"]);
  });

  it("🚨 operatör duraklatması 5 gün sürdü — açılınca konaklaması BİTMİŞ misafire karşılama GİTMEZ", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    vi.stubEnv("OUTBOX_DELIVERY_PAUSED", "1");
    const s = await seed("res-paused-1");
    // Duraklatma sürerken gönderici kuyruğa almaya devam eder (duraklatma yeni işi durdurmaz).
    await sendDueWelcomes(s.orgId);
    await sendDueCheckins(s.orgId);
    await drain();
    expect(sends).toHaveLength(0);
    expect(await prisma.messageOutbox.count({ where: { organizationId: s.orgId, status: "pending" } })).toBe(2);
    // 5 gün sonra (varış 3 gün önce, çıkış dün) duraklatma kaldırılır.
    clockPlusDays(5);
    vi.stubEnv("OUTBOX_DELIVERY_PAUSED", "0");
    await drain();
    await drain();
    // Doğrudan yolun kuralı + N1 ilkesi: bayat karşılama GİTMEZ (eskiden karşılamanın tarih vetosu yoktu → gidiyordu).
    expect(sends).toEqual([]);
  });

  it("🚨 operatör duraklatması 3 gün sürdü — açılınca varışı DÜN olan misafire 'girişiniz bugün 15:00' GİTMEZ", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    vi.stubEnv("OUTBOX_DELIVERY_PAUSED", "1");
    const s = await seed("res-paused-2");
    await sendDueCheckins(s.orgId);
    await drain();
    expect(sends).toHaveLength(0);
    clockPlusDays(3); // varış dündü, çıkış yarın
    vi.stubEnv("OUTBOX_DELIVERY_PAUSED", "0");
    await drain();
    expect(sends).toEqual([]);
  });

  it("🚨 kanal aboneliği (402) 5 gün kapalı kaldı — senkron dönünce konaklaması bitmiş misafire karşılama GİTMEZ", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    const s = await seed("res-402-1");
    await sendDueWelcomes(s.orgId);
    // Kanal 402 ("abonelik etkin değil") → satır `blocked` (yeniden talep edilmez).
    await drainOutboxOnce({ send: async () => ({ ok: false, error: "Hospitable API hatası (HTTP 402)" }), tokenFor: async () => "t" });
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: s.orgId } })).status).toBe("blocked");
    clockPlusDays(5);
    // Başarılı senkron (abonelik döndü) → `reactivateBlockedOutbox`: yaşam döngüsü satırı "kendi zaman kuralıyla" bekleyene döner.
    await reactivateBlockedOutbox(s.orgId, new Date());
    await drain();
    expect(sends).toEqual([]);
  });

  it("🚨 genel kapatma (AUTO_REPLY_ENABLED) 5 gün sürdü — açılınca konaklaması bitmiş misafire karşılama GİTMEZ", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    const s = await seed("res-kill-1");
    await sendDueWelcomes(s.orgId); // kuyruğa girdi
    vi.stubEnv("AUTO_REPLY_ENABLED", "0"); // acil kapatma, işçi boşaltmadan önce
    await drain();
    expect(sends).toHaveLength(0);
    clockPlusDays(5);
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    await drain();
    expect(sends).toEqual([]);
  });

  it("KONTROL (olağan gecikme): varış günü 23:00'te kuyruğa giren giriş mesajı gece yarısından 1,5 saat sonra yine GİDER (iki saatlik sınırın altında)", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    const s = await seed("res-late-1");
    const arrival = (await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } })).arrivalDate;
    await sendDueCheckins(s.orgId);
    const created = new Date(arrival.getTime() + 23 * 3_600_000); // varış günü 23:00 (UTC işletme)
    await prisma.messageOutbox.updateMany({ where: { organizationId: s.orgId }, data: { createdAt: created, availableAt: created } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(arrival.getTime() + 24.5 * 3_600_000)); // ertesi gün 00:30 → 1,5 saat bekledi
    await drain();
    expect(sends).toEqual(["checkin"]);
  });

  it("🚨 aynı satır varış gününden sonra iki saatten UZUN beklediyse bayattır (sınırın öbür yanı)", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    const s = await seed("res-late-2");
    const arrival = (await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } })).arrivalDate;
    await sendDueCheckins(s.orgId);
    const created = new Date(arrival.getTime() + 21 * 3_600_000); // varış günü 21:00
    await prisma.messageOutbox.updateMany({ where: { organizationId: s.orgId }, data: { createdAt: created, availableAt: created } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(arrival.getTime() + 24.5 * 3_600_000)); // ertesi gün 00:30 → 3,5 saat bekledi
    await drain();
    expect(sends).toEqual([]);
    expect(await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: s.orgId } })).toMatchObject({ status: "canceled", lastErrorCode: "window_passed" });
  });
});
