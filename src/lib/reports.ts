import "server-only";
import { startOfMonth, endOfMonth } from "date-fns";
import { prisma } from "@/lib/db";
import { zonedDayRange } from "@/lib/automation";

// Reporting day/occupancy math is anchored to the host's Istanbul calendar
// (UTC+3, no DST) — Railway runs UTC and Hospitable stores arrivalDate at
// Istanbul-midnight-UTC, so bucketing by the server's UTC day shifts month-edge
// nights by a day. istDayKey returns the Istanbul "YYYY-MM-DD" of an instant;
// zonedDayRange maps an Istanbul calendar day to its exact UTC boundaries.
const REPORT_TZ = "Europe/Istanbul";
const DAY_MS = 24 * 60 * 60 * 1000;
const istDayKey = (d: Date): string => d.toLocaleDateString("en-CA", { timeZone: REPORT_TZ });

export interface OpsStats {
  arrivalsToday: number;
  departuresToday: number;
  openConversations: number;
  problemConversations: number;
  urgentTasks: number;
  openTasks: number;
  totalProperties: number;
  occupiedToday: number;
  occupancyRate: number; // 0..100
}

const propertyScope = (orgId: string) => ({ property: { organizationId: orgId } });

export async function getOpsStats(orgId: string): Promise<OpsStats> {
  const now = new Date();
  // Bucket "today" by the host's local calendar day (org timezone), not the
  // server's UTC day, and only count active bookings once per reservation so
  // the stat cards match the dashboard lists.
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { timezone: true },
  });
  const { start: dayStart, end: dayEnd } = zonedDayRange(now, org?.timezone ?? "Europe/Istanbul");
  const activeStatus = { in: ["confirmed", "completed"] };

  const [
    arrivalRows,
    departureRows,
    openConversations,
    problemConversations,
    urgentTasks,
    openTasks,
    totalProperties,
    occupiedRows,
  ] = await Promise.all([
    prisma.reservation.findMany({
      where: {
        ...propertyScope(orgId),
        status: activeStatus,
        arrivalDate: { gte: dayStart, lte: dayEnd },
      },
      select: { sourceReference: true, id: true },
    }),
    prisma.reservation.findMany({
      where: {
        ...propertyScope(orgId),
        status: activeStatus,
        departureDate: { gte: dayStart, lte: dayEnd },
      },
      select: { sourceReference: true, id: true },
    }),
    prisma.conversation.count({
      where: { ...propertyScope(orgId), status: { in: ["new", "waiting"] } },
    }),
    prisma.conversation.count({
      where: { ...propertyScope(orgId), status: "problem" },
    }),
    prisma.task.count({
      where: { ...propertyScope(orgId), priority: "urgent", status: { not: "done" } },
    }),
    prisma.task.count({
      where: { ...propertyScope(orgId), status: { not: "done" } },
    }),
    prisma.property.count({ where: { organizationId: orgId } }),
    prisma.reservation.findMany({
      where: {
        ...propertyScope(orgId),
        status: { in: ["confirmed", "completed"] },
        arrivalDate: { lte: dayEnd },
        departureDate: { gte: dayStart },
      },
      select: { propertyId: true },
      distinct: ["propertyId"], // DISTINCT flats, not reservations
    }),
  ]);

  // On a turnover day a single flat has both a check-out and a check-in; counting
  // reservations would push occupancy past 100%, so count DISTINCT properties.
  const occupiedToday = occupiedRows.length;
  const occupancyRate =
    totalProperties > 0 ? Math.min(100, Math.round((occupiedToday / totalProperties) * 100)) : 0;

  // Count distinct bookings: collapse duplicate rows that share a sourceReference
  // (the same Hospitable booking can appear twice), but count each manual/iCal
  // booking (null sourceReference) individually — Prisma `distinct` over a
  // nullable column wrongly merges ALL nulls into one (undercount).
  const countDistinctBookings = (rows: { sourceReference: string | null }[]): number => {
    const seen = new Set<string>();
    let n = 0;
    for (const r of rows) {
      if (r.sourceReference == null) n++;
      else if (!seen.has(r.sourceReference)) {
        seen.add(r.sourceReference);
        n++;
      }
    }
    return n;
  };

  return {
    arrivalsToday: countDistinctBookings(arrivalRows),
    departuresToday: countDistinctBookings(departureRows),
    openConversations,
    problemConversations,
    urgentTasks,
    openTasks,
    totalProperties,
    occupiedToday,
    occupancyRate,
  };
}

