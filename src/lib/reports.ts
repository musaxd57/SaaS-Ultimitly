import "server-only";
import { startOfDay, endOfDay, startOfMonth, endOfMonth } from "date-fns";
import { prisma } from "@/lib/db";

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
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);

  const [
    arrivalsToday,
    departuresToday,
    openConversations,
    problemConversations,
    urgentTasks,
    openTasks,
    totalProperties,
    occupiedToday,
  ] = await Promise.all([
    prisma.reservation.count({
      where: { ...propertyScope(orgId), arrivalDate: { gte: dayStart, lte: dayEnd } },
    }),
    prisma.reservation.count({
      where: { ...propertyScope(orgId), departureDate: { gte: dayStart, lte: dayEnd } },
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
    prisma.reservation.count({
      where: {
        ...propertyScope(orgId),
        status: { in: ["confirmed", "completed"] },
        arrivalDate: { lte: dayEnd },
        departureDate: { gte: dayStart },
      },
    }),
  ]);

  const occupancyRate =
    totalProperties > 0 ? Math.round((occupiedToday / totalProperties) * 100) : 0;

  return {
    arrivalsToday,
    departuresToday,
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
      where: { ...propertyScope(orgId), arrivalDate: { gte: monthStart, lte: monthEnd } },
      select: { totalAmount: true, currency: true },
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

  const revenueMap = new Map<string, number>();
  for (const r of reservations) {
    if (r.totalAmount) {
      revenueMap.set(r.currency, (revenueMap.get(r.currency) ?? 0) + r.totalAmount);
    }
  }

  return {
    monthLabel: now.toLocaleDateString("tr-TR", { month: "long", year: "numeric" }),
    reservationsCount: reservations.length,
    revenueByCurrency: Array.from(revenueMap, ([currency, total]) => ({ currency, total })),
    completedTasks,
    totalTasks,
    taskCompletionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
    messagesCount,
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
  if (stats.openConversations > 0) {
    parts.push(`${stats.openConversations} mesaj cevap bekliyor.`);
  } else {
    parts.push("Cevap bekleyen mesaj yok.");
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
