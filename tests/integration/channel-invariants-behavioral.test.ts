import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";

vi.mock("@/lib/net/pinned-fetch", () => ({ fetchFeedText: vi.fn() }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));
import { fetchFeedText } from "@/lib/net/pinned-fetch";
import { syncCalendarSource } from "@/lib/import/sync";
import { clearOrgHospitableToken, setOrgHospitableToken } from "@/lib/hospitable-credentials";
import { getReturningGuestInfo } from "@/lib/returning-guest";

// ---------------------------------------------------------------------------
// KURUCU TALİMATI 09-07 DEĞİŞMEZLERİ — DAVRANIŞSAL PİNLER (10-13 gece, Haiku kapsam denetimi: üçünün yalnız bildirimsel / dolaylı pini vardı).
//  5  iCal mesaj okuma / gönderme / webhook davranışı İMA ETMEZ → besleme senkronu konuşma, mesaj, giden kuyruk satırı YAZMAZ.
//  14 bağlantı kopunca veri sınıfları manifestteki gibi KORUNUR (Hospitable: hepsi `retain`) → kopma rezervasyon / konuşma / mesaj /
//     görev silmez; yalnız kimlik bilgisi düşer.
//  10 tahmine dayalı birleştirme YOK → "dönen misafir" yalnız sağlayıcının KARARLI misafir kimliğiyle; aynı ad + e-posta tek başına
//     iki konaklamayı BİRLEŞTİRMEZ.
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const icsDate = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10).replace(/-/g, "");
const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Airbnb//Hosting Calendar//EN
BEGIN:VEVENT
UID:inv5-a@airbnb.com
DTSTART;VALUE=DATE:${icsDate(5)}
DTEND;VALUE=DATE:${icsDate(9)}
SUMMARY:Ahmet Yılmaz
END:VEVENT
BEGIN:VEVENT
UID:inv5-b@airbnb.com
DTSTART;VALUE=DATE:${icsDate(11)}
DTEND;VALUE=DATE:${icsDate(13)}
SUMMARY:Jane Doe
END:VEVENT
END:VCALENDAR`;

describe("değişmez 5 — iCal yalnız takvim: mesaj tarafına hiç dokunmaz", () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it("🚨 besleme senkronu rezervasyon yazar; konuşma / mesaj / giden kuyruk satırı YAZMAZ ve mesaj okuma çağrısı yapmaz", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const source = await prisma.calendarSource.create({ data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics" } });
    vi.mocked(fetchFeedText).mockResolvedValue(ICS);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await syncCalendarSource(source.id);

    expect(res.imported).toBe(2); // KONTROL: senkron gerçekten çalıştı
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(2);
    expect(await prisma.conversation.count()).toBe(0);
    expect(await prisma.message.count()).toBe(0);
    expect(await prisma.messageOutbox.count()).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled(); // tek ağ yolu sabitlenmiş besleme okuyucusu; sağlayıcı mesaj API'si çağrılmaz
    expect(vi.mocked(fetchFeedText)).toHaveBeenCalledTimes(1);
  });
});

describe("değişmez 14 — kopmada veri sınıfları korunur (Hospitable manifesti: retain)", () => {
  beforeEach(resetDb);

  it("🚨 bağlantıyı kesmek kimlik bilgisini düşürür; rezervasyon / konuşma / mesaj / görev SİLİNMEZ, bağlantı satırı kopuk olur", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await setOrgHospitableToken(orgId, "tok-inv14", "1 mülk");
    const r = await prisma.reservation.create({
      data: { propertyId, guestName: "Misafir", arrivalDate: daysFromNow(3), departureDate: daysFromNow(6), status: "confirmed", channel: "airbnb" },
    });
    const c = await prisma.conversation.create({ data: { propertyId, reservationId: r.id, guestIdentifier: "Misafir", channel: "airbnb", status: "new" } });
    await prisma.message.create({ data: { conversationId: c.id, direction: "inbound", body: "Merhaba", senderName: "Misafir" } });
    await prisma.task.create({ data: { propertyId, title: "Temizlik", type: "cleaning", status: "todo" } });
    const before = {
      reservation: await prisma.reservation.count(),
      conversation: await prisma.conversation.count(),
      message: await prisma.message.count(),
      task: await prisma.task.count(),
    };

    await clearOrgHospitableToken(orgId);

    expect({
      reservation: await prisma.reservation.count(),
      conversation: await prisma.conversation.count(),
      message: await prisma.message.count(),
      task: await prisma.task.count(),
    }).toEqual(before);
    expect(before).toEqual({ reservation: 1, conversation: 1, message: 1, task: 1 }); // anti-vakumluk
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { hospitableTokenEnc: true } });
    expect(org.hospitableTokenEnc).toBeNull();
    const conn = await prisma.channelConnection.findFirst({ where: { organizationId: orgId, provider: "hospitable" } });
    expect(conn?.status).not.toBe("active");
  });
});

describe("değişmez 10 — tahmine dayalı birleştirme yok (dönen misafir)", () => {
  beforeEach(resetDb);

  async function stay(propertyId: string, guestExternalId: string | null, daysAgo: number, email: string | null) {
    return prisma.reservation.create({
      data: {
        propertyId, guestName: "Ayşe Yılmaz", guestEmail: email, guestExternalId, status: daysAgo > 0 ? "completed" : "confirmed", channel: "airbnb",
        arrivalDate: daysFromNow(-daysAgo), departureDate: daysFromNow(-daysAgo + 3),
      },
    });
  }

  it("🚨 aynı ad + aynı e-posta, FARKLI misafir kimliği → dönen misafir DEĞİL", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await stay(propertyId, "g-baska", 30, "ayse@example.com");
    const cur = await stay(propertyId, "g-bu", 0, "ayse@example.com");
    expect(await getReturningGuestInfo(orgId, { id: cur.id, guestExternalId: "g-bu", arrivalDate: cur.arrivalDate })).toBeNull();
  });

  it("KONTROL: aynı misafir kimliği (ad / e-posta farklı olsa da) → dönen misafir", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await stay(propertyId, "g-bu", 30, "baska@example.com");
    const cur = await stay(propertyId, "g-bu", 0, null);
    expect((await getReturningGuestInfo(orgId, { id: cur.id, guestExternalId: "g-bu", arrivalDate: cur.arrivalDate }))?.stayCount).toBe(2);
  });
});