export interface MonthlyReport {
  monthLabel: string;
  reservationsCount: number;
  revenueByCurrency: { currency: string; total: number }[];
  completedTasks: number;
  totalTasks: number;
  taskCompletionRate: number;
  messagesCount: number;
}

export async function getMonthlyReport(orgId: string): Promise<MonthlyReport> {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  const [reservations, completedTasks, totalTasks, messagesCount] = await Promise.all([
    prisma.reservation.findMany({
      // Exclude cancelled/pending stays so the monthly count and revenue match
      // every other surface (dashboard, occupancy, calendar) — a cancellation
      // must not inflate the reported reservations or income.
      where: {
        ...propertyScope(orgId),
        status: { in: ["confirmed", "completed"] },
        arrivalDate: { gte: monthStart, lte: monthEnd },
      },
      select: { totalAmount: true, currency: true, sourceReference: true },
    }),
    prisma.task.count({
      where: { ...propertyScope(orgId), status: "done", updatedAt: { gte: monthStart, lte: monthEnd } },
    }),
    prisma.task.count({
      where: { ...propertyScope(orgId), createdAt: { gte: monthStart, lte: monthEnd } },
    }),
    prisma.message.count({
      where: {
        conversation: { property: { organizationId: orgId } },
        createdAt: { gte: monthStart, lte: monthEnd },
      },
    }),
  ]);

  // Collapse duplicate Hospitable rows that share a sourceReference (one booking
  // can appear twice), but count each manual/iCal booking (null sourceReference)
  // individually — mirrors getOpsStats so neither the count nor the revenue
  // double-counts a single booking.
  const seenRefs = new Set<string>();
  const distinctReservations = reservations.filter((r) => {
    if (r.sourceReference == null) return true;
    if (seenRefs.has(r.sourceReference)) return false;
    seenRefs.add(r.sourceReference);
    return true;
  });

  const revenueMap = new Map<string, number>();
  for (const r of distinctReservations) {
    if (r.totalAmount) {
      revenueMap.set(r.currency, (revenueMap.get(r.currency) ?? 0) + r.totalAmount);
    }
  }

  return {
    monthLabel: now.toLocaleDateString("tr-TR", { month: "long", year: "numeric" }),
    reservationsCount: distinctReservations.length,
    revenueByCurrency: Array.from(revenueMap, ([currency, total]) => ({ currency, total })),
    completedTasks,
    totalTasks,
    taskCompletionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
    messagesCount,
  };
}

// ---------------------------------------------------------------------------
// Occupancy by Property
// ---------------------------------------------------------------------------

export interface PropertyOccupancy {
  propertyId: string;
  propertyName: string;
  thisMonthRate: number; // 0..100, "to date" (1st → today, Istanbul)
  delta: number; // +/- vs last month over the SAME elapsed-day window
}

