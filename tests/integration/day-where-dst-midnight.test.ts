import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { reservationDayRangeWhere, taskDueDayRangeWhere } from "@/lib/day-where";
import { calendarDateOf } from "@/modules/availability/core";

// ---------------------------------------------------------------------------
// U34 (Codex 10-07, 15c8663) — VERİTABANI: geceyarısı yaz saati geçişi olan dilimlerde gün aralığı sorgusu bellekteki takvim
// kuralıyla (`calendarDateOf`) AYNI kümeyi seçer. Eski gün başı Azor'da 29 Mart'ı 28 Mart 23:00'te açıyordu (28 Mart'ın son
// yarım saati "29 Mart" sayılıyordu); Amman'da 29 Ekim 2021'i İKİNCİ geceyarısında açıyordu (ilk saat dışarıda kalıyordu).
// ---------------------------------------------------------------------------

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

const CASES: { tz: string; day: string; values: string[] }[] = [
  {
    tz: "Atlantic/Azores",
    day: "2026-03-29",
    values: ["2026-03-28T12:00:00Z", "2026-03-29T00:00:00Z", "2026-03-29T00:30:00Z", "2026-03-29T00:59:59.999Z", "2026-03-29T01:00:00Z", "2026-03-29T12:00:00Z", "2026-03-29T23:30:00Z", "2026-03-30T00:30:00Z"],
  },
  {
    tz: "Asia/Amman",
    day: "2021-10-29",
    values: ["2021-10-28T12:00:00Z", "2021-10-28T20:59:59.999Z", "2021-10-28T21:00:00Z", "2021-10-28T21:30:00Z", "2021-10-28T22:30:00Z", "2021-10-29T00:00:00Z", "2021-10-29T12:00:00Z", "2021-10-29T21:30:00Z"],
  },
];

describe("U34 — gün aralığı sorgusu = bellekteki karar (geceyarısı geçişi)", () => {
  for (const c of CASES) {
    it(`🚨 ${c.tz} ${c.day}: rezervasyon ve görev kümeleri birebir`, async () => {
      const { propertyId } = await makeOrgWithProperty();
      for (const v of c.values) {
        const at = new Date(v);
        await prisma.reservation.create({ data: { propertyId, guestName: "Deneme", arrivalDate: at, departureDate: at, status: "confirmed", sourceReference: v } });
        await prisma.task.create({ data: { propertyId, type: "cleaning", title: v, dueAt: at } });
      }
      const range = { from: c.day, to: c.day };
      const want = c.values.filter((v) => calendarDateOf(new Date(v), c.tz).key === c.day).sort();
      expect(want.length).toBeGreaterThan(0);
      expect(want.length).toBeLessThan(c.values.length);
      const got = await prisma.reservation.findMany({ where: { AND: [{ propertyId }, reservationDayRangeWhere("arrivalDate", range, c.tz)] }, select: { sourceReference: true } });
      expect(got.map((r) => r.sourceReference).sort()).toEqual(want); // ⬅️ ARIZADA bir saatlik kayma
      const gotTasks = await prisma.task.findMany({ where: { AND: [{ propertyId }, taskDueDayRangeWhere(range, c.tz)] }, select: { title: true } });
      expect(gotTasks.map((t) => t.title).sort()).toEqual(want);
    });
  }
});
