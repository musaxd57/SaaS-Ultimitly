import { prisma } from "@/lib/db";
import { getOpsStats, buildDailySummary, dedupeBookings } from "@/lib/reports";
import { jsonOk } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { orgTimezone, zonedDayRange } from "@/lib/timezone";
import { reservationDayRangeWhere, todayRange } from "@/lib/day-where";

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
  const now = new Date();
  const tz = orgTimezone(org?.timezone);
  // `date` sözleşmesi aynı (org gece yarısı anı). Listeler TEK TARİH KURALIYLA (09-26, `calendarDateOf`) — `getOpsStats`
  // sayılarıyla aynı küme; ham pencere New York'ta bugünün girişi yerine YARININKİNİ listeliyordu.
  const dayStart = zonedDayRange(now, tz).start;
  const today = todayRange(now, tz);
  const scope = { property: { organizationId: orgId } };

  const [stats, arrivalsRaw, departuresRaw] = await Promise.all([
    getOpsStats(orgId),
    // ⚠️ SAYILARLA AYNI KÜME (denetim, 08-01 — beşinci tur, ajan bulgusu).
    // `getOpsStats` yalnız confirmed/completed sayıyor; bu iki liste hiç
    // süzmüyordu → yanıt "Bugün 2 giriş … Girişler: A, B, C" diyebiliyor ve
    // İPTAL edilmiş misafirin adı bugünün giriş listesinde görünüyordu.
    prisma.reservation.findMany({
      where: {
        ...scope,
        status: { in: ["confirmed", "completed"] },
        AND: [reservationDayRangeWhere("arrivalDate", today, tz)],
      },
      include: { property: { select: { name: true } } },
      orderBy: { arrivalDate: "asc" },
    }),
    prisma.reservation.findMany({
      where: {
        ...scope,
        status: { in: ["confirmed", "completed"] },
        AND: [reservationDayRangeWhere("departureDate", today, tz)],
      },
      include: { property: { select: { name: true } } },
      orderBy: { departureDate: "asc" },
    }),
  ]);

  // Sayılar (`getOpsStats`) aynı rezervasyonun tekrar eden satırlarını TEK sayar; listeler de AYNI kurala (`dedupeBookings` — pano ve takvim
  // listeleriyle aynı) uğrar. Eskiden sağlayıcı rezervasyonu iki dairede kayıtlıyken "Bugün 1 giriş … Girişler: A (Daire 1), A (Daire 2)" çıkıyordu
  // (G1 tur 11). Elle / dosya rezervasyonları daire içinde ayıklanır — farklı dairelerin aynı referanslı kaydı iki giriştir.
  const arrivals = dedupeBookings(arrivalsRaw);
  const departures = dedupeBookings(departuresRaw);

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