export async function getOccupancyByProperty(orgId: string): Promise<PropertyOccupancy[]> {
  // Anchor every month/day boundary to the host's Istanbul calendar (not the
  // server's UTC day). zonedDayRange maps an Istanbul calendar day to its exact
  // UTC [midnight, 23:59:59.999] instant, so a stay stored at Istanbul-midnight-
  // UTC lands on the correct night instead of shifting a day at the month edge.
  const istKey = istDayKey(new Date()); // "YYYY-MM-DD" — today in Istanbul
  const [iy, im, todayDayOfMonth] = istKey.split("-").map(Number);

  const thisMonthStart = zonedDayRange(new Date(Date.UTC(iy, im - 1, 1)), REPORT_TZ).start;
  const thisMonthEnd = zonedDayRange(new Date(Date.UTC(iy, im, 0)), REPORT_TZ).end;
  const lastMonthStart = zonedDayRange(new Date(Date.UTC(iy, im - 2, 1)), REPORT_TZ).start;

  const properties = await prisma.property.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true },
  });

  // "Occupancy to date": the current month must be measured against the nights
  // ELAPSED so far (1st → today), not the whole month — otherwise a unit booked
  // solid through the 18th reads ~55% mid-month.
  //
  // Cut both windows off at the same day-of-month so the delta is like-for-like
  // (this-month-to-date vs last-month-over-the-same-days). countOccupiedDays
  // counts each Istanbul day cur with rangeStart <= cur < rangeEnd, so an
  // exclusive end at "Istanbul-midnight of day N" yields exactly days 1..N-1.
  const thisMonthCutoff = zonedDayRange(new Date(Date.UTC(iy, im - 1, todayDayOfMonth)), REPORT_TZ).start;
  const daysInLastMonth = new Date(Date.UTC(iy, im - 1, 0)).getUTCDate();
  // Clamp the comparison window to last month's length (e.g. today=31, last
  // month had 30 days → compare the full 30 elapsed nights of last month). The
  // cutoff is EXCLUSIVE (countOccupiedDays counts days 1..cutoff-1), so the cap
  // is daysInLastMonth + 1 — capping at daysInLastMonth would count only 1..29
  // and silently drop last month's final night from the delta baseline.
  const lastMonthCutoffDay = Math.min(todayDayOfMonth, daysInLastMonth + 1);
  const lastMonthCutoff = zonedDayRange(new Date(Date.UTC(iy, im - 2, lastMonthCutoffDay)), REPORT_TZ).start;

  // Denominators = elapsed nights in each window (days 1..cutoff-1). max(1, …)
  // guards day-1 of the month / empty windows from a divide-by-zero.
  const elapsedNightsThis = Math.max(1, todayDayOfMonth - 1);
  const elapsedNightsLast = Math.max(1, lastMonthCutoffDay - 1);

  // ONE query covering both months across ALL properties (was 2 queries per
  // property → an N+1). countOccupiedDays clamps each reservation to the target
  // range, so feeding it the whole union-window set yields the same per-month
  // counts as the old per-property queries.
  const allRes = await prisma.reservation.findMany({
    where: {
      property: { organizationId: orgId },
      status: { in: ["confirmed", "completed"] },
      arrivalDate: { lt: thisMonthEnd },
      departureDate: { gt: lastMonthStart },
    },
    select: { propertyId: true, arrivalDate: true, departureDate: true },
  });

  const byProperty = new Map<string, { arrivalDate: Date; departureDate: Date }[]>();
  for (const r of allRes) {
    const list = byProperty.get(r.propertyId);
    if (list) list.push(r);
    else byProperty.set(r.propertyId, [r]);
  }

  // rangeStart/rangeEnd are UTC instants marking Istanbul-day boundaries. Walk
  // the stay in Istanbul calendar days (24h steps — Istanbul has no DST) and
  // collect each distinct Istanbul day-key inside the window; departure day is
  // exclusive (checkout is not an occupied night).
  function countOccupiedDays(
    reservations: { arrivalDate: Date; departureDate: Date }[],
    rangeStart: Date,
    rangeEnd: Date,
  ): number {
    const occupied = new Set<string>();
    for (const r of reservations) {
      const start = r.arrivalDate > rangeStart ? r.arrivalDate : rangeStart;
      const end = r.departureDate < rangeEnd ? r.departureDate : rangeEnd;
      let cur = zonedDayRange(start, REPORT_TZ).start; // Istanbul-midnight of start's day
      while (cur < end) {
        occupied.add(istDayKey(cur));
        cur = new Date(cur.getTime() + DAY_MS);
      }
    }
    return occupied.size;
  }

  const clamp = (n: number) => Math.min(100, Math.max(0, n));

  return properties.map((p) => {
    const res = byProperty.get(p.id) ?? [];
    // Both windows stop at their respective cutoff so we compare like-for-like.
    const thisOccupied = countOccupiedDays(res, thisMonthStart, thisMonthCutoff);
    const lastOccupied = countOccupiedDays(res, lastMonthStart, lastMonthCutoff);
    const thisRate = clamp(Math.round((thisOccupied / elapsedNightsThis) * 100));
    const lastRate = clamp(Math.round((lastOccupied / elapsedNightsLast) * 100));
    return {
      propertyId: p.id,
      propertyName: p.name,
      thisMonthRate: thisRate,
      delta: thisRate - lastRate,
    };
  });
}

