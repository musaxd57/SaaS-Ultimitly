import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { seedAutoMessage } from "../helpers/auto-message";

// ---------------------------------------------------------------------------
// S8 (kurucu kararı 11-11) — REDDEDİLEN OTOMATİK MESAJ HER TURDA YENİDEN DENENMEZ. Gerçek PostgreSQL, kanal taklit.
//
// Kalıcı kuyruk KAPALIYKEN çalışan doğrudan yolda sağlayıcının KESİN reddettiği (4xx) karşılama / giriş / çıkış mesajının damgası geri
// alınıyor, rezervasyon bir sonraki turda (2 dakika) yeniden aday oluyor ve aynı içerikle sonsuza dek deneniyordu (günde 720 istek).
// Reddedilen rezervasyonlar 25'lik listenin başını da doldurup arkadaki gönderilebilir rezervasyonu bekletiyordu.
//
// Artık: bekleme süresi var olan otomatik gönderim kaydından türetilir (yeni tablo / sütun yok); vadesi gelmemiş aday 25 sınırından ÖNCE
// elenir; içerik değişince hemen denenir; tür ve işletme başına ayrıdır; "çok fazla istek" cevabında tur durur ve sağlayıcının istediği
// süre beklenir. Kalıcı kuyruk açıkken bu defter okunmaz.
// ---------------------------------------------------------------------------

vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: undefined })),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue({ notified: true, throttled: false, configured: true }) }));

import { sendDueWelcomes, sendDueCheckins, sendDueCheckouts, currentHourInTimeZone, __resetLifecycleRateHold } from "@/lib/automation";
import { sendOnChannel } from "@/lib/messaging";
import { lifecycleRetryDelayMs } from "@/lib/automated-sends";

const mockSend = vi.mocked(sendOnChannel);
const DAY = 86_400_000;
const MIN = 60_000;
const REJECTED = { ok: false, error: "Hospitable API hatası (HTTP 422): rejected", kind: "definitive_failure" as const };
const WELCOME = "Merhaba {isim}, rezervasyonunuz için teşekkürler.";

/** Şu an yerel saati sabah (çıkış mesajının gittiği aralık) olan sabit kaymalı bir saat dilimi. */
function morningZone(): string {
  for (let off = -12; off <= 14; off++) {
    const tz = off === 0 ? "Etc/GMT" : `Etc/GMT${off > 0 ? "-" : "+"}${Math.abs(off)}`;
    const h = currentHourInTimeZone(tz, new Date());
    if (h >= 9 && h <= 10) return tz;
  }
  throw new Error("sabah dilimi bulunamadı");
}

async function seedOrg(name = "Org", timezone = "Europe/Istanbul") {
  const org = await prisma.organization.create({
    data: {
      name,
      timezone,
      autoWelcome: true,
      autoWelcomeEnabledAt: new Date(0),
      autoCheckin: true,
      autoCheckinEnabledAt: new Date(0),
      autoCheckout: true,
      autoCheckoutEnabledAt: new Date(0),
    },
  });
  const property = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: `${name} 1` } });
  await seedAutoMessage(property.id, "welcome", WELCOME);
  return { orgId: org.id, propertyId: property.id };
}

/** `count` rezervasyon; gelişler `inDays` günden başlar ve dakikalarla artar (sıra belirli). */
async function seedReservations(propertyId: string, prefix: string, count: number, inDays: number) {
  await prisma.reservation.createMany({
    data: Array.from({ length: count }, (_, i) => {
      const arrival = new Date(Date.now() + inDays * DAY + i * MIN);
      return { propertyId, guestName: `Misafir ${prefix}${i}`, arrivalDate: arrival, departureDate: new Date(arrival.getTime() + 2 * DAY), channel: "airbnb", status: "confirmed", sourceReference: `${prefix}-${i}` };
    }),
  });
}

