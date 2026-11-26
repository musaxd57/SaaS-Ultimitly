import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { seedAutoMessage } from "../helpers/auto-message";

// ---------------------------------------------------------------------------
// AYNI REZERVASYON İKİ FARKLI DAİREDE KAYITLIYSA OTOMATİK MESAJ TUTULUR — SİSTEM DAİRE TAHMİN ETMEZ (kurucu 11-18 akşam). Gerçek PostgreSQL.
//
// Rezervasyon kaydı (daire, kaynak kimliği) çiftinde tekildir: aynı kaynak kimliği iki AYRI dairede bulunabilir. Misafirin hangi dairede
// kalacağı kayıtlardan bilinemez. Önceki kural "sıralamadaki ilk kayıt belirler"di (11-18 gündüz): ilk kaydın dairesinde metin varsa o
// dairenin metni gidiyordu — bu, yanlış daireye mesaj göndermeyi önleyen bir geri dönüş kuralıydı ama doğru daireyi kanıtlamıyordu. Şimdi:
// iki farklı dairede ETKİN kaydı olan rezervasyona karşılama / giriş bilgisi / çıkış mesajı gönderilmez (damgalanmaz, bekler). Ev sahibi
// yanlış kaydı kaldırınca ya da kayıt iptal olunca sonraki geçişte olağan gider. Kopyası olmayan rezervasyon etkilenmez.
// Kural tek kaynak: `src/lib/booking-property-conflict.ts` (göndericiler · kuyruk işçisi · Girişler ekranı).
// ---------------------------------------------------------------------------

vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: undefined })),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { sendDueWelcomes, sendDueCheckins, sendDueCheckouts, currentHourInTimeZone, __resetLifecycleRateHold } from "@/lib/automation";
import { sendOnChannel } from "@/lib/messaging";
import { lifecycleScanCursorName } from "@/lib/lifecycle-scan-cursor";

const mockSend = vi.mocked(sendOnChannel);
const DAY = 86_400_000;
const WELCOME_A = "Merhaba {isim}, Lale 1 için rezervasyonunuz alındı.";
const WELCOME_B = "Merhaba {isim}, Lale 2 için rezervasyonunuz alındı.";
const UNFILLED = "Merhaba {isim}, kapı kodu [KOD] olacak.";

/** Şu an yerel saati 09–10 olan sabit kaymalı saat dilimi (çıkış mesajı yalnız sabah gider; `lifecycle-candidate-paging` emsali). */
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
  const mk = (name: string) => prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name } });
  return { orgId: org.id, a: (await mk("Lale 1")).id, b: (await mk("Lale 2")).id };
}

/**
 * Aynı rezervasyonun iki dairedeki satırı. `first` taramanın sıraladığı tarihte (karşılama / giriş: geliş · çıkış: çıkış) ÖNCE gelir.
 * Sıranın TARİHE (kimliğe ya da öteki tarihe değil) bağlı olduğu sınansın diye ilk satırın kimliği sonra sıralanır ("z") ve öteki tarihi
 * kardeşinkinden GEÇTİR — yanlış alana göre sıralayan bir okuma kardeş satırı "ilk" sanar.
 */
async function seedDuplicate(ref: string, first: string, second: string, at: Date, by: "arrival" | "departure" = "arrival") {
  const base = { guestName: "Misafir Kopya", channel: "airbnb", status: "confirmed", sourceReference: ref };
  const later = new Date(at.getTime() + 60_000);
  const rows =
    by === "arrival"
      ? [
          { ...base, id: `${ref}-z-ilk`, propertyId: first, arrivalDate: at, departureDate: new Date(at.getTime() + 3 * DAY) },
          { ...base, id: `${ref}-a-kardes`, propertyId: second, arrivalDate: later, departureDate: new Date(at.getTime() + 2 * DAY) },
        ]
      : [
          { ...base, id: `${ref}-z-ilk`, propertyId: first, arrivalDate: new Date(at.getTime() - 1 * DAY), departureDate: at },
          { ...base, id: `${ref}-a-kardes`, propertyId: second, arrivalDate: new Date(at.getTime() - 3 * DAY), departureDate: later },
        ];
  await prisma.reservation.createMany({ data: rows });
}
const sentBodies = () => mockSend.mock.calls.map((c) => String(c[1]));
const tomorrow = () => new Date(Date.now() + DAY);