// ---------------------------------------------------------------------------
// Top Topics
// ---------------------------------------------------------------------------

export interface TopicCount {
  intent: string;
  count: number;
}

export async function getTopTopics(orgId: string, limit = 5): Promise<TopicCount[]> {
  const raw = await prisma.message.groupBy({
    by: ["aiIntent"],
    where: {
      conversation: { property: { organizationId: orgId } },
      aiIntent: { not: null },
    },
    _count: { aiIntent: true },
    orderBy: { _count: { aiIntent: "desc" } },
    take: limit,
  });

  return raw
    .filter((r) => r.aiIntent !== null)
    .map((r) => ({
      intent: r.aiIntent as string,
      count: r._count.aiIntent,
    }));
}

// ---------------------------------------------------------------------------
// Response Time Stats
// ---------------------------------------------------------------------------

export interface ResponseTimeStats {
  avgMinutes: number | null;
  conversationsAnalyzed: number;
}

export async function getResponseTimeStats(orgId: string): Promise<ResponseTimeStats> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Fetch conversations with messages from the last 30 days
  const conversations = await prisma.conversation.findMany({
    where: {
      property: { organizationId: orgId },
      createdAt: { gte: thirtyDaysAgo },
    },
    select: { id: true },
  });

  if (conversations.length === 0) {
    return { avgMinutes: null, conversationsAnalyzed: 0 };
  }

  const conversationIds = conversations.map((c) => c.id);

  // One query for ALL messages (was N+1: a findMany per conversation). The
  // @@index([conversationId, createdAt]) keeps this fast; a global createdAt-asc
  // order also yields per-conversation ascending order once grouped.
  const messages = await prisma.message.findMany({
    where: { conversationId: { in: conversationIds } },
    select: { conversationId: true, direction: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const byConversation = new Map<string, { direction: string; createdAt: Date }[]>();
  for (const m of messages) {
    const arr = byConversation.get(m.conversationId);
    if (arr) arr.push(m);
    else byConversation.set(m.conversationId, [m]);
  }

  // For each conversation, find first inbound and first outbound after it
  let totalMinutes = 0;
  let count = 0;

  for (const msgs of byConversation.values()) {
    const firstInbound = msgs.find((m) => m.direction === "inbound");
    if (!firstInbound) continue;

    const firstOutbound = msgs.find(
      (m) => m.direction === "outbound" && m.createdAt > firstInbound.createdAt,
    );
    if (!firstOutbound) continue;

    const diffMs = firstOutbound.createdAt.getTime() - firstInbound.createdAt.getTime();
    totalMinutes += diffMs / (1000 * 60);
    count++;
  }

  return {
    avgMinutes: count > 0 ? Math.round(totalMinutes / count) : null,
    conversationsAnalyzed: count,
  };
}

// ---------------------------------------------------------------------------
// Occupancy Forecast
// ---------------------------------------------------------------------------

export interface DayForecast {
  date: string; // YYYY-MM-DD
  confirmedCount: number;
  totalProperties: number;
  rate: number; // 0..100
}

export interface OccupancyForecast {
  days: DayForecast[];
  avgRate: number;
  peakDay: DayForecast | null;
}

export async function getOccupancyForecast(
  orgId: string,
  daysAhead = 30,
): Promise<OccupancyForecast> {
  // Istanbul calendar days (UTC+3, no DST): "today" is the Istanbul-midnight UTC
  // instant and each day steps 24h, so the overlap test buckets Hospitable stays
  // (stored at Istanbul-midnight-UTC) on the correct night, not one day early.
  const today = zonedDayRange(new Date(), REPORT_TZ).start;
  const forecastEnd = new Date(today.getTime() + daysAhead * DAY_MS);

  const [totalProperties, reservations] = await Promise.all([
    prisma.property.count({ where: { organizationId: orgId } }),
    prisma.reservation.findMany({
      where: {
        property: { organizationId: orgId },
        status: { in: ["confirmed", "pending"] },
        arrivalDate: { lt: forecastEnd },
        departureDate: { gt: today },
      },
      select: {
        propertyId: true,
        arrivalDate: true,
        departureDate: true,
      },
    }),
  ]);

  const days: DayForecast[] = [];
  for (let i = 0; i < daysAhead; i++) {
    const day = new Date(today.getTime() + i * DAY_MS);
    const dayEnd = new Date(day.getTime() + DAY_MS);
    const dateStr = istDayKey(day);

    // Count distinct properties occupied on this day
    const occupiedProperties = new Set<string>();
    for (const r of reservations) {
      if (r.arrivalDate < dayEnd && r.departureDate > day) {
        occupiedProperties.add(r.propertyId);
      }
    }

    const confirmedCount = occupiedProperties.size;
    const rate = totalProperties > 0 ? Math.round((confirmedCount / totalProperties) * 100) : 0;

    days.push({ date: dateStr, confirmedCount, totalProperties, rate });
  }

  const avgRate =
    days.length > 0 ? Math.round(days.reduce((s, d) => s + d.rate, 0) / days.length) : 0;

  const peakDay = days.reduce<DayForecast | null>(
    (best, d) => (best === null || d.rate > best.rate ? d : best),
    null,
  );

  return { days, avgRate, peakDay };
}

// ---------------------------------------------------------------------------
// Host Performance Score
// ---------------------------------------------------------------------------

export type PerformanceGrade = "A" | "B" | "C" | "D" | "F";

export interface HostPerformanceScore {
  score: number; // 0..100 (weighted over the metrics that actually have data)
  breakdown: {
    // null = "no data yet" (excluded from the score instead of counted as 0/100,
    // so a brand-new account's score doesn't swing wildly).
    responseRate: number | null;    // 0..100
    taskCompletionRate: number | null; // 0..100
    occupancyRate: number | null;   // 0..100
    complaintRate: number | null;   // 0..100 (lower = better)
  };
  grade: PerformanceGrade;
  label: string;
  hasData: boolean; // false when there is nothing meaningful to score yet
}

export async function getHostPerformanceScore(orgId: string): Promise<HostPerformanceScore> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  // Istanbul-anchored month/day window (mirrors getOccupancyByProperty) so the
  // task due-window keys off the host's calendar day, not the server's UTC day —
  // otherwise, in the Istanbul 00:00–03:00 band the cutoff jumps back a whole UTC
  // day and mis-scores task completion.
  const istKey = istDayKey(now);
  const [iy, im] = istKey.split("-").map(Number);
  const monthStart = zonedDayRange(new Date(Date.UTC(iy, im - 1, 1)), REPORT_TZ).start;
  const todayStart = zonedDayRange(now, REPORT_TZ).start;

  // 1. Response rate: of conversations that received a guest message in the last
  //    30 days, what % were answered within 24h. null when none received a guest
  //    message yet (so the metric is excluded rather than scored as 0 or 100).
  const recentConversations = await prisma.conversation.findMany({
    where: {
      property: { organizationId: orgId },
      createdAt: { gte: thirtyDaysAgo },
    },
    select: { id: true },
  });

  let answerable = 0;
  let answeredWithin24h = 0;

  if (recentConversations.length > 0) {
    // One query for all messages (was N+1: a findMany per conversation).
    const recentMessages = await prisma.message.findMany({
      where: { conversationId: { in: recentConversations.map((c) => c.id) } },
      select: { conversationId: true, direction: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const grouped = new Map<string, { direction: string; createdAt: Date }[]>();
    for (const m of recentMessages) {
      const arr = grouped.get(m.conversationId);
      if (arr) arr.push(m);
      else grouped.set(m.conversationId, [m]);
    }
    for (const msgs of grouped.values()) {
      const firstInbound = msgs.find((m) => m.direction === "inbound");
      if (!firstInbound) continue; // nothing to answer → not counted against the host
      answerable++;
      const firstOutbound = msgs.find(
        (m) => m.direction === "outbound" && m.createdAt > firstInbound.createdAt,
      );
      if (
        firstOutbound &&
        (firstOutbound.createdAt.getTime() - firstInbound.createdAt.getTime()) / (1000 * 60 * 60) <= 24
      ) {
        answeredWithin24h++;
      }
    }
  }

  const responseRate = answerable > 0 ? Math.round((answeredWithin24h / answerable) * 100) : null;

  // 2. Task completion rate: only tasks that were already DUE before today count
  //    (a task due later isn't "missed"). null when nothing is due yet this month —
  //    this is what prevents freshly-imported future tasks from tanking the score.
  const [doneTasks, dueTasks] = await Promise.all([
    prisma.task.count({
      where: {
        property: { organizationId: orgId },
        status: "done",
        dueAt: { gte: monthStart, lt: todayStart },
      },
    }),
    prisma.task.count({
      where: {
        property: { organizationId: orgId },
        dueAt: { gte: monthStart, lt: todayStart },
      },
    }),
  ]);
  const taskCompletionRate = dueTasks > 0 ? Math.round((doneTasks / dueTasks) * 100) : null;

  // 3. Occupancy rate today. null only when there are no properties at all.
  const stats = await getOpsStats(orgId);
  const occupancyRate = stats.totalProperties > 0 ? stats.occupancyRate : null;

  // 4. Complaint rate (problem conversations / all conversations in 30 days).
  //    null when there are no conversations yet.
  const complaintConvs = await prisma.conversation.count({
    where: {
      property: { organizationId: orgId },
      status: "problem",
      createdAt: { gte: thirtyDaysAgo },
    },
  });
  const complaintRate =
    recentConversations.length > 0
      ? Math.round((complaintConvs / recentConversations.length) * 100)
      : null;

  // Weighted score over ONLY the metrics that have data, re-normalized so the
  // weights still sum to 1. With no messages/tasks the score reflects occupancy
  // alone instead of swinging between 0 and 100.
  const components: { value: number; weight: number }[] = [];
  if (responseRate !== null) components.push({ value: responseRate, weight: 0.3 });
  if (taskCompletionRate !== null) components.push({ value: taskCompletionRate, weight: 0.25 });
  if (occupancyRate !== null) components.push({ value: occupancyRate, weight: 0.25 });
  if (complaintRate !== null)
    components.push({ value: 100 - Math.min(complaintRate, 100), weight: 0.2 });

  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  const hasData = totalWeight > 0;
  const score = hasData
    ? Math.round(components.reduce((s, c) => s + c.value * c.weight, 0) / totalWeight)
    : 0;

  let grade: PerformanceGrade;
  let label: string;
  if (!hasData) { grade = "C"; label = "Veri yok"; }
  else if (score >= 90) { grade = "A"; label = "Mükemmel"; }
  else if (score >= 75) { grade = "B"; label = "İyi"; }
  else if (score >= 60) { grade = "C"; label = "Orta"; }
  else if (score >= 45) { grade = "D"; label = "Geliştirilmeli"; }
  else { grade = "F"; label = "Kritik"; }

  return {
    score,
    breakdown: { responseRate, taskCompletionRate, occupancyRate, complaintRate },
    grade,
    label,
    hasData,
  };
}

export interface AiOpsReport {
  aiReplies: number; // AI replies sent (auto + host-approved AI-assisted) — last 30 days
  welcomes: number; // welcome messages sent (last 30 days)
  checkins: number; // check-in info messages sent (last 30 days)
  checkouts: number; // check-out messages sent (last 30 days)
  openProblems: number; // conversations currently flagged for a human
  problemsByProperty: { propertyName: string; count: number }[];
}

/**
 * AI & automation activity over the last 30 days plus the current complaint
 * backlog by apartment. Surfaces how much work the system handled and where the
 * problems concentrate. All read-only counts; safe on an empty account (zeros).
 */
export async function getAiOpsReport(orgId: string): Promise<AiOpsReport> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const scope = propertyScope(orgId);

  const [aiReplies, welcomes, checkins, checkouts, openProblems, problems] = await Promise.all([
    prisma.message.count({
      where: {
        direction: "outbound",
        // Fully-automatic AI sends (the "GuestOps AI" classifier string — do NOT
        // change it) PLUS host-approved AI-assisted replies, so an active host who
        // one-click-approves AI drafts actually sees credit (was 0 before).
        OR: [{ senderName: "GuestOps AI" }, { aiAssisted: true }],
        createdAt: { gte: since },
        conversation: { ...scope },
      },
    }),
    prisma.reservation.count({ where: { ...scope, welcomeSentAt: { gte: since } } }),
    prisma.reservation.count({ where: { ...scope, checkinSentAt: { gte: since } } }),
    prisma.reservation.count({ where: { ...scope, checkoutSentAt: { gte: since } } }),
    // Exact open-problem total via count() — the findMany below is capped at 500
    // for the per-property breakdown, so deriving the headline from its length
    // would silently undercount a host with >500 flagged conversations.
    prisma.conversation.count({ where: { ...scope, status: "problem" } }),
    prisma.conversation.findMany({
      where: { ...scope, status: "problem" },
      select: { property: { select: { name: true } } },
      take: 500,
    }),
  ]);

  const counts = new Map<string, number>();
  for (const p of problems) {
    const name = p.property.name;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const problemsByProperty = [...counts.entries()]
    .map(([propertyName, count]) => ({ propertyName, count }))
    .sort((a, b) => b.count - a.count);

  return {
    aiReplies,
    welcomes,
    checkins,
    checkouts,
    openProblems: problems.length,
    problemsByProperty,
  };
}

/** Deterministic Turkish daily operations summary (no external AI needed). */
export function buildDailySummary(
  stats: OpsStats,
  arrivals: { guestName: string; propertyName: string }[],
  departures: { guestName: string; propertyName: string }[],
): string {
  const parts: string[] = [];
  parts.push(
    `Bugün ${stats.arrivalsToday} giriş ve ${stats.departuresToday} çıkış planlı.`,
  );
  if (stats.occupancyRate > 0) {
    parts.push(`Doluluk oranı %${stats.occupancyRate}.`);
  }
  if (stats.problemConversations > 0) {
    parts.push(`⚠ ${stats.problemConversations} sorunlu konuşma yöneticinin dikkatini bekliyor.`);
  }
  if (stats.urgentTasks > 0) {
    parts.push(`${stats.urgentTasks} acil görev var.`);
  }
  if (arrivals.length > 0) {
    parts.push(
      "Girişler: " + arrivals.map((a) => `${a.guestName} (${a.propertyName})`).join(", ") + ".",
    );
  }
  if (departures.length > 0) {
    parts.push(
      "Çıkışlar: " + departures.map((d) => `${d.guestName} (${d.propertyName})`).join(", ") + ".",
    );
  }
  return parts.join(" ");
}