/**
 * Aynı rezervasyon + aynı içerik için EK ret kayıtları: göndericinin kendi yazdığı satır kopyalanır (özet GERÇEK gövdeden gelir — test
 * gövdeyi kendisi kurup özetlemez, yoksa defterin yanlış özete bakması gözden kaçardı).
 */
async function addFailedAttempts(ref: string, agosMs: number[], kind = "welcome") {
  const real = await prisma.automatedMessageSend.findFirstOrThrow({ where: { externalReservationId: ref, kind, state: "failed" }, orderBy: { sentAt: "desc" } });
  for (const ago of agosMs) {
    await prisma.automatedMessageSend.create({
      data: { organizationId: real.organizationId, propertyId: real.propertyId, externalReservationId: ref, kind, bodyHash: real.bodyHash, state: "failed", sentAt: new Date(Date.now() - ago) },
    });
  }
  return real;
}
/** Sağlayıcı reddederken bir tur koşturur (gerçek ret kayıtları oluşur), sonra taklidi "kabul ediyor"a çevirip çağrı sayacını sıfırlar. */
async function rejectOnePass(run: () => Promise<unknown>) {
  mockSend.mockResolvedValue(REJECTED);
  await run();
  mockSend.mockReset();
  mockSend.mockResolvedValue({ ok: true, providerMessageId: undefined });
}
const ledger = (ref: string) => prisma.automatedMessageSend.findMany({ where: { externalReservationId: ref }, orderBy: { sentAt: "asc" }, select: { state: true, kind: true } });
const stampedCount = (propertyId: string) => prisma.reservation.count({ where: { propertyId, welcomeSentAt: { not: null } } });

