// ---------------------------------------------------------------------------
// DOĞRULANMIŞ ERKEN GİRİŞ — OLGU YÜKLEYİCİ (09-24). Tek DB dokunuşu burası; karar `core.ts`te (saf). Her sorgu
// org kapsamlı (mülk `organizationId` ile doğrulanır). Yalnız OKUR.
//
//  · Tarih kuralı tek kaynak: müsaitlik motorunun `calendarDateOf` / `todayKey` (org saat dilimi).
//  · Önceki misafirin çıkışı: mülkün varsayılanı ile misafirin BİLDİRDİĞİ saatten hangisi daha GEÇSE (temkin —
//    erken çıkacağını söyleyen misafir gerçekte geç çıkabilir).
//  · Hazır: son çıkışa bağlı temizlik görevi "bitti" ve bunu yazan KAYDIN sunucu zamanı çıkış ANINDAN sonra, en az
//    5 dk önce (yanlışlıkla dokunma geri alınabilsin). Görev yoksa "bilinmiyor", bitmemişse "hazır değil".
//  · Aynı gün devir yoksa dün gece YALNIZ müsaitlik motoru taze kaynaklarla "boş" diyorsa boş sayılır.
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/db";
import { orgTimezone, zonedWallClockToUtc } from "@/lib/timezone";
import { addNights, calendarDateOf, describeNights, statusClassOf, todayKey } from "@/modules/availability/core";
import { loadAvailabilityInputs } from "@/modules/availability/load";
import { hhmmToMinutes, normalizeHhmm } from "@/lib/ai/semantic/stay-change";
import type { EarlyCheckinFacts, EarlyCheckinRule, ReadinessStatus } from "./core";
import { loadEarlyCheckinRule } from "./rules";

/** "Bitti" işareti bundan yeniyse sayılmaz (yanlışlıkla dokunma geri alınabilsin). */
export const READY_SETTLE_MS = 5 * 60_000;
const DAY_MS = 86_400_000;

/** İki saatten GEÇ olanı (biri geçersizse diğeri). */
export function laterTime(a: string | null | undefined, b: string | null | undefined): string | null {
  const x = normalizeHhmm(a);
  const y = normalizeHhmm(b);
  if (!x) return y;
  if (!y) return x;
  return (hhmmToMinutes(x) ?? 0) >= (hhmmToMinutes(y) ?? 0) ? x : y;
}

/** Takvim günü + duvar saati → an (org saat dilimi). Saat geçersizse `null`. */
export function wallClockMoment(dayKey: string, hhmm: string | null, timeZone: string): Date | null {
  const t = normalizeHhmm(hhmm);
  if (!t) return null;
  const [y, m, d] = dayKey.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  return zonedWallClockToUtc(y, m, d, h, mi, 0, timeZone);
}

/**
 * Saf hazırlık hükmü: görevler + çıkış anı + şimdi → hazır / hazır değil / bilinmiyor. `doneAt` = görevi "bitti"
 * yapan en son kaydın sunucu zamanı (yoksa `null`: zaman doğrulanamaz).
 */
export function readinessOf(
  tasks: readonly { status: string; doneAt: Date | null }[],
  checkoutAt: Date | null,
  now: Date,
): ReadinessStatus {
  if (tasks.length === 0 || !checkoutAt) return "unknown";
  const ready = tasks.some(
    (t) => t.status === "done" && t.doneAt !== null && t.doneAt >= checkoutAt && now.getTime() - t.doneAt.getTime() >= READY_SETTLE_MS,
  );
  if (ready) return "ready";
  // "Bitti" ama zamanı yazılmamış kayıt doğrulanamaz; açık görev ya da çıkıştan ÖNCEKİ / taze işaret = hazır değil.
  if (tasks.every((t) => t.status === "done" && t.doneAt === null)) return "unknown";
  return "not_ready";
}

/** Hazır hükmünü veren EN YENİ "bitti" işaretinin zamanı (`readinessOf` ile aynı şart); hazır değilse `null`. */
export function readyAtOf(
  tasks: readonly { status: string; doneAt: Date | null }[],
  checkoutAt: Date | null,
  now: Date,
): Date | null {
  if (!checkoutAt) return null;
  let latest: Date | null = null;
  for (const t of tasks) {
    if (t.status !== "done" || t.doneAt === null || t.doneAt < checkoutAt || now.getTime() - t.doneAt.getTime() < READY_SETTLE_MS) continue;
    if (!latest || t.doneAt > latest) latest = t.doneAt;
  }
  return latest;
}

