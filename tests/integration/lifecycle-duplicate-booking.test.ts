import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { seedAutoMessage } from "../helpers/auto-message";

// ---------------------------------------------------------------------------
// AYNI REZERVASYON İKİ DAİREDE KAYITLIYSA — TEK ADAY, SIRALAMADAKİ İLK SATIR (Codex 11-17 D2 dilim sonu incelemesi). Gerçek PostgreSQL.
//
// Rezervasyon kaydı (daire, kaynak kimliği) çiftinde tekildir: aynı kaynak kimliği iki AYRI dairede bulunabilir. Göndericiler eskiden beri
// "rezervasyon başına tek mesaj" der ve o rezervasyonun sıralamadaki İLK satırına bakar: ilk satır gönderilemiyorsa (dairesinin metni yok /
// metin doldurulamıyor) rezervasyona o geçişte mesaj gitmez — kardeş satırın dairesinin metni (başka kapı kodu taşıyabilir) kullanılmaz.
// D2 düzeltmesi iki yerde bu kuralı farkında olmadan gevşetmişti:
//  (1) metni olmayan dairenin satırı sorguda elenince kardeş satır "ilk satır" gibi seçiliyor ve ÖTEKİ dairenin metni gidiyordu;
//  (2) kalıcı imleç ilk satırı geçtikten sonraki geçişte kardeş satır tek başına okunuyor ve yine öteki dairenin metni gidiyordu.
// Kural artık açık: ilk satır, tür süzgeci ve imleçten BAĞIMSIZ olarak rezervasyonun kendi kümesinden belirlenir.
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

