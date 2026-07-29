import { prisma } from "@/lib/db";
import { getOpsStats, buildDailySummary } from "@/lib/reports";
import { jsonOk } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { orgTimezone, zonedDayRange } from "@/lib/timezone";

export const GET = withManage(async (session) => {
  const orgId = session.organizationId;
  // "Today" is the ORG's calendar day, not the server's. date-fns
  // startOfDay/endOfDay cut the SERVER-local day, and Railway runs UTC while an
  // Istanbul host lives at UTC+3 — so between local 00:00 and 03:00 the report
  // listed yesterday's arrivals as today's, and reservation rows stamped at the
  // local-midnight fixed point (21:00Z the previous day) fell outside the UTC
  // window for the rest of the day. zonedDayRange returns the org-local day as
  // [local-midnight, next-local-midnight) — end EXCLUSIVE, hence lt below.
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { timezone: true },
  });
  const { start: dayStart, end: dayEnd } = zonedDayRange(new Date(), orgTimezone(org?.timezone));
  const scope = { property: { organizationId: orgId } };

  const [stats, arrivals, departures] = await Promise.all([
    getOpsStats(orgId),
    prisma.reservation.findMany({
      where: { ...scope, arrivalDate: { gte: dayStart, lt: dayEnd } },
      include: { property: { select: { name: true } } },
      orderBy: { arrivalDate: "asc" },
    }),
    prisma.reservation.findMany({
      where: { ...scope, departureDate: { gte: dayStart, lt: dayEnd } },
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
    // The org-local midnight instant — was the server-local one.
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
});
