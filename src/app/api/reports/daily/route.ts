import { startOfDay, endOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { getOpsStats, buildDailySummary } from "@/lib/reports";
import { requireSession, unauthorized, jsonOk } from "@/lib/api";

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const orgId = session.organizationId;
  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const scope = { property: { organizationId: orgId } };

  const [stats, arrivals, departures] = await Promise.all([
    getOpsStats(orgId),
    prisma.reservation.findMany({
      where: { ...scope, arrivalDate: { gte: dayStart, lte: dayEnd } },
      include: { property: { select: { name: true } } },
      orderBy: { arrivalDate: "asc" },
    }),
    prisma.reservation.findMany({
      where: { ...scope, departureDate: { gte: dayStart, lte: dayEnd } },
      include: { property: { select: { name: true } } },
      orderBy: { departureDate: "asc" },
    }),
  ]);

  const summary = buildDailySummary(
    stats,
    arrivals.map((a) => ({ guestName: a.guestName, propertyName: a.property.name })),
    departures.map((d) => ({ guestName: d.guestName, propertyName: d.property.name })),
  );

  return jsonOk({
    date: dayStart.toISOString(),
    summary,
    stats,
    arrivals: arrivals.map((a) => ({
      guestName: a.guestName,
      propertyName: a.property.name,
      arrivalDate: a.arrivalDate,
    })),
    departures: departures.map((d) => ({
      guestName: d.guestName,
      propertyName: d.property.name,
      departureDate: d.departureDate,
    })),
  });
}
