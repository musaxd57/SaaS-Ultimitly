import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// DEĞİŞMEZ 6 — doğrudan kanal ↔ iCal sahipliği, gerçek senkron + gerçek PostgreSQL (kurucu gereksinimi 09-08; kurucu 10-11: yalnız doğrudan
// kanal, Hospitable köprüsü hariç). Besleme çekme taklit (ağ yok); karar kodu ve yazma yolu gerçek.
// ---------------------------------------------------------------------------

vi.mock("@/lib/net/pinned-fetch", () => ({ fetchFeedText: vi.fn() }));
vi.mock("@/lib/net/private-host", () => ({ isPrivateHost: () => false, resolvesToPrivate: async () => false }));

import { syncCalendarSource } from "@/lib/import/sync";
import { fetchFeedText } from "@/lib/net/pinned-fetch";

const ics = (uid: string, from = "20270110", to = "20270114") =>
  `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:${uid}\nDTSTART;VALUE=DATE:${from}\nDTEND;VALUE=DATE:${to}\nSUMMARY:Misafir\nEND:VEVENT\nEND:VCALENDAR`;

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const airbnbIcal = await prisma.calendarSource.create({
    data: { propertyId, label: "Airbnb", url: "https://www.airbnb.com/calendar/ical/111.ics?s=t" },
  });
  const bookingIcal = await prisma.calendarSource.create({
    data: { propertyId, label: "Booking", url: "https://admin.booking.com/hotel/hoteladmin/ical.html?t=t" },
  });
  return { orgId, propertyId, airbnbIcal, bookingIcal };
}
async function connect(orgId: string, propertyId: string, provider: string, status = "active") {
  const conn = await prisma.channelConnection.create({ data: { organizationId: orgId, provider, status } });
  await prisma.channelListing.create({ data: { organizationId: orgId, connectionId: conn.id, externalId: `L-${provider}`, propertyId } });
  return conn;
}
const icalRows = (sourceId: string) => prisma.reservation.count({ where: { calendarSourceId: sourceId } });

