import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { getAdjacency } from "@/lib/turnover";

// ---------------------------------------------------------------------------
// Komşu rezervasyon (erken giriş / geç çıkış verisi) — müsaitlik motorunun TEK TARİH KURALI.
//
// Aynı gün veritabanında yazan yola göre üç biçimde durur: köprü/elle giriş D 00:00Z, iCal tarih
// değeri D 12:00Z, iCal TZID'li değer gerçek an. `getAdjacency` ham anları karşılaştırıyordu:
// önceki misafir iCal'den "D 12:00Z" çıkıp bu misafir köprüden "D 00:00Z" girince aynı gün devri
// BULUNAMIYOR ve isteme "giriş öncesi daire boş, erken girişte devir baskısı yok" yazılıyordu —
// erken giriş sorusunda tam tersi bir veri (09-24 ölçümü, kodla doğrulandı).
// ---------------------------------------------------------------------------

const midnight = (d: string) => new Date(`${d}T00:00:00.000Z`);
const noon = (d: string) => new Date(`${d}T12:00:00.000Z`);

async function stay(propertyId: string, arrival: Date, departure: Date, status = "confirmed") {
  return prisma.reservation.create({ data: { propertyId, guestName: "Misafir", arrivalDate: arrival, departureDate: departure, status } });
}

describe("getAdjacency — takvim günü kuralı", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("🚨 karışık yazım: önceki çıkış iCal (D 12:00Z) + bu giriş köprü (D 00:00Z) → AYNI GÜN DEVİR", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const prev = await stay(propertyId, noon("2026-10-02"), noon("2026-10-05"));
    const adj = await getAdjacency(propertyId, midnight("2026-10-05"), midnight("2026-10-08"));
    expect(adj.previousDeparture).toEqual(prev.departureDate);
    expect(adj.previousSameDay).toBe(true);
  });

  it("🚨 TZID'li gerçek an: sonraki giriş İstanbul 01:30 (önceki gün 22:30Z) = bu çıkış günü → AYNI GÜN DEVİR", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const next = await stay(propertyId, new Date("2026-10-07T22:30:00Z"), noon("2026-10-10"));
    const adj = await getAdjacency(propertyId, midnight("2026-10-05"), midnight("2026-10-08"));
    expect(adj.nextArrival).toEqual(next.arrivalDate);
    expect(adj.nextSameDay).toBe(true);
  });

  it("arada boş gün varsa devir DEĞİL; en yakın komşu seçilir", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await stay(propertyId, midnight("2026-09-25"), midnight("2026-09-28"));
    const closest = await stay(propertyId, noon("2026-09-30"), noon("2026-10-04"));
    const next = await stay(propertyId, midnight("2026-10-10"), midnight("2026-10-12"));
    await stay(propertyId, midnight("2026-10-20"), midnight("2026-10-22"));
    const adj = await getAdjacency(propertyId, midnight("2026-10-05"), midnight("2026-10-08"));
    expect(adj).toEqual({ previousDeparture: closest.departureDate, previousSameDay: false, nextArrival: next.arrivalDate, nextSameDay: false });
  });

  it("en yakın komşu ANLA değil TAKVİM GÜNÜYLE seçilir (UTC+13 diliminde an sırası ile gün sırası ayrışır)", async () => {
    // Mutasyon turu (09-24): "ilk aday" seçimi İstanbul'da eşdeğerdi (00:00Z/12:00Z çapaları ile +3 dilimi
    // aynı sırayı verir); Auckland'da (NZDT, UTC+13) daha GEÇ an daha ERKEN güne düşebilir.
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.organization.update({ where: { id: orgId }, data: { timezone: "Pacific/Auckland" } });
    await stay(propertyId, noon("2026-09-30"), noon("2026-10-04")); // çıkış günü 10-04 (öğlen çapası)
    const sameDay = await stay(propertyId, noon("2026-09-30"), new Date("2026-10-04T11:30:00Z")); // Auckland 10-05 00:30
    const nextSame = await stay(propertyId, new Date("2026-10-08T12:00:00Z"), noon("2026-10-12")); // gün 10-08
    await stay(propertyId, new Date("2026-10-08T11:30:00Z"), noon("2026-10-12")); // Auckland 10-09 00:30 — daha ERKEN an, daha GEÇ gün
    const adj = await getAdjacency(propertyId, midnight("2026-10-05"), midnight("2026-10-08"));
    expect(adj).toEqual({ previousDeparture: sameDay.departureDate, previousSameDay: true, nextArrival: nextSame.arrivalDate, nextSameDay: true });
  });

  it("konaklamanın KENDİSİ komşu sayılmaz; iptal ve beklemedeki talep sayılmaz; başka mülk sayılmaz", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await stay(propertyId, midnight("2026-10-05"), midnight("2026-10-08")); // kendisi
    await stay(propertyId, noon("2026-10-02"), noon("2026-10-05"), "cancelled");
    await stay(propertyId, noon("2026-10-08"), noon("2026-10-09"), "pending");
    // Sıfır gecelik (bozuk) satır giriş gününde "çıkış" gibi görünür — devir sayılmaz.
    await stay(propertyId, noon("2026-10-05"), noon("2026-10-05"));
    const other = await prisma.property.create({ data: { organizationId: orgId, name: "Öteki" } });
    await stay(other.id, noon("2026-10-02"), noon("2026-10-05"));
    const adj = await getAdjacency(propertyId, midnight("2026-10-05"), midnight("2026-10-08"));
    expect(adj).toEqual({ previousDeparture: null, previousSameDay: false, nextArrival: null, nextSameDay: false });
  });
});
