import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { getMonthlyReport, getOpsStats, bookingDedupeKey } from "@/lib/reports";

// ---------------------------------------------------------------------------
// Y7 + Y8 (Codex 10-07, 15c8663) — gerçek PostgreSQL.
//  Y7: aylık rapor ay üyeliğini ham yerel pencereyle alıyordu; yalnız-tarih değeri (D 00:00Z) UTC tarihidir → New York'ta 1 Ekim
//      girişi Eylül'e düşüyor, 1 Kasım girişi Ekim'e giriyordu. Doğru: tek tarih kuralı (`calendarDateOf` sorgu ikizi).
//  Y8: tekilleştirme org çapında yalnız `sourceReference`ti → farklı dairelerin aynı referanslı ELLE rezervasyonları tek sayıldı,
//      ikinci dairenin geliri raporda yoktu. Doğru: yalnız SAĞLAYICI rezervasyonu daireler arası birleşir.
// ---------------------------------------------------------------------------

const NY = "America/New_York";
const IST = "Europe/Istanbul";

beforeEach(resetDb);
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await prisma.$disconnect();
});
function freeze(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}
async function org(timezone: string, flats = 1) {
  const o = await prisma.organization.create({ data: { name: "Rapor", timezone } });
  const ids: string[] = [];
  for (let i = 0; i < flats; i++) ids.push((await prisma.property.create({ data: { organizationId: o.id, name: `Daire ${i + 1}` } })).id);
  return { orgId: o.id, propertyIds: ids };
}
const booking = (propertyId: string, arrival: string, extra: Record<string, unknown> = {}) =>
  prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Deneme Misafir",
      arrivalDate: new Date(arrival),
      departureDate: new Date(new Date(arrival).getTime() + 2 * 86_400_000),
      status: "confirmed",
      totalAmount: 100,
      totalAmountDec: 100,
      currency: "EUR",
      ...extra,
    },
  });

describe("Y7 — aylık rapor ay sınırı tek tarih kuralıyla", () => {
  it("🚨 New York: 1 Ekim (00:00Z) girişi Ekim'de, 1 Kasım girişi Ekim'de DEĞİL", async () => {
    freeze("2026-10-15T15:00:00Z");
    const { orgId, propertyIds } = await org(NY);
    await booking(propertyIds[0], "2026-10-01T00:00:00Z", { sourceReference: "a" });
    await booking(propertyIds[0], "2026-11-01T00:00:00Z", { sourceReference: "b" });
    const r = await getMonthlyReport(orgId);
    expect(r.reservationsCount).toBe(1); // ⬅️ ARIZADA 1 ama YANLIŞ satır (Kasım girişi), Ekim 1 düşmüştü
    expect(r.revenueByCurrency).toEqual([{ currency: "EUR", total: 100 }]);
    // Kasım'a geçince Kasım girişi sayılır, Ekim 1 sayılmaz.
    freeze("2026-11-15T15:00:00Z");
    expect((await getMonthlyReport(orgId)).reservationsCount).toBe(1);
  });

  it("KONTROL: New York: ayın son günü (31 Ekim 12:00Z) Ekim'de; gerçek an yerel aya göre (1 Kasım 02:00Z = 31 Ekim akşamı)", async () => {
    freeze("2026-10-15T15:00:00Z");
    const { orgId, propertyIds } = await org(NY);
    await booking(propertyIds[0], "2026-10-31T12:00:00Z", { sourceReference: "son" });
    await booking(propertyIds[0], "2026-11-01T02:00:00Z", { sourceReference: "an" });
    await booking(propertyIds[0], "2026-09-30T12:00:00Z", { sourceReference: "eylul" });
    expect((await getMonthlyReport(orgId)).reservationsCount).toBe(2);
  });

  it("KONTROL: İstanbul'da sonuç eskisiyle aynı", async () => {
    freeze("2026-10-15T09:00:00Z");
    const { orgId, propertyIds } = await org(IST);
    await booking(propertyIds[0], "2026-10-01T00:00:00Z", { sourceReference: "a" });
    await booking(propertyIds[0], "2026-10-31T12:00:00Z", { sourceReference: "b" });
    await booking(propertyIds[0], "2026-11-01T00:00:00Z", { sourceReference: "c" });
    await booking(propertyIds[0], "2026-09-30T12:00:00Z", { sourceReference: "d" });
    expect((await getMonthlyReport(orgId)).reservationsCount).toBe(2);
  });
});

describe("Y8 — tekilleştirme yalnız aynı rezervasyonu birleştirir", () => {
  it("🚨 iki farklı dairede aynı referanslı ELLE rezervasyon → ikisi de sayılır, gelir 200", async () => {
    freeze("2026-10-15T09:00:00Z");
    const { orgId, propertyIds } = await org(IST, 2);
    await booking(propertyIds[0], "2026-10-05T00:00:00Z", { sourceReference: "R1", channel: "manual" });
    await booking(propertyIds[1], "2026-10-05T00:00:00Z", { sourceReference: "R1", channel: "manual" });
    const r = await getMonthlyReport(orgId);
    expect(r.reservationsCount).toBe(2); // ⬅️ ARIZADA 1
    expect(r.revenueByCurrency).toEqual([{ currency: "EUR", total: 200 }]);
  });

  it("🚨 bugünkü girişler: iki dairenin aynı referanslı dosya rezervasyonu iki giriş", async () => {
    freeze("2026-10-15T09:00:00Z");
    const { orgId, propertyIds } = await org(IST, 2);
    await booking(propertyIds[0], "2026-10-15T00:00:00Z", { sourceReference: "UID-1", channel: "ics" });
    await booking(propertyIds[1], "2026-10-15T00:00:00Z", { sourceReference: "UID-1", channel: "ics" });
    expect((await getOpsStats(orgId)).arrivalsToday).toBe(2); // ⬅️ ARIZADA 1
  });

  it("KONTROL: aynı SAĞLAYICI rezervasyonu iki dairede görünse de BİR kez sayılır (eski koruma)", async () => {
    freeze("2026-10-15T09:00:00Z");
    const { orgId, propertyIds } = await org(IST, 2);
    await booking(propertyIds[0], "2026-10-15T00:00:00Z", { sourceReference: "hosp-1", channel: "airbnb" });
    await booking(propertyIds[1], "2026-10-15T00:00:00Z", { sourceReference: "hosp-1", channel: "airbnb" });
    expect((await getOpsStats(orgId)).arrivalsToday).toBe(1);
    expect((await getMonthlyReport(orgId)).reservationsCount).toBe(1);
  });

  it("anahtar kuralı: referanssız → tek başına; takvim beslemesi satırı daire içinde", () => {
    const base = { propertyId: "p1", calendarSourceId: null, channel: "airbnb" };
    expect(bookingDedupeKey({ ...base, sourceReference: null })).toBeNull();
    expect(bookingDedupeKey({ ...base, sourceReference: "x" })).toBe("provider:x");
    expect(bookingDedupeKey({ ...base, sourceReference: "x", calendarSourceId: "cs1" })).toBe("p1|x");
    expect(bookingDedupeKey({ ...base, sourceReference: "x", channel: "manual" })).toBe("p1|x");
  });
});