describe("yaşam döngüsü göndericileri — reddedilen mesajın yeniden denemesi (S8)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true, providerMessageId: undefined });
    __resetLifecycleRateHold();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("🚨 kesin ret: hemen ardından gelen tur aynı mesajı YENİDEN GÖNDERMEZ; bekleme dolunca yeniden dener", async () => {
    const { orgId, propertyId } = await seedOrg();
    await seedReservations(propertyId, "res", 1, 5);
    mockSend.mockResolvedValue(REJECTED);

    expect((await sendDueWelcomes(orgId)).sent).toBe(0);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await stampedCount(propertyId)).toBe(0); // damga geri alındı — mesaj "gönderilmiş" sayılmıyor
    expect(await ledger("res-0")).toEqual([{ state: "failed", kind: "welcome" }]);

    await sendDueWelcomes(orgId);
    await sendDueWelcomes(orgId);
    expect(mockSend).toHaveBeenCalledTimes(1); // ⬅️ ESKİDE 3 (her turda yeniden)

    // İlk bekleme (90 sn ± %20) doldu → bir sonraki turda yeniden denenir.
    await prisma.automatedMessageSend.updateMany({ data: { sentAt: new Date(Date.now() - 2 * MIN) } });
    await sendDueWelcomes(orgId);
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(await ledger("res-0")).toHaveLength(2);
  });

  it("🚨 her retten sonra bekleme uzar: dördüncü retten sonra 5 dakika yetmez, 15 dakika yeter", async () => {
    const { orgId, propertyId } = await seedOrg();
    await seedReservations(propertyId, "res", 1, 5);
    await rejectOnePass(() => sendDueWelcomes(orgId));
    // Dört ret: 5 saat, 3 saat, 1 saat ve 5 dakika önce (sonuncusu göndericinin kendi kaydı).
    const real = await addFailedAttempts("res-0", [5 * 60 * MIN, 3 * 60 * MIN, 60 * MIN]);
    await prisma.automatedMessageSend.update({ where: { id: real.id }, data: { sentAt: new Date(Date.now() - 5 * MIN) } });
    expect(lifecycleRetryDelayMs(4, "welcome:res-0")).toBeGreaterThan(9 * MIN); // 12 dk ± %20

    await sendDueWelcomes(orgId);
    expect(mockSend).not.toHaveBeenCalled(); // ⬅️ ESKİDE her turda yeniden

    // Son deneme 15 dakika önceye çekilir → vadesi geldi; bu kez sağlayıcı kabul ediyor.
    await prisma.automatedMessageSend.update({ where: { id: real.id }, data: { sentAt: new Date(Date.now() - 15 * MIN) } });
    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
    expect(await stampedCount(propertyId)).toBe(1);
  });

  it("🚨 bekleyen 30 reddedilmiş rezervasyon, arkalarındaki gönderilebilir rezervasyonu ENGELLEMEZ (25 sınırı vadesi gelenlere uygulanır)", async () => {
    const { orgId, propertyId } = await seedOrg();
    await seedReservations(propertyId, "bad", 30, 1);
    // İki ret turu: ilk tur en erken 25'i dener; ikinci turda onlar bekliyor → sıra kalan 5'e gelir (25 sınırı vadesi gelenlere).
    mockSend.mockResolvedValue(REJECTED);
    await sendDueWelcomes(orgId);
    expect(mockSend).toHaveBeenCalledTimes(25);
    await sendDueWelcomes(orgId);
    expect(mockSend).toHaveBeenCalledTimes(30); // ⬅️ ESKİDE 50: aynı ilk 25 yeniden denenir, son 5'e sıra HİÇ gelmezdi
    expect(await prisma.automatedMessageSend.count({ where: { state: "failed" } })).toBe(30);

    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true, providerMessageId: undefined });
    await seedReservations(propertyId, "ok", 1, 5);
    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(1); // ⬅️ ESKİDE: listeyi reddedilenler doldurur, bu rezervasyona sıra gelmezdi
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await prisma.reservation.count({ where: { sourceReference: "ok-0", welcomeSentAt: { not: null } } })).toBe(1);
  });

  it("🚨 ev sahibi metni DÜZELTİNCE beklenmez: yeni içerik hemen denenir", async () => {
    const { orgId, propertyId } = await seedOrg();
    await seedReservations(propertyId, "res", 1, 5);
    await rejectOnePass(() => sendDueWelcomes(orgId));
    await addFailedAttempts("res-0", [1_000, 2_000, 3_000, 4_000, 5_000]); // altı ret → saatlerce bekleme
    await sendDueWelcomes(orgId);
    expect(mockSend).not.toHaveBeenCalled();

    await seedAutoMessage(propertyId, "welcome", "Merhaba {isim}, hoş geldiniz.");
    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
    expect(String(mockSend.mock.calls[0][1])).toContain("hoş geldiniz");
  });

  it("🚨 niyet başına: karşılama mesajının reddi aynı rezervasyonun GİRİŞ mesajını bekletmez", async () => {
    const { orgId, propertyId } = await seedOrg();
    await seedAutoMessage(propertyId, "checkin", "Merhaba {isim}, giriş bilgileriniz hazır.");
    await seedReservations(propertyId, "res", 1, 2); // 2 gün sonra giriş → giriş mesajı penceresinde
    await rejectOnePass(() => sendDueWelcomes(orgId));
    await addFailedAttempts("res-0", [1_000, 2_000, 3_000, 4_000]);

    expect((await sendDueCheckins(orgId)).sent).toBe(1);
    expect(String(mockSend.mock.calls[0][1])).toContain("giriş bilgileriniz");
    // Karşılama ise hâlâ bekliyor.
    await sendDueWelcomes(orgId);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("🚨 tür defterin anahtarındadır: karşılama ile giriş metni BİREBİR aynı olsa da (aynı içerik özeti) birinin reddi ötekini bekletmez", async () => {
    // Yukarıdaki testte iki metin farklı → içerik özeti zaten ayrışıyor. Burada özet aynı: ayrımı yalnız TÜR yapar (mutasyon 11-11).
    const { orgId, propertyId } = await seedOrg();
    await seedAutoMessage(propertyId, "checkin", WELCOME); // karşılama metninin aynısı
    await seedReservations(propertyId, "res", 1, 2);
    await rejectOnePass(() => sendDueWelcomes(orgId));
    await addFailedAttempts("res-0", [1_000, 2_000, 3_000, 4_000]);
    const welcomeRow = await prisma.automatedMessageSend.findFirstOrThrow({ where: { kind: "welcome" } });

    expect((await sendDueCheckins(orgId)).sent).toBe(1); // ⬅️ tür süzgeci olmasaydı karşılamanın beş reddi giriş mesajını saatlerce bekletirdi
    const checkinRow = await prisma.automatedMessageSend.findFirstOrThrow({ where: { kind: "checkin" } });
    expect(checkinRow.bodyHash).toBe(welcomeRow.bodyHash); // senaryo gerçekten "aynı özet" (anti-vakum)
  });

  it("🚨 işletme başına: başka işletmenin aynı kimlikli rezervasyonundaki ret bu işletmeyi bekletmez", async () => {
    const a = await seedOrg("A");
    const b = await seedOrg("B");
    await seedReservations(a.propertyId, "res", 1, 5);
    await seedReservations(b.propertyId, "res", 1, 5);
    await rejectOnePass(() => sendDueWelcomes(b.orgId));

    expect((await sendDueWelcomes(a.orgId)).sent).toBe(1);
    await sendDueWelcomes(b.orgId);
    expect(mockSend).toHaveBeenCalledTimes(1); // B'ninki bekliyor
  });

  it("KONTROL: belirsiz sonuç (zaman aşımı / 5xx) eskisi gibi — damga durur, mesaj yeniden gönderilmez, defter saymaz", async () => {
    const { orgId, propertyId } = await seedOrg();
    await seedReservations(propertyId, "res", 1, 5);
    mockSend.mockResolvedValue({ ok: false, error: "Hospitable API hatası (HTTP 503): unavailable" });
    await sendDueWelcomes(orgId);
    expect(await stampedCount(propertyId)).toBe(1);
    expect(await ledger("res-0")).toEqual([{ state: "unverified", kind: "welcome" }]);
    await sendDueWelcomes(orgId);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("KONTROL: başarılı gönderim eskisi gibi — tek mesaj, damga, 'sent' izi", async () => {
    const { orgId, propertyId } = await seedOrg();
    await seedReservations(propertyId, "res", 3, 5);
    expect((await sendDueWelcomes(orgId)).sent).toBe(3);
    expect(await stampedCount(propertyId)).toBe(3);
    expect(await ledger("res-1")).toEqual([{ state: "sent", kind: "welcome" }]);
  });

  describe("çok fazla istek (429)", () => {
    const LIMITED = (retryAfterSec: number | null) => ({ ok: false, error: "Hospitable API hatası (HTTP 429): slow down", kind: "rate_limited" as const, retryAfterSec });

    it("🚨 ilk 429'da tur DURUR (sıradaki adaylar denenmez); damga geri alınır; deneme deftere YAZILMAZ", async () => {
      const { orgId, propertyId } = await seedOrg();
      await seedReservations(propertyId, "res", 3, 5);
      mockSend.mockResolvedValue(LIMITED(300));

      expect((await sendDueWelcomes(orgId)).sent).toBe(0);
      expect(mockSend).toHaveBeenCalledTimes(1); // ⬅️ ESKİDE 3 (her aday aynı cevabı alıyordu)
      expect(await stampedCount(propertyId)).toBe(0);
      expect(await prisma.automatedMessageSend.count()).toBe(0); // hız sınırı mesajın hatası değil → sayaç artmaz
    });

    it("🚨 sağlayıcının istediği süre boyunca üç gönderici de sağlayıcıya GİTMEZ; süre dolunca devam eder", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const t0 = new Date("2026-11-11T09:00:00.000Z");
      vi.setSystemTime(t0);
      const { orgId, propertyId } = await seedOrg();
      await seedAutoMessage(propertyId, "checkin", "Merhaba {isim}, giriş bilgileriniz hazır.");
      await seedReservations(propertyId, "res", 2, 2);
      mockSend.mockResolvedValueOnce(LIMITED(300));
      await sendDueWelcomes(orgId);
      expect(mockSend).toHaveBeenCalledTimes(1);

      mockSend.mockResolvedValue({ ok: true, providerMessageId: undefined });
      vi.setSystemTime(new Date(t0.getTime() + 4 * MIN)); // 300 sn dolmadı
      expect(await sendDueWelcomes(orgId)).toEqual({ sent: 0, considered: 0 });
      expect(await sendDueCheckins(orgId)).toEqual({ sent: 0, considered: 0 }); // sınır bağlantıya ait, türe değil
      expect(mockSend).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date(t0.getTime() + 5 * MIN + 1_000));
      expect((await sendDueWelcomes(orgId)).sent).toBe(2);
    });

    it("süre bildirilmediyse 1 dakika beklenir; çok uzun süre 1 saatle sınırlanır", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const t0 = new Date("2026-11-11T09:00:00.000Z");
      vi.setSystemTime(t0);
      const { orgId, propertyId } = await seedOrg();
      await seedReservations(propertyId, "res", 1, 5);

      mockSend.mockResolvedValueOnce(LIMITED(null));
      await sendDueWelcomes(orgId);
      vi.setSystemTime(new Date(t0.getTime() + 59_000));
      await sendDueWelcomes(orgId);
      expect(mockSend).toHaveBeenCalledTimes(1);
      vi.setSystemTime(new Date(t0.getTime() + 61_000));
      mockSend.mockResolvedValueOnce(LIMITED(86_400)); // sağlayıcı "bir gün" dedi
      await sendDueWelcomes(orgId);
      expect(mockSend).toHaveBeenCalledTimes(2);
      vi.setSystemTime(new Date(t0.getTime() + 61_000 + 59 * MIN));
      await sendDueWelcomes(orgId);
      expect(mockSend).toHaveBeenCalledTimes(2);
      vi.setSystemTime(new Date(t0.getTime() + 61_000 + 61 * MIN));
      expect((await sendDueWelcomes(orgId)).sent).toBe(1);
    });

    it("işletme başına: bir işletmenin beklemesi ötekini durdurmaz", async () => {
      const a = await seedOrg("A");
      const b = await seedOrg("B");
      await seedReservations(a.propertyId, "ra", 1, 5);
      await seedReservations(b.propertyId, "rb", 1, 5);
      mockSend.mockResolvedValueOnce(LIMITED(600));
      await sendDueWelcomes(a.orgId);
      expect((await sendDueWelcomes(b.orgId)).sent).toBe(1);
    });
  });

  // Üç göndericinin hata dalı aynı kodun üç kopyasıdır → giriş ve çıkış mesajı da DAVRANIŞLA sabitlenir (yalnız karşılama değil).
  describe.each([
    {
      kind: "checkin" as const,
      run: (orgId: string) => sendDueCheckins(orgId),
      timezone: (): string => "Europe/Istanbul",
      text: "Merhaba {isim}, giriş bilgileriniz hazır.",
      stay: (i: number) => ({ arrival: new Date(Date.now() + 2 * DAY + i * MIN), departure: new Date(Date.now() + 5 * DAY) }),
      stamp: "checkinSentAt" as const,
    },
    {
      kind: "checkout" as const,
      run: (orgId: string) => sendDueCheckouts(orgId),
      timezone: morningZone,
      text: "Merhaba {isim}, çıkış saati 11:00.",
      stay: (i: number) => ({ arrival: new Date(Date.now() - 2 * DAY), departure: new Date(Date.now() + (i + 1) * 1_000) }),
      stamp: "checkoutSentAt" as const,
    },
  ])("$kind mesajı", ({ kind, run, timezone, text, stay, stamp }) => {
    async function seedKind(count: number) {
      const { orgId, propertyId } = await seedOrg("Org", timezone());
      await prisma.autoMessageTemplate.deleteMany({ where: { propertyId } }); // yalnız bu türün metni olsun
      await seedAutoMessage(propertyId, kind, text);
      await prisma.reservation.createMany({
        data: Array.from({ length: count }, (_, i) => {
          const { arrival, departure } = stay(i);
          return { propertyId, guestName: `Misafir ${i}`, arrivalDate: arrival, departureDate: departure, channel: "airbnb", status: "confirmed", sourceReference: `res-${i}` };
        }),
      });
      return { orgId, propertyId };
    }
    const stamped = (propertyId: string) => prisma.reservation.count({ where: { propertyId, [stamp]: { not: null } } });

    it("🚨 kesin ret: hemen ardından gelen tur yeniden GÖNDERMEZ; bekleme dolunca yeniden dener ve gider", async () => {
      const { orgId, propertyId } = await seedKind(1);
      mockSend.mockResolvedValue(REJECTED);
      await run(orgId);
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(await ledger("res-0")).toEqual([{ state: "failed", kind }]);
      await run(orgId);
      expect(mockSend).toHaveBeenCalledTimes(1); // ⬅️ ESKİDE 2

      mockSend.mockResolvedValue({ ok: true, providerMessageId: undefined });
      await prisma.automatedMessageSend.updateMany({ data: { sentAt: new Date(Date.now() - 2 * MIN) } });
      expect((await run(orgId)).sent).toBe(1);
      expect(await stamped(propertyId)).toBe(1);
    });

    it("🚨 429: tur durur, damga geri alınır, deneme deftere yazılmaz; bekleme süresince sağlayıcıya gidilmez, sonra gönderilir", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const t0 = new Date();
      vi.setSystemTime(t0);
      const { orgId, propertyId } = await seedKind(3);
      mockSend.mockResolvedValueOnce({ ok: false, error: "Hospitable API hatası (HTTP 429): slow down", kind: "rate_limited" as const, retryAfterSec: 180 });
      await run(orgId);
      expect(mockSend).toHaveBeenCalledTimes(1); // ⬅️ ESKİDE 3
      expect(await stamped(propertyId)).toBe(0);
      expect(await prisma.automatedMessageSend.count()).toBe(0);

      vi.setSystemTime(new Date(t0.getTime() + 2 * MIN));
      expect(await run(orgId)).toEqual({ sent: 0, considered: 0 });
      expect(mockSend).toHaveBeenCalledTimes(1);
      vi.setSystemTime(new Date(t0.getTime() + 3 * MIN + 1_000));
      expect((await run(orgId)).sent).toBe(3);
    });

    it("KONTROL: kalıcı kuyruk açıkken ret kaydı kuyruğa vermeyi engellemez", async () => {
      const { orgId } = await seedKind(1);
      await rejectOnePass(() => run(orgId));
      vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
      vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", orgId);
      expect((await run(orgId)).sent).toBe(1);
      expect(await prisma.messageOutbox.count({ where: { organizationId: orgId, messageType: kind } })).toBe(1);
    });
  });

  it("KONTROL: kalıcı kuyruk AÇIKKEN defter okunmaz — reddedilmiş deneme kaydı kuyruğa vermeyi engellemez (durum kuyruk satırındadır)", async () => {
    const { orgId, propertyId } = await seedOrg();
    await seedReservations(propertyId, "res", 1, 5);
    await rejectOnePass(() => sendDueWelcomes(orgId));
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", orgId);

    expect((await sendDueWelcomes(orgId)).sent).toBe(1); // kuyruğa verildi
    expect(await prisma.messageOutbox.count({ where: { organizationId: orgId, messageType: "welcome" } })).toBe(1);
    expect(mockSend).not.toHaveBeenCalled(); // doğrudan gönderim yok
  });
});