describe("değişmez 6 — doğrudan kanal varken aynı kanalın iCal'i yedek", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(fetchFeedText).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("KONTROL (bugünkü durum): doğrudan bağlantı yokken Airbnb iCal'i yazar", async () => {
    const s = await seed();
    vi.mocked(fetchFeedText).mockResolvedValue(ics("a-1@airbnb.com"));
    const r = await syncCalendarSource(s.airbnbIcal.id);
    expect(r.standby).toBeUndefined();
    expect(r.imported).toBe(1);
    expect(await icalRows(s.airbnbIcal.id)).toBe(1);
  });

  it("🚨 Airbnb doğrudan bağlantısı bu mülkü kapsıyor → Airbnb iCal YAZMAZ (sağlık yazılır); Booking iCal yazmaya devam eder", async () => {
    const s = await seed();
    await connect(s.orgId, s.propertyId, "airbnb_direct");
    vi.mocked(fetchFeedText).mockResolvedValue(ics("a-1@airbnb.com"));
    const r = await syncCalendarSource(s.airbnbIcal.id);
    expect(r.standby).toBe(true);
    expect(r.imported).toBe(0);
    expect(await icalRows(s.airbnbIcal.id)).toBe(0);
    const src = await prisma.calendarSource.findUniqueOrThrow({ where: { id: s.airbnbIcal.id } });
    expect(src.lastStatus).toBe("ok");
    expect(src.lastResult).toContain("Yedek takvim");
    expect(src.lastSyncedAt).not.toBeNull();

    vi.mocked(fetchFeedText).mockResolvedValue(ics("b-1@booking.com", "20270201", "20270205"));
    const rb = await syncCalendarSource(s.bookingIcal.id);
    expect(rb.standby).toBeUndefined();
    expect(await icalRows(s.bookingIcal.id)).toBe(1);
  });

  it("🚨 yedekken eski iCal satırları SİLİNMEZ ve iptal EDİLMEZ (beslemede görünmese de)", async () => {
    const s = await seed();
    vi.mocked(fetchFeedText).mockResolvedValue(ics("old-1@airbnb.com"));
    await syncCalendarSource(s.airbnbIcal.id);
    const before = await prisma.reservation.findFirstOrThrow({ where: { calendarSourceId: s.airbnbIcal.id } });
    await connect(s.orgId, s.propertyId, "airbnb_direct");
    vi.mocked(fetchFeedText).mockResolvedValue(ics("new-2@airbnb.com", "20270301", "20270303"));
    for (let i = 0; i < 4; i++) await syncCalendarSource(s.airbnbIcal.id);
    const after = await prisma.reservation.findMany({ where: { calendarSourceId: s.airbnbIcal.id } });
    expect(after.map((x) => x.id)).toEqual([before.id]);
    expect(after[0].status).toBe(before.status);
  });

  it("geri alınabilir: doğrudan bağlantı kopunca (disconnected) Airbnb iCal yeniden yetkili", async () => {
    const s = await seed();
    await connect(s.orgId, s.propertyId, "airbnb_direct", "disconnected");
    vi.mocked(fetchFeedText).mockResolvedValue(ics("a-1@airbnb.com"));
    const r = await syncCalendarSource(s.airbnbIcal.id);
    expect(r.standby).toBeUndefined();
    expect(await icalRows(s.airbnbIcal.id)).toBe(1);
  });

  it("🚨 KURUCU 10-11: Hospitable köprüsü bu mülkü kapsasa da Airbnb iCal yazmaya devam eder (kural yalnız doğrudan kanalda)", async () => {
    const s = await seed();
    await connect(s.orgId, s.propertyId, "hospitable");
    vi.mocked(fetchFeedText).mockResolvedValue(ics("a-1@airbnb.com"));
    const r = await syncCalendarSource(s.airbnbIcal.id);
    expect(r.standby).toBeUndefined();
    expect(await icalRows(s.airbnbIcal.id)).toBe(1);
  });

  it("doğrudan bağlantı BAŞKA mülkü kapsıyorsa bu mülkün Airbnb iCal'i yetkili kalır", async () => {
    const s = await seed();
    const other = await prisma.property.create({ data: { organizationId: s.orgId, name: "Lale 9" } });
    await connect(s.orgId, other.id, "airbnb_direct");
    vi.mocked(fetchFeedText).mockResolvedValue(ics("a-1@airbnb.com"));
    expect((await syncCalendarSource(s.airbnbIcal.id)).standby).toBeUndefined();
    expect(await icalRows(s.airbnbIcal.id)).toBe(1);
  });

  it("🚨 kiracı kapsamı: başka kiracının doğrudan bağlantısı (aynı mülk kimliğine yazılmış ilan) bu mülkü yedeğe düşürmez", async () => {
    const s = await seed();
    const { orgId: otherOrg } = await makeOrgWithProperty();
    const conn = await prisma.channelConnection.create({ data: { organizationId: otherOrg, provider: "airbnb_direct", status: "active" } });
    await prisma.channelListing.create({ data: { organizationId: otherOrg, connectionId: conn.id, externalId: "X", propertyId: s.propertyId } });
    vi.mocked(fetchFeedText).mockResolvedValue(ics("a-1@airbnb.com"));
    expect((await syncCalendarSource(s.airbnbIcal.id)).standby).toBeUndefined();
  });

  it.each([
    ["ilan satırı bu kiracıda, bağlantı YABANCI kiracıda (mutasyon A7)", "listing-own"],
    ["bağlantı bu kiracıda, ilan satırı YABANCI kiracıda (mutasyon A6)", "conn-own"],
  ])("🚨 tutarsız / yabancı satır yedeğe düşürmez — iki kiracı süzgeci ayrı ayrı: %s", async (_n, shape) => {
    const s = await seed();
    const { orgId: otherOrg } = await makeOrgWithProperty();
    const connOrg = shape === "listing-own" ? otherOrg : s.orgId;
    const listingOrg = shape === "listing-own" ? s.orgId : otherOrg;
    const conn = await prisma.channelConnection.create({ data: { organizationId: connOrg, provider: "airbnb_direct", status: "active" } });
    await prisma.channelListing.create({ data: { organizationId: listingOrg, connectionId: conn.id, externalId: "Y", propertyId: s.propertyId } });
    vi.mocked(fetchFeedText).mockResolvedValue(ics("a-1@airbnb.com"));
    expect((await syncCalendarSource(s.airbnbIcal.id)).standby).toBeUndefined();
    expect(await icalRows(s.airbnbIcal.id)).toBe(1);
  });

  it("tanınmayan adres (etiket 'Airbnb' olsa da) tahminle yedeğe düşmez", async () => {
    const s = await seed();
    await connect(s.orgId, s.propertyId, "airbnb_direct");
    const custom = await prisma.calendarSource.create({ data: { propertyId: s.propertyId, label: "Airbnb", url: "https://example.com/airbnb.ics" } });
    vi.mocked(fetchFeedText).mockResolvedValue(ics("c-1@example.com"));
    expect((await syncCalendarSource(custom.id)).standby).toBeUndefined();
    expect(await icalRows(custom.id)).toBe(1);
  });
});