describe("otomatik mesaj — aynı rezervasyon iki farklı dairede kayıtlıysa tutulur", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockSend.mockReset();
    mockSend.mockImplementation(async () => ({ ok: true, providerMessageId: undefined }));
    __resetLifecycleRateHold();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 karşılama: ilk kaydın dairesinde metin VAR, kardeşinkinde yok → mesaj GİTMEZ (ilk kayıt 'kazanmaz'); kayıtlar damgalanmaz", async () => {
    const { orgId, a, b } = await seedOrg();
    await seedAutoMessage(a, "welcome", WELCOME_A);
    await seedDuplicate("kopya", a, b, tomorrow());

    const out = await sendDueWelcomes(orgId);
    expect(mockSend).not.toHaveBeenCalled(); // ⬅️ ÖNCEKİ kural: Lale 1'in metni gidiyordu (ilk kayıt belirler)
    expect(out.sent).toBe(0);
    expect(out.considered).toBe(0);
    expect(await prisma.reservation.count({ where: { sourceReference: "kopya", welcomeSentAt: { not: null } } })).toBe(0);
  });

  it("🚨 karşılama: iki dairede de metin var → mesaj GİTMEZ (hangi dairenin metni — tahmin yok)", async () => {
    const { orgId, a, b } = await seedOrg();
    await seedAutoMessage(a, "welcome", WELCOME_A);
    await seedAutoMessage(b, "welcome", WELCOME_B);
    await seedDuplicate("kopya", a, b, tomorrow());

    expect((await sendDueWelcomes(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled(); // ⬅️ ÖNCEKİ kural: Lale 1'in metni
  });

  it("🚨 karşılama: yalnız kardeş kaydın dairesinde metin var → mesaj GİTMEZ (metni olan daire 'kazanmaz')", async () => {
    const { orgId, a, b } = await seedOrg();
    await seedAutoMessage(b, "welcome", WELCOME_B);
    await seedDuplicate("kopya", a, b, tomorrow());

    expect((await sendDueWelcomes(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("🚨 giriş bilgisi: iki dairede kayıtlı rezervasyona giriş bilgisi GİTMEZ (ilk kaydın dairesinde metin olsa da)", async () => {
    const { orgId, a, b } = await seedOrg();
    await seedAutoMessage(a, "checkin", "Merhaba {isim}, Lale 1 giriş bilgileri: anahtar kutusu kapının solunda.");
    await seedDuplicate("kopya", a, b, new Date(Date.now() + 60 * 60_000)); // giriş bilgisi gelişe yakın pencerede gider

    const out = await sendDueCheckins(orgId);
    expect(mockSend).not.toHaveBeenCalled(); // ⬅️ ÖNCEKİ kural: Lale 1'in giriş bilgisi gidiyordu
    expect(out.sent).toBe(0);
    expect(await prisma.reservation.count({ where: { sourceReference: "kopya", checkinSentAt: { not: null } } })).toBe(0);
  });

  it("🚨 çıkış mesajı: aynı kural", async () => {
    const tz = morningZone();
    const { orgId, a, b } = await seedOrg(tz);
    await seedAutoMessage(a, "checkout", "Merhaba {isim}, Lale 1 çıkış hatırlatması: anahtarı kutuya bırakabilirsiniz.");
    await seedDuplicate("kopya", a, b, new Date(), "departure");

    const out = await sendDueCheckouts(orgId);
    expect(mockSend).not.toHaveBeenCalled(); // ⬅️ ÖNCEKİ kural: Lale 1'in metni
    expect(out.sent).toBe(0);
  });

  it("🚨 ÇÖZÜM: ev sahibi yanlış dairedeki kaydı KALDIRINCA sonraki geçişte mesaj kalan kaydın dairesinin metniyle gider", async () => {
    const { orgId, a, b } = await seedOrg();
    await seedAutoMessage(a, "welcome", WELCOME_A);
    await seedAutoMessage(b, "welcome", WELCOME_B);
    await seedDuplicate("kopya", a, b, tomorrow());
    expect((await sendDueWelcomes(orgId)).sent).toBe(0);

    await prisma.reservation.delete({ where: { id: "kopya-z-ilk" } }); // Lale 1'deki kayıt yanlıştı
    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(1);
    expect(sentBodies()).toEqual([expect.stringContaining("Lale 2 için")]);
    // Yeniden gönderilmez.
    await sendDueWelcomes(orgId);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("KONTROL: kardeş kayıt İPTAL ise etkin değildir — rezervasyon tek dairededir, mesaj olağan gider", async () => {
    const { orgId, a, b } = await seedOrg();
    await seedAutoMessage(b, "welcome", WELCOME_B);
    await seedDuplicate("kopya", a, b, tomorrow());
    await prisma.reservation.update({ where: { id: "kopya-z-ilk" }, data: { status: "cancelled" } });

    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(1);
    expect(sentBodies()).toEqual([expect.stringContaining("Lale 2 için")]);
  });

  it("KONTROL: aynı kaynak kimliğini taşıyan, bir ay önce BİTMİŞ bayat kopya etkin değildir — canlı rezervasyonun mesajı olağan gider", async () => {
    const { orgId, a, b } = await seedOrg();
    await seedAutoMessage(b, "welcome", WELCOME_B);
    const arrival = tomorrow();
    await prisma.reservation.createMany({
      data: [
        { propertyId: b, guestName: "Misafir Kopya", arrivalDate: arrival, departureDate: new Date(arrival.getTime() + 2 * DAY), channel: "airbnb", status: "confirmed", sourceReference: "kopya" },
        { propertyId: a, guestName: "Misafir Kopya", arrivalDate: new Date(Date.now() - 35 * DAY), departureDate: new Date(Date.now() - 30 * DAY), channel: "airbnb", status: "confirmed", sourceReference: "kopya" },
      ],
    });

    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(1);
    expect(sentBodies()).toEqual([expect.stringContaining("Lale 2 için")]);
  });

  it("KONTROL: kardeş kayıt 'bekliyor' durumundaysa da ETKİNDİR (iptal değil) → mesaj tutulur", async () => {
    const { orgId, a, b } = await seedOrg();
    await seedAutoMessage(b, "welcome", WELCOME_B);
    await seedDuplicate("kopya", a, b, tomorrow());
    await prisma.reservation.update({ where: { id: "kopya-z-ilk" }, data: { status: "pending" } });

    expect((await sendDueWelcomes(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("KONTROL: kopyası olmayan rezervasyon bugünkü gibi gider; aynı kaynak kimliğini taşımayan başka kayıt kimseyi tutmaz", async () => {
    const { orgId, a, b } = await seedOrg();
    await seedAutoMessage(b, "welcome", WELCOME_B);
    const arrival = tomorrow();
    const row = (propertyId: string, ref: string, guestName: string) => ({ propertyId, guestName, arrivalDate: arrival, departureDate: new Date(arrival.getTime() + 2 * DAY), channel: "airbnb", status: "confirmed", sourceReference: ref });
    await prisma.reservation.createMany({ data: [row(b, "tek", "Misafir Tek"), row(a, "baska", "Misafir Başka")] });

    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(1);
    expect(sentBodies()).toEqual([expect.stringContaining("Lale 2 için")]);
  });

  it("KONTROL: BAŞKA işletmedeki aynı kaynak kimliği sayılmaz (kural işletme kapsamlı)", async () => {
    const { orgId, b } = await seedOrg();
    const other = await seedOrg();
    await seedAutoMessage(b, "welcome", WELCOME_B);
    const arrival = tomorrow();
    const row = (propertyId: string) => ({ propertyId, guestName: "Misafir", arrivalDate: arrival, departureDate: new Date(arrival.getTime() + 2 * DAY), channel: "airbnb", status: "confirmed", sourceReference: "ortak-kimlik" });
    await prisma.reservation.createMany({ data: [row(b), row(other.a)] });

    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
  });

  it("🚨 imleç: kardeş kayıt imlecin GERİSİNDE kalsa da (o geçişte hiç okunmasa da) rezervasyon tutulur", async () => {
    const { orgId, a, b } = await seedOrg();
    await seedAutoMessage(a, "welcome", UNFILLED); // Lale 1: metin var ama doldurulamıyor → sorguda elenmez, döngüde atlanır
    await seedAutoMessage(b, "welcome", WELCOME_B);
    // Önde 199 gönderilemeyen aday (Lale 1) → okuma sınırı (8 sayfa × 25 = 200 satır) tam kopyanın İLK satırında dolar.
    const base = Date.now() + DAY;
    await prisma.reservation.createMany({
      data: Array.from({ length: 199 }, (_, i) => {
        const arrival = new Date(base + i * 60_000);
        return { propertyId: a, guestName: `Misafir ${i}`, arrivalDate: arrival, departureDate: new Date(arrival.getTime() + 2 * DAY), channel: "airbnb", status: "confirmed", sourceReference: `blk-${i}` };
      }),
    });
    await seedDuplicate("kopya", a, b, new Date(base + 500 * 60_000)); // 200. satır = Lale 1'deki kayıt, 201. = Lale 2'deki kardeş

    const first = await sendDueWelcomes(orgId);
    expect(first.sent).toBe(0);
    const cursor = await prisma.systemLock.findUnique({ where: { name: lifecycleScanCursorName("welcome", orgId) } });
    expect(String(cursor?.holder ?? "")).toContain("kopya-z-ilk"); // kurulumun gerçekten istenen anı yakaladığının kanıtı

    // 2. geçiş: kuyruk sayfası imlecin ardından başlar → ilk okunan satır Lale 2'deki kayıttır (Lale 1'deki bu geçişte hiç okunmaz).
    const second = await sendDueWelcomes(orgId);
    expect(mockSend).not.toHaveBeenCalled();
    expect(second.sent).toBe(0);
    expect(await prisma.reservation.count({ where: { sourceReference: "kopya", welcomeSentAt: { not: null } } })).toBe(0);
  });
});