export async function loadEarlyCheckinFacts(args: {
  organizationId: string;
  propertyId: string;
  reservationId: string | null;
  now: Date;
  requested: EarlyCheckinFacts["requested"];
  singleIntent: boolean;
}): Promise<{ facts: EarlyCheckinFacts; rule: EarlyCheckinRule | null; readyAt: Date | null } | null> {
  const property = await prisma.property.findFirst({
    where: { id: args.propertyId, organizationId: args.organizationId },
    select: { checkInTime: true, checkOutTime: true, organization: { select: { timezone: true } } },
  });
  if (!property) return null;
  const tz = orgTimezone(property.organization.timezone);
  const rule = await loadEarlyCheckinRule(args.organizationId, args.propertyId);
  const facts: EarlyCheckinFacts = {
    standardCheckIn: property.checkInTime,
    reservation: null,
    todayKey: todayKey(args.now, tz),
    previousSameDay: null,
    otherOverlaps: 0,
    readiness: "unknown",
    previousNightVerifiedVacant: false,
    requested: args.requested,
    singleIntent: args.singleIntent,
  };
  const own = args.reservationId
    ? await prisma.reservation.findFirst({
        where: { id: args.reservationId, propertyId: args.propertyId },
        select: { id: true, status: true, arrivalDate: true },
      })
    : null;
  if (!own) return { facts, rule, readyAt: null };
  const arrivalKey = calendarDateOf(own.arrivalDate, tz).key;
  facts.reservation = { status: own.status, arrivalKey };

  // Varış günü çevresindeki komşular (geniş pencere; günler KODDA tek tarih kuralıyla karşılaştırılır).
  const neighbours = await prisma.reservation.findMany({
    where: {
      propertyId: args.propertyId,
      id: { not: own.id },
      departureDate: { gte: new Date(own.arrivalDate.getTime() - 3 * DAY_MS) },
      arrivalDate: { lte: new Date(own.arrivalDate.getTime() + 2 * DAY_MS) },
    },
    select: { id: true, status: true, arrivalDate: true, departureDate: true, guestCheckoutTime: true },
  });
  const keyed = neighbours
    .filter((r) => statusClassOf(r.status) !== "ignored")
    .map((r) => ({ r, a: calendarDateOf(r.arrivalDate, tz).key, d: calendarDateOf(r.departureDate, tz).key }));
  const sameDay = keyed.filter((x) => x.d === arrivalKey && x.a < arrivalKey);
  const occupying = keyed.filter((x) => x.a <= arrivalKey && arrivalKey < x.d);
  // Aynı gün iki ayrılan = biri ötekiyle çakışmış (çift rezervasyon) → çakışma sayılır.
  facts.otherOverlaps = occupying.length + Math.max(0, sameDay.length - 1);
  const previous = sameDay
    .map((x) => ({ ...x, checkout: laterTime(x.r.guestCheckoutTime, property.checkOutTime) }))
    .sort((p, q) => (hhmmToMinutes(q.checkout) ?? 0) - (hhmmToMinutes(p.checkout) ?? 0))[0];
  if (previous) facts.previousSameDay = { checkoutTime: previous.checkout };

  // Hazırlık: referans çıkış = aynı gün ayrılan; yoksa varıştan önceki EN SON çıkış.
  let readyAt: Date | null = null;
  const reference = previous
    ? { id: previous.r.id, dayKey: previous.d, checkout: previous.checkout }
    : await (async () => {
        const last = await prisma.reservation.findFirst({
          where: { propertyId: args.propertyId, id: { not: own.id }, status: { not: "cancelled" }, departureDate: { lte: own.arrivalDate } },
          orderBy: { departureDate: "desc" },
          select: { id: true, departureDate: true, guestCheckoutTime: true },
        });
        return last
          ? { id: last.id, dayKey: calendarDateOf(last.departureDate, tz).key, checkout: laterTime(last.guestCheckoutTime, property.checkOutTime) }
          : null;
      })();
  if (reference) {
    const dayStart = wallClockMoment(reference.dayKey, "00:00", tz);
    const tasks = await prisma.task.findMany({
      where: {
        propertyId: args.propertyId,
        type: "cleaning",
        OR: [
          { reservationId: reference.id },
          ...(dayStart ? [{ reservationId: null, dueAt: { gte: dayStart, lt: new Date(dayStart.getTime() + DAY_MS) } }] : []),
        ],
      },
      select: { status: true, updates: { where: { status: "done" }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } },
    });
    const marks = tasks.map((t) => ({ status: t.status, doneAt: t.updates[0]?.createdAt ?? null }));
    const checkoutAt = wallClockMoment(reference.dayKey, reference.checkout, tz);
    facts.readiness = readinessOf(marks, checkoutAt, args.now);
    readyAt = facts.readiness === "ready" ? readyAtOf(marks, checkoutAt, args.now) : null;
  }

  if (!previous) {
    // Dün gece boş mu — YALNIZ motorun kanıtlı "boş" hükmü (taze kaynaklar). Köprü mülklerinde bugün "bilinmiyor".
    const range = { from: addNights(arrivalKey, -1), to: arrivalKey };
    const loaded = await loadAvailabilityInputs(args.organizationId, { propertyIds: [args.propertyId], range, now: args.now });
    const input = loaded?.inputs.get(args.propertyId);
    if (input) {
      const report = describeNights(input, range, { allowPast: true });
      facts.previousNightVerifiedVacant = report.ok && report.value.nights.length === 1 && report.value.nights[0].state === "free";
    }
  }
  return { facts, rule, readyAt };
}
