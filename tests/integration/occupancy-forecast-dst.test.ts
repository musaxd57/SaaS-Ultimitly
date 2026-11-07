import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { getOccupancyForecast } from "@/lib/reports";

// ---------------------------------------------------------------------------
// DOLULUK TAHMİNİ — günler TAKVİMLE yürür, 24 saatle değil.
//
// getOccupancyForecast başlangıcı zonedDayRange ile doğru alıyordu ama günleri
// düz DAY_MS (24h) ekleyerek yürütüyordu. DST'li bir dilimde gün 23 veya 25
// saattir:
//
//   • SONBAHAR (Berlin, 25 Eki 2026 — 25 saatlik gün): 24h adımı geri-alınan
//     saatin içine düşer → İKİ ardışık adım AYNI yerel tarihe çıkar, listede
//     "2026-10-25" iki kez görünür ve bir gün tamamen kaybolur.
//   • İLKBAHAR (29 Mar 2026 — 23 saatlik gün): tarihler benzersiz kalır ama
//     adım anları yerel geceyarısından 1 saat kayar (pencere kayması).
//
// Düzeltme addZonedDays: her adım o DİLİMİN bir sonraki yerel geceyarısı.
// İstanbul 2016'dan beri DST uygulamıyor (sabit +03) → addZonedDays orada
// birebir +24h'a eşittir; .com çıktısı değişmez ve bunu da pinliyoruz.
// ---------------------------------------------------------------------------

async function seedOrg(timezone: string): Promise<string> {
  const org = await prisma.organization.create({ data: { name: `Org ${timezone}`, timezone } });
  await prisma.property.create({ data: { organizationId: org.id, name: "Daire" } });
  return org.id;
}

/** "YYYY-MM-DD" listesinin benzersiz VE ardışık takvim günleri olduğunu doğrular. */
function expectConsecutive(dates: string[], first: string, count: number) {
  expect(dates).toHaveLength(count);
  expect(new Set(dates).size, `tekrar eden gün var: ${dates.join(",")}`).toBe(count);
  expect(dates[0]).toBe(first);
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(`${dates[i - 1]}T00:00:00Z`).getTime();
    const cur = new Date(`${dates[i]}T00:00:00Z`).getTime();
    expect(cur - prev, `${dates[i - 1]} → ${dates[i]} ardışık değil`).toBe(24 * 60 * 60 * 1000);
  }
}

describe("getOccupancyForecast — DST geçişlerinde gün listesi", () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("SONBAHAR (Berlin, 25 saatlik gün): tarihler benzersiz ve ardışık — eski kod 25 Eki'yi İKİLİYORDU", async () => {
    const orgId = await seedOrg("Europe/Berlin");
    vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
    const f = await getOccupancyForecast(orgId, 5);
    expectConsecutive(
      f.days.map((d) => d.date),
      "2026-10-23",
      5,
    );
    expect(f.days.map((d) => d.date)).toEqual([
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
    ]);
  });

  it("İLKBAHAR (Berlin, 23 saatlik gün): tarihler benzersiz ve ardışık", async () => {
    const orgId = await seedOrg("Europe/Berlin");
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const f = await getOccupancyForecast(orgId, 5);
    expectConsecutive(
      f.days.map((d) => d.date),
      "2026-03-26",
      5,
    );
  });

  it(".com PARİTESİ (İstanbul, DST yok): 30 ardışık gün, bugünden başlar", async () => {
    const orgId = await seedOrg("Europe/Istanbul");
    // İstanbul 28 Tem 00:30 — gün sınırının en hassas anı.
    vi.setSystemTime(new Date("2026-07-27T21:30:00.000Z"));
    const f = await getOccupancyForecast(orgId, 30);
    expectConsecutive(
      f.days.map((d) => d.date),
      "2026-07-28",
      30,
    );
  });

  it("SONBAHAR geçişinde doluluk SAYIMI da güne doğru oturur", async () => {
    // 25 Eki gecesi (24→25 arası değil, 25→26 arası) kalan bir misafir yalnız
    // 25'inde sayılmalı. Eski kodda 25 Eki'nin iki kopyası pencereleri kaydırıp
    // sayımı da bulaştırıyordu.
    const orgId = await seedOrg("Europe/Berlin");
    const prop = await prisma.property.findFirstOrThrow({ where: { organizationId: orgId } });
    await prisma.reservation.create({
      data: {
        propertyId: prop.id,
        guestName: "DST Misafiri",
        // Berlin 25 Eki 00:00 CEST = 24 Eki 22:00Z → 26 Eki 00:00 CET = 25 Eki 23:00Z
        arrivalDate: new Date("2026-10-24T22:00:00.000Z"),
        departureDate: new Date("2026-10-25T23:00:00.000Z"),
      },
    });
    vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
    const f = await getOccupancyForecast(orgId, 5);
    const byDate = Object.fromEntries(f.days.map((d) => [d.date, d.confirmedCount]));
    expect(byDate["2026-10-25"]).toBe(1);
    expect(byDate["2026-10-24"]).toBe(0);
    expect(byDate["2026-10-26"]).toBe(0);
  });
});
