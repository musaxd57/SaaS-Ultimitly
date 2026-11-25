import "server-only";
import { prisma } from "@/lib/db";
import { reservationDayRangeWhere, taskDueDayRangeWhere } from "@/lib/day-where";
import { calendarDateOf } from "@/modules/availability/core";
import { normalizeHhmm } from "@/lib/ai/semantic/stay-change";
import { DECIDED_STATUSES } from "@/lib/readiness-list/load";
import { cleaningDayOrderGroups, type CleaningJob, type DayOrderGroup, type EarlyMark } from "./day-order";

// ---------------------------------------------------------------------------
// Temizlik gün sırası önerisinin yükleyicisi (plan madde 10-A; kural `./day-order.ts`). Salt okuma, işletme kapsamlı, yalnız Girişler
// (yönetici) sayfası çağırır. Üç sorgu: görevler · aynı günün girişleri · o girişlerin erken giriş kayıtları. Misafir adı OKUNMAZ.
// ---------------------------------------------------------------------------

/** Pencerede bundan fazla açık temizlik varsa öneri gösterilmez (eksik listeyle yanlış sıra verilmesin). */
export const DAY_ORDER_TASK_CAP = 500;

export interface CleaningDayOrders {
  groups: DayOrderGroup[];
  /** Tavan aşıldı → öneri yok (sessiz kesme yok; sayfa söyler). */
  truncated: boolean;
}

export async function loadCleaningDayOrders(
  organizationId: string,
  window: { fromKey: string; toKey: string; timeZone: string },
): Promise<CleaningDayOrders> {
  const { fromKey, toKey, timeZone: tz } = window;
  const tasks = await prisma.task.findMany({
    where: {
      property: { organizationId },
      type: "cleaning",
      status: { not: "done" },
      AND: [taskDueDayRangeWhere({ from: fromKey, to: toKey }, tz)],
    },
    select: {
      id: true,
      propertyId: true,
      dueAt: true,
      assignedToId: true,
      assignedTo: { select: { name: true } },
      property: { select: { name: true, checkInTime: true } },
    },
    orderBy: { id: "asc" },
    take: DAY_ORDER_TASK_CAP + 1,
  });
  if (tasks.length > DAY_ORDER_TASK_CAP) return { groups: [], truncated: true };
  if (tasks.length < 2) return { groups: [], truncated: false };

  const propertyIds = [...new Set(tasks.map((t) => t.propertyId))];
  const arrivals = await prisma.reservation.findMany({
    where: {
      propertyId: { in: propertyIds },
      property: { organizationId },
      status: { in: ["confirmed", "completed"] },
      AND: [reservationDayRangeWhere("arrivalDate", { from: fromKey, to: toKey }, tz)],
    },
    select: { id: true, propertyId: true, arrivalDate: true },
  });
  const decisions = arrivals.length
    ? await prisma.decisionRequest.findMany({
        where: {
          organizationId,
          kind: "early_checkin",
          reservationId: { in: arrivals.map((a) => a.id) },
          OR: [{ status: { in: DECIDED_STATUSES }, decidedTime: { not: null } }, { status: "pending" }],
        },
        select: { reservationId: true, status: true, requestedTime: true, decidedTime: true },
      })
    : [];

  // Rezervasyon başına erken giriş: onaylı karar (en erken onaylı saat) > bekleyen istek (en erken istenen saat, yoksa saatsiz).
  const earlyOf = new Map<string, { mark: Exclude<EarlyMark, null>; time: string | null }>();
  for (const d of decisions) {
    if (!d.reservationId) continue;
    const approved = d.status !== "pending";
    const time = normalizeHhmm(approved ? d.decidedTime : d.requestedTime);
    const prev = earlyOf.get(d.reservationId);
    const better =
      !prev ||
      (approved && prev.mark === "requested") ||
      ((approved ? "approved" : "requested") === prev.mark && time !== null && (prev.time === null || time < prev.time));
    if (better) earlyOf.set(d.reservationId, { mark: approved ? "approved" : "requested", time });
  }

  const propertyDefault = new Map(tasks.map((t) => [t.propertyId, normalizeHhmm(t.property.checkInTime)]));
  // (daire, gün) → o günün girişi; aynı gün birden çok satır (kopya) → erken giriş taşıyan, sonra en erken saat.
  const arrivalOf = new Map<string, NonNullable<CleaningJob["arrival"]>>();
  for (const a of arrivals) {
    const key = `${a.propertyId}\u0000${calendarDateOf(a.arrivalDate, tz).key}`;
    const early = earlyOf.get(a.id);
    const candidate = {
      checkInTime: early?.time ?? propertyDefault.get(a.propertyId) ?? null,
      early: early?.mark ?? null,
    };
    const prev = arrivalOf.get(key);
    const candTime = candidate.checkInTime ?? "99:99";
    const prevTime = prev?.checkInTime ?? "99:99";
    if (!prev || (candidate.early && !prev.early) || (Boolean(candidate.early) === Boolean(prev.early) && candTime < prevTime)) {
      arrivalOf.set(key, candidate);
    }
  }

  const jobs: CleaningJob[] = tasks.flatMap((t) => {
    if (!t.dueAt) return [];
    const dayKey = calendarDateOf(t.dueAt, tz).key;
    return [
      {
        taskId: t.id,
        propertyName: t.property.name,
        dayKey,
        assigneeId: t.assignedToId,
        assigneeName: t.assignedToId ? (t.assignedTo?.name ?? null) : null,
        arrival: arrivalOf.get(`${t.propertyId}\u0000${dayKey}`) ?? null,
      },
    ];
  });
  return { groups: cleaningDayOrderGroups(jobs), truncated: false };
}
