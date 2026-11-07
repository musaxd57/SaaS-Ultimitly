import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { loadStayEdgeSummary } from "@/modules/availability/stay-edges-load";

// ---------------------------------------------------------------------------
// KONAKLAMA KENARLARI — gerçek PG. Kiracı sınırı DAVRANIŞSAL (değişmez 16): başka org'un
// mülkü için kart YOK (asla "boş" değil); komşu org'un rezervasyonu kenar gecesini DOLDURMAZ;
// iptal edilmiş konaklamanın kenarı sorulmaz; host girişi taze kaynak sayılır.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-01T09:00:00Z");
const TZ = "Europe/Istanbul";
const midnight = (d: string) => new Date(`${d}T00:00:00.000Z`);

async function reservation(propertyId: string, arrival: string, departure: string, status = "confirmed", channel = "manual") {
  return prisma.reservation.create({
    data: { propertyId, guestName: "Misafir", arrivalDate: midnight(arrival), departureDate: midnight(departure), status, channel },
  });
}
const stayOf = (r: { id: string; arrivalDate: Date; departureDate: Date; status: string }) => ({
  id: r.id,
  arrival: r.arrivalDate,
  departure: r.departureDate,
  status: r.status,
});

describe("loadStayEdgeSummary", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("sonraki misafir çıkış günü giriyor → uyarı satırı; bağlı takvim yok → tek dipnot", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const own = await reservation(propertyId, "2026-10-05", "2026-10-08");
    await reservation(propertyId, "2026-10-08", "2026-10-10");
    const s = await loadStayEdgeSummary(orgId, propertyId, stayOf(own), { timeZone: TZ, now: NOW });
    expect(s?.lines.map((l) => l.text)).toEqual([
      "Erken giriş: 4 Eki gecesi kayıtlı rezervasyon yok.",
      "Geç çıkış / uzatma: 8 Eki gecesi dolu.",
      "Sonraki kayıtlı rezervasyon çıkış günü başlıyor.",
    ]);
    expect(s?.footer).toBe("Bu daireye bağlı bir takvim yok. Misafire söz vermeden önce kanal takviminden kontrol edin.");
  });

  it("🚨 kiracı sınırı: başka org'un mülkü → null (kart gizlenir, 'boş' DENMEZ)", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    const own = await reservation(b.propertyId, "2026-10-05", "2026-10-08");
    expect(await loadStayEdgeSummary(a.orgId, b.propertyId, stayOf(own), { timeZone: TZ, now: NOW })).toBeNull();
  });

  it("🚨 komşu org'un aynı tarihli rezervasyonu kenar gecesini DOLDURMAZ", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    const own = await reservation(a.propertyId, "2026-10-05", "2026-10-08");
    await reservation(b.propertyId, "2026-10-08", "2026-10-10");
    const s = await loadStayEdgeSummary(a.orgId, a.propertyId, stayOf(own), { timeZone: TZ, now: NOW });
    expect(s?.lines.map((l) => l.text)).toContain("Geç çıkış / uzatma: 8 Eki gecesi kayıtlı rezervasyon yok.");
    expect(s?.lines.some((l) => l.tone === "warn")).toBe(false);
  });

  it("iptal edilmiş konaklama → null (misafir artık gelmiyor)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const own = await reservation(propertyId, "2026-10-05", "2026-10-08", "cancelled");
    expect(await loadStayEdgeSummary(orgId, propertyId, stayOf(own), { timeZone: TZ, now: NOW })).toBeNull();
  });

  it("aynı mülkte konaklama gecelerine düşen ikinci rezervasyon → örtüşme uyarısı", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const own = await reservation(propertyId, "2026-10-05", "2026-10-08");
    await reservation(propertyId, "2026-10-06", "2026-10-07", "confirmed", "ics");
    const s = await loadStayEdgeSummary(orgId, propertyId, stayOf(own), { timeZone: TZ, now: NOW });
    expect(s?.lines[0]).toEqual({ tone: "warn", text: "Bu konaklamanın 6 Eki gecesinde başka bir rezervasyon da var." });
  });

  it("taze takvim bağlantısı + boş kenar → 'bağlı takvimlerinizde boş', dipnot yok", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/a.ics", lastStatus: "ok", lastSyncedAt: new Date("2026-10-01T08:30:00Z") },
    });
    const own = await reservation(propertyId, "2026-10-05", "2026-10-08");
    const s = await loadStayEdgeSummary(orgId, propertyId, stayOf(own), { timeZone: TZ, now: NOW });
    expect(s?.lines[0].text).toBe("Erken giriş: 4 Eki gecesi bağlı takvimlerinizde boş.");
    expect(s?.footer).toBeNull();
  });
});
