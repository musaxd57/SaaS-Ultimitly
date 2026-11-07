import type { Prisma } from "@prisma/client";
import { addNights, todayKey, type NightKey } from "@/modules/availability/core";
import { zonedDateStart } from "@/lib/timezone";

// ---------------------------------------------------------------------------
// TEK TARİH KURALININ SORGU İKİZİ (09-26, ev sahibi yüzeyleri). Bellekteki karar `calendarDateOf` (`@/modules/availability/
// core`): yalnız-tarih çapası (D 00:00Z / D 12:00Z) → UTC tarihi · gerçek an → org diliminde tarih. Sayım ve liste gibi
// sonradan SÜZÜLMEYEN sorgular burada KESİN where kurar (misafir tarafının `onOrAfterTodayWhere`i bir üst kümedir ve sonucu
// bellekte süzer). Eski ham `tarih >= org gün başı` kıyası İstanbul'da doğruydu; New York'ta bugünün 00:00Z değerini "dün"
// (ve yarınınkini "bugün"), Auckland'da dünün 12:00Z değerini "bugün" sayıyordu.
//
// Takvim günü aralığı [from, to] (dahil; biri null = o yönde sınırsız) =
//   kenar günlerin çapaları  ∨  (yerel pencere [from gün başı, to gün sonu] ∧ komşu günlerin çapaları DEĞİL).
// Gerekçe (ofset −12..+14 sa): İÇ günlerin çapaları her zaman yerel pencerenin içindedir; pencerenin DIŞINA düşebilen
// yalnız kenar günlerin (from / to) çapalarıdır; pencereye SIZABİLEN yalnız komşu günlerin (from−1 / to+1) çapalarıdır
// (New York'ta to+1'in 00:00Z'si, Auckland'da from−1'in 12:00Z'si). Gerçek anlar yerel pencereyle doğru ayrılır.
// Bellekteki kararla eşdeğerlik her dilimde VERİTABANI üzerinden pinli (`tests/integration/day-where-exact.test.ts`).
// ---------------------------------------------------------------------------

/** Org takviminde gün aralığı (dahil); `null` = o yönde sınırsız. */
export type DayRange = { from: NightKey | null; to: NightKey | null };

function anchorsOf(key: NightKey): Date[] {
  return [new Date(`${key}T00:00:00.000Z`), new Date(`${key}T12:00:00.000Z`)];
}

function localDayStart(key: NightKey, tz: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return zonedDateStart(y, m, d, tz);
}

type Parts = { include: Date[]; exclude: Date[]; window: { gte?: Date; lte?: Date } };

/** `null` = boş aralık (from > to) → hiçbir satır. */
function dayRangeParts(range: DayRange, tz: string): Parts | null {
  const { from, to } = range;
  if (from !== null && to !== null && from > to) return null;
  const parts: Parts = { include: [], exclude: [], window: {} };
  if (from !== null) {
    parts.include.push(...anchorsOf(from));
    parts.exclude.push(...anchorsOf(addNights(from, -1)));
    parts.window.gte = localDayStart(from, tz);
  }
  if (to !== null) {
    parts.include.push(...anchorsOf(to));
    parts.exclude.push(...anchorsOf(addNights(to, 1)));
    parts.window.lte = new Date(localDayStart(addNights(to, 1), tz).getTime() - 1);
  }
  return parts;
}

const NOTHING = { id: { in: [] as string[] } };

/** Rezervasyon tarihi org takviminde [from, to] aralığında — kesin (`calendarDateOf` ile aynı karar). */
export function reservationDayRangeWhere(
  field: "arrivalDate" | "departureDate",
  range: DayRange,
  tz: string,
): Prisma.ReservationWhereInput {
  if (range.from === null && range.to === null) return {};
  const p = dayRangeParts(range, tz);
  if (p === null) return NOTHING;
  return { OR: [{ [field]: { in: p.include } }, { AND: [{ [field]: p.window }, { NOT: { [field]: { in: p.exclude } } }] }] };
}

/** Görev vadesi org takviminde [from, to] aralığında — kesin; vadesiz görev hiçbir aralığa girmez (sınırsız aralığa da). */
export function taskDueDayRangeWhere(range: DayRange, tz: string): Prisma.TaskWhereInput {
  if (range.from === null && range.to === null) return { dueAt: { not: null } };
  const p = dayRangeParts(range, tz);
  if (p === null) return NOTHING;
  return { OR: [{ dueAt: { in: p.include } }, { AND: [{ dueAt: p.window }, { NOT: { dueAt: { in: p.exclude } } }] }] };
}

/** Kısayollar: org gününe göre BUGÜN · BUGÜN ya da SONRASI. */
export function todayRange(now: Date, tz: string): DayRange {
  const today = todayKey(now, tz);
  return { from: today, to: today };
}

export function onOrAfterTodayRange(now: Date, tz: string): DayRange {
  return { from: todayKey(now, tz), to: null };
}
