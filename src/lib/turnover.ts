import "server-only";

import { prisma } from "@/lib/db";
import { orgTimezone } from "@/lib/timezone";
import type { AdjacencyContext } from "@/lib/ai/types";
import { calendarDateOf } from "@/modules/availability/core";

// ---------------------------------------------------------------------------
// Turnover context — neighbouring bookings for the SAME property.
//
// For early-checkin / late-checkout questions, the model otherwise has no idea
// whether another guest is leaving the morning of arrival or arriving the day of
// departure, so the prompt always falls back to "ask the operator". Feeding it
// the adjacent booking dates lets it reason about the cleaning window with data.
// Read-only; confirmed/completed bookings only.
//
// 🚨 TAKVİM GÜNÜ KURALI (09-24): aynı gün veritabanında yazan yola göre üç biçimde durur
// (köprü/elle giriş D 00:00Z · iCal tarih değeri D 12:00Z · iCal TZID'li değer gerçek an).
// Eskiden ham anlar karşılaştırılıyordu: önceki çıkış "D 12:00Z", bu giriş "D 00:00Z" olunca
// aynı gün devri BULUNAMIYOR ve isteme "giriş öncesi daire boş" yazılıyordu. Artık karşılaştırma
// müsaitlik motorunun TEK kuralıyla (`calendarDateOf`, mülkün diliminde) ve "aynı gün" kararı
// KODDA verilir (`previousSameDay`/`nextSameDay`) — istem UTC gününe bakarak yeniden tahmin etmez.
// ---------------------------------------------------------------------------

/** Farklı yazım biçimleri arasındaki en büyük kayma ±1 gün; 2 gün pay her biçimi kapsar. */
const WIDEN_MS = 2 * 86_400_000;
const CANDIDATES = 10;

export async function getAdjacency(
  propertyId: string,
  arrivalDate: Date,
  departureDate: Date,
): Promise<Required<AdjacencyContext>> {
  const active = { in: ["confirmed", "completed"] };
  const [property, prevRows, nextRows] = await Promise.all([
    prisma.property.findUnique({ where: { id: propertyId }, select: { organization: { select: { timezone: true } } } }),
    // Bu konaklama başlamadan (en geç aynı gün) çıkan adaylar — takvim günüyle süzülür.
    prisma.reservation.findMany({
      where: { propertyId, status: active, departureDate: { lte: new Date(arrivalDate.getTime() + WIDEN_MS) } },
      orderBy: { departureDate: "desc" },
      take: CANDIDATES,
      select: { arrivalDate: true, departureDate: true },
    }),
    // Bu konaklama bittikten sonra (en erken aynı gün) giren adaylar.
    prisma.reservation.findMany({
      where: { propertyId, status: active, arrivalDate: { gte: new Date(departureDate.getTime() - WIDEN_MS) } },
      orderBy: { arrivalDate: "asc" },
      take: CANDIDATES,
      select: { arrivalDate: true, departureDate: true },
    }),
  ]);
  const tz = orgTimezone(property?.organization?.timezone);
  const day = (d: Date) => calendarDateOf(d, tz).key;
  const arrKey = day(arrivalDate);
  const depKey = day(departureDate);
  // Geçerli (en az bir gecelik) konaklamalar; konaklamanın KENDİSİ iki koşulu da sağlayamaz
  // (kendi çıkışı kendi girişinden sonra, kendi girişi kendi çıkışından önce).
  const valid = (r: { arrivalDate: Date; departureDate: Date }) => day(r.arrivalDate) < day(r.departureDate);

  let prev: { at: Date; key: string } | null = null;
  for (const r of prevRows) {
    const k = day(r.departureDate);
    if (!valid(r) || k > arrKey) continue;
    if (!prev || k > prev.key || (k === prev.key && r.departureDate > prev.at)) prev = { at: r.departureDate, key: k };
  }
  let next: { at: Date; key: string } | null = null;
  for (const r of nextRows) {
    const k = day(r.arrivalDate);
    if (!valid(r) || k < depKey) continue;
    if (!next || k < next.key || (k === next.key && r.arrivalDate < next.at)) next = { at: r.arrivalDate, key: k };
  }

  return {
    previousDeparture: prev?.at ?? null,
    previousSameDay: prev?.key === arrKey,
    nextArrival: next?.at ?? null,
    nextSameDay: next?.key === depKey,
  };
}
