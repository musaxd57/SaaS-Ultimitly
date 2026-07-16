import Link from "next/link";
import { ChevronLeft, ChevronRight, LogIn, LogOut } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Reservation calendar — the host's mental model of their month. Pure read
// view over existing Reservation rows (no schema change, nothing written):
// each day shows check-ins, check-outs and how many apartments are occupied.
// ---------------------------------------------------------------------------

const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

/** "YYYY-MM-DD" of a stored timestamp as seen in the org's timezone. */
function dayKey(d: Date, tz: string): string {
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; property?: string }>;
}) {
  const session = await requireAuth();
  const orgId = session.organizationId;
  const params = await searchParams;

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { timezone: true },
  });
  const tz = org?.timezone ?? "Europe/Istanbul";

  // Selected month: ?month=YYYY-MM (validated), defaulting to the current
  // month in the org's timezone.
  const todayKey = dayKey(new Date(), tz);
  const fallbackMonth = todayKey.slice(0, 7);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month ?? "") ? params.month! : fallbackMonth;
  const [year, monthNum] = month.split("-").map(Number);

  const properties = await prisma.property.findMany({
    where: { organizationId: orgId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const propertyFilter = properties.some((p) => p.id === params.property) ? params.property : undefined;

  // Reservations overlapping the month. The query window is widened by a day
  // on each side so timezone offsets can never drop a boundary stay; the
  // per-day bucketing below uses org-timezone day KEYS, which is what decides
  // where a booking actually lands.
  const monthStart = new Date(Date.UTC(year, monthNum - 1, 1));
  const monthEndExclusive = new Date(Date.UTC(year, monthNum, 1));
  const queryStart = new Date(monthStart.getTime() - 2 * 86_400_000);
  const queryEnd = new Date(monthEndExclusive.getTime() + 2 * 86_400_000);

  const reservationsRaw = await prisma.reservation.findMany({
    where: {
      property: { organizationId: orgId },
      ...(propertyFilter ? { propertyId: propertyFilter } : {}),
      status: { in: ["confirmed", "completed"] },
      arrivalDate: { lte: queryEnd },
      departureDate: { gte: queryStart },
    },
    select: {
      id: true,
      guestName: true,
      arrivalDate: true,
      departureDate: true,
      sourceReference: true,
      propertyId: true,
      property: { select: { name: true } },
    },
    orderBy: { arrivalDate: "asc" },
  });

  // Same dedupe rule as the dashboard: collapse duplicate Hospitable rows
  // (same sourceReference), keep every manual/iCal row (null sourceReference).
  const seen = new Set<string>();
  const reservations = reservationsRaw.filter((r) => {
    if (r.sourceReference == null) return true;
    if (seen.has(r.sourceReference)) return false;
    seen.add(r.sourceReference);
    return true;
  });

  // Bucket by org-timezone day key.
  type DayInfo = {
    arrivals: { guest: string; property: string }[];
    departures: { guest: string; property: string }[];
    occupied: Set<string>; // DISTINCT propertyIds occupied that night
  };
  const days = new Map<string, DayInfo>();
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const keyOf = (dayNum: number) =>
    `${year}-${String(monthNum).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
  for (let d = 1; d <= daysInMonth; d++) {
    days.set(keyOf(d), { arrivals: [], departures: [], occupied: new Set() });
  }
  for (const r of reservations) {
    const arrKey = dayKey(r.arrivalDate, tz);
    const depKey = dayKey(r.departureDate, tz);
    const entry = { guest: r.guestName, property: r.property.name };
    days.get(arrKey)?.arrivals.push(entry);
    days.get(depKey)?.departures.push(entry);
    for (const [key, info] of days) {
      // Occupied nights: arrival day inclusive, departure day exclusive. Track
      // by propertyId so the badge shows DISTINCT flats occupied — two bookings
      // for the same flat (or an overlapping manual + iCal row) count once, and
      // the number can never exceed the apartment total.
      if (key >= arrKey && key < depKey) info.occupied.add(r.propertyId);
    }
  }

  // Grid: leading blanks so day 1 lands on its weekday column (Monday first).
  const firstWeekday = (new Date(Date.UTC(year, monthNum - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthTitle = new Intl.DateTimeFormat("tr-TR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(monthStart);
  const prevMonth = `${monthNum === 1 ? year - 1 : year}-${String(monthNum === 1 ? 12 : monthNum - 1).padStart(2, "0")}`;
  const nextMonth = `${monthNum === 12 ? year + 1 : year}-${String(monthNum === 12 ? 1 : monthNum + 1).padStart(2, "0")}`;
  const monthHref = (m: string) =>
    `/calendar?month=${m}${propertyFilter ? `&property=${propertyFilter}` : ""}`;
  const propertyHref = (id?: string) => `/calendar?month=${month}${id ? `&property=${id}` : ""}`;
  const totalProperties = propertyFilter ? 1 : properties.length;

  return (
    <>
      <PageHeader
        title="Takvim"
        description="Giriş ve çıkışları aylık takvimde görün. Rezervasyonlar bağlantınızdan otomatik gelir."
      />

      {/* Property filter */}
      {properties.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href={propertyHref()}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              !propertyFilter ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent",
            )}
          >
            Tüm daireler
          </Link>
          {properties.map((p) => (
            <Link
              key={p.id}
              href={propertyHref(p.id)}
              className={cn(
                "max-w-[12rem] truncate rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                propertyFilter === p.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-accent",
              )}
            >
              {p.name}
            </Link>
          ))}
        </div>
      ) : null}

      <Card>
        <CardContent className="p-4">
          {/* Month navigation */}
          <div className="mb-3 flex items-center justify-between">
            <Link
              href={monthHref(prevMonth)}
              className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent"
              aria-label="Önceki ay"
            >
              <ChevronLeft className="size-4" />
            </Link>
            <h2 className="text-base font-semibold capitalize">{monthTitle}</h2>
            <Link
              href={monthHref(nextMonth)}
              className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent"
              aria-label="Sonraki ay"
            >
              <ChevronRight className="size-4" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[860px]">
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="px-1.5 py-1 text-center text-xs font-medium uppercase text-muted-foreground">
                    {w}
                  </div>
                ))}
                {cells.map((dayNum, i) => {
                  if (dayNum == null) return <div key={`blank-${i}`} className="rounded-lg bg-muted/20" />;
                  const key = keyOf(dayNum);
                  const info = days.get(key)!;
                  const isToday = key === todayKey;
                  const cap = 3; // keep busy days one tidy cell
                  return (
                    <div
                      key={key}
                      className={cn(
                        // Comfortable-but-compact cells. The user later relaxed
                        // the one-screen constraint ("aşağıya doğru büyüyebilir")
                        // — 64px felt cramped, 92px sprawled; 80px is the middle.
                        "min-h-[80px] rounded-lg border p-1 text-xs",
                        isToday ? "border-primary/60 bg-accent/40" : "border-border",
                      )}
                    >
                      <div className="mb-0.5 flex items-center justify-between">
                        <span className={cn("font-semibold", isToday && "text-primary")}>{dayNum}</span>
                        {info.occupied.size > 0 ? (
                          <span
                            className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                            title={`${info.occupied.size}/${totalProperties} daire dolu`}
                          >
                            {info.occupied.size} dolu
                          </span>
                        ) : null}
                      </div>
                      <div className="space-y-0.5">
                        {info.arrivals.slice(0, cap).map((a, j) => (
                          <p key={`a-${j}`} className="flex items-center gap-1 truncate text-emerald-700" title={`Giriş: ${a.guest} — ${a.property}`}>
                            <LogIn className="size-3 shrink-0" />
                            <span className="truncate">{a.guest}{propertyFilter ? "" : ` · ${a.property}`}</span>
                          </p>
                        ))}
                        {info.departures.slice(0, cap).map((d, j) => (
                          <p key={`d-${j}`} className="flex items-center gap-1 truncate text-amber-700" title={`Çıkış: ${d.guest} — ${d.property}`}>
                            <LogOut className="size-3 shrink-0" />
                            <span className="truncate">{d.guest}{propertyFilter ? "" : ` · ${d.property}`}</span>
                          </p>
                        ))}
                        {info.arrivals.length + info.departures.length > cap * 2 ? (
                          <p className="text-[10px] text-muted-foreground">
                            +{info.arrivals.length + info.departures.length - cap * 2} diğer
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <LogIn className="size-3 text-emerald-700" /> Giriş
            </span>
            <span className="inline-flex items-center gap-1">
              <LogOut className="size-3 text-amber-700" /> Çıkış
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">N dolu</span>
              o gece dolu daire sayısı
            </span>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