describe("otomatik mesaj — aynı rezervasyon iki dairede kayıtlıysa ilk satır belirler", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockSend.mockReset();
    mockSend.mockImplementation(async () => ({ ok: true, providerMessageId: undefined }));
    __resetLifecycleRateHold();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 karşılama: ilk satırın dairesinde metin YOK, kardeş satırın dairesinde var → mesaj GİTMEZ (öteki dairenin metni kullanılmaz)", async () => {
    const { orgId, a, b } = await seedOrg();
    await seedAutoMessage(b, "welcome", WELCOME_B);
    await seedDuplicate("kopya", a, b, tomorrow());

    const out = await sendDueWelcomes(orgId);
    expect(mockSend).not.toHaveBeenCalled(); // ⬅️ D2 düzeltmesinden sonra 1'di: Lale 2'nin metni gidiyordu
    expect(out.sent).toBe(0);
    expect(out.considered).toBe(0);
    expect(await prisma.reservation.count({ where: { sourceReference: "kopya", welcomeSentAt: { not: null } } })).toBe(0);
  });

  it("🚨 giriş bilgisi: aynı kural — ilk satırın dairesinde metin yoksa kardeş dairenin giriş bilgisi GİTMEZ", async () => {
    const { orgId, a, b } = await seedOrg();
    await seedAutoMessage(b, "checkin", "Merhaba {isim}, Lale 2 giriş bilgileri: anahtar kutusu kapının sağında.");
    await seedDuplicate("kopya", a, b, new Date(Date.now() + 60 * 60_000)); // giriş bilgisi gelişe yakın pencerede gider

    const out = await sendDueCheckins(orgId);
    expect(mockSend).not.toHaveBeenCalled();
    expect(out.sent).toBe(0);
    expect(await prisma.reservation.count({ where: { sourceReference: "kopya", checkinSentAt: { not: null } } })).toBe(0);
  });

  it("🚨 çıkış mesajı: aynı kural", async () => {
    const tz = morningZone();
    const { orgId, a, b } = await seedOrg(tz);
    await seedAutoMessage(b, "checkout", "Merhaba {isim}, Lale 2 çıkış hatırlatması: anahtarı kutuya bırakabilirsiniz.");
    await seedDuplicate("kopya", a, b, new Date(), "departure");

    const out = await sendDueCheckouts(orgId);
    expect(mockSend).not.toHaveBeenCalled();
    expect(out.sent).toBe(0);
  });

  it("KONTROL: ilk satırın dairesinde metin VAR, kardeşinkinde yok → TEK mesaj, ilk satırın dairesinin metniyle; iki satır da damgalanır", async () => {
    const { orgId, a, b } = await seedOrg();
    await seedAutoMessage(a, "welcome", WELCOME_A);
    await seedDuplicate("kopya", a, b, tomorrow());

    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(1);
    expect(sentBodies()).toHaveLength(1);
    expect(sentBodies()[0]).toContain("Lale 1 için");
    expect(await prisma.reservation.count({ where: { sourceReference: "kopya", welcomeSentAt: { not: null } } })).toBe(2);
    // İkinci geçiş: yeniden gönderilmez.
    await sendDueWelcomes(orgId);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("KONTROL: iki dairede de metin var → TEK mesaj ve İLK satırın dairesinin metni (kardeşinki değil)", async () => {
    const { orgId, a, b } = await seedOrg();
    await seedAutoMessage(a, "welcome", WELCOME_A);
    await seedAutoMessage(b, "welcome", WELCOME_B);
    await seedDuplicate("kopya", a, b, tomorrow());

    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(1);
    expect(sentBodies()).toEqual([expect.stringContaining("Lale 1 için")]);
  });

  it("🚨 tarihler AYNIYSA sırayı kimlik belirler: küçük kimlikli satır ilk satırdır — onun dairesinde metin yoksa mesaj GİTMEZ", async () => {
    const { orgId, a, b } = await seedOrg();
    await seedAutoMessage(b, "welcome", WELCOME_B);
    const arrival = tomorrow();
    const row = (id: string, propertyId: string) => ({ id, propertyId, guestName: "Misafir Kopya", arrivalDate: arrival, departureDate: new Date(arrival.getTime() + 2 * DAY), channel: "airbnb", status: "confirmed", sourceReference: "esit" });
    await prisma.reservation.createMany({ data: [row("esit-a", a), row("esit-b", b)] });

    const out = await sendDueWelcomes(orgId);
    expect(mockSend).not.toHaveBeenCalled();
    expect(out.sent).toBe(0);
  });

  it("KONTROL: kopyası olmayan rezervasyon bugünkü gibi gider (kural yalnız kopya satırı etkiler)", async () => {
    const { orgId, a, b } = await seedOrg();
    await seedAutoMessage(b, "welcome", WELCOME_B);
    const arrival = tomorrow();
    await prisma.reservation.create({
      data: { propertyId: b, guestName: "Misafir Tek", arrivalDate: arrival, departureDate: new Date(arrival.getTime() + 2 * DAY), channel: "airbnb", status: "confirmed", sourceReference: "tek" },
    });
    // Aynı kaynak kimliği taşımayan, metinsiz dairedeki başka bir rezervasyon: kimseyi gölgelemez.
    await prisma.reservation.create({
      data: { propertyId: a, guestName: "Misafir Başka", arrivalDate: arrival, departureDate: new Date(arrival.getTime() + 2 * DAY), channel: "airbnb", status: "confirmed", sourceReference: "baska" },
    });

    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(1);
    expect(sentBodies()).toEqual([expect.stringContaining("Lale 2 için")]);
  });

  it("KONTROL: ilk satır gönderim kümesinin DIŞINDAYSA (iptal) kardeşi gölgelemez — bugünkü gibi kardeş satır gider", async () => {
    const { orgId, a, b } = await seedOrg();
    await seedAutoMessage(b, "welcome", WELCOME_B);
    await seedDuplicate("kopya", a, b, tomorrow());
    await prisma.reservation.update({ where: { id: "kopya-z-ilk" }, data: { status: "cancelled" } });

    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(1);
    expect(sentBodies()).toEqual([expect.stringContaining("Lale 2 için")]);
  });

  it("🚨 imleç: ilk satır (metni doldurulamayan daire) imlecin GERİSİNDE kalınca kardeş satır tek başına okunur — yine GİTMEZ", async () => {
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
    await seedDuplicate("kopya", a, b, new Date(base + 500 * 60_000)); // 200. satır = ilk satır (Lale 1), 201. = kardeş (Lale 2)

    // 1. geçiş: 200 satır okundu, hiçbiri gönderilemedi; imleç kopyanın İLK satırında kaldı.
    const first = await sendDueWelcomes(orgId);
    expect(first.sent).toBe(0);
    const cursor = await prisma.systemLock.findUnique({ where: { name: lifecycleScanCursorName("welcome", orgId) } });
    expect(String(cursor?.holder ?? "")).toContain("kopya-z-ilk"); // kurulumun gerçekten istenen anı yakaladığının kanıtı

    // 2. geçiş: kuyruk sayfası imlecin ardından başlar → ilk okunan satır KARDEŞ satırdır (ilk satır bu geçişte hiç okunmaz).
    const second = await sendDueWelcomes(orgId);
    expect(mockSend).not.toHaveBeenCalled(); // ⬅️ D2 düzeltmesinden sonra 1'di: Lale 2'nin metni gidiyordu
    expect(second.sent).toBe(0);
    expect(await prisma.reservation.count({ where: { sourceReference: "kopya", welcomeSentAt: { not: null } } })).toBe(0);
  });
});
