import Link from "next/link";
import { CalendarX2 } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RESERVATION_CHANNEL } from "@/lib/constants";
import { cn, formatDate } from "@/lib/utils";
import { zonedDayRange } from "@/lib/automation";

const TZ = "Europe/Istanbul"; // Türkiye, UTC+3 year-round

export const dynamic = "force-dynamic";

type Period = "day" | "week" | "month" | "all";
const PERIODS: { value: Period; label: string }[] = [
  { value: "all", label: "Tümü" },
  { value: "day", label: "Bugün" },
  { value: "week", label: "Bu hafta" },
  { value: "month", label: "Bu ay" },
];

/**
 * Date window (by stay arrival date) for the selected period, anchored to the
 * host's Istanbul calendar — NOT the server's zone (Railway is UTC). Hospitable
 * stores arrivalDate at Istanbul-midnight-UTC and iCal/CSV at noon-UTC, so a UTC
 * boundary mis-buckets a stay by a day; we mirror tasks/page.tsx & automation.ts
 * and key off the Istanbul day. Boundaries are computed as Istanbul calendar
 * days, then each mapped to its exact Istanbul-midnight (and 23:59:59.999) UTC
 * instant via zonedDayRange. Null = no filter ("Tümü"). */
function windowFor(period: Period): { gte: Date; lte: Date } | null {
  const now = new Date();
  if (period === "all") return null;

  // Today's Istanbul calendar day boundaries (start = Istanbul-midnight UTC).
  const today = zonedDayRange(now, TZ);
  if (period === "day") return { gte: today.start, lte: today.end };

  // The Istanbul calendar Y-M-D of "today", used to derive week/month edges.
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m, d] = key.split("-").map(Number);

  if (period === "week") {
    // Week starts Monday (matches the previous weekStartsOn: 1). Compute the
    // Mon/Sun calendar days via UTC date math on the Istanbul Y-M-D, then map
    // each boundary day back to its Istanbul instant through zonedDayRange.
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
    const sinceMonday = (dow + 6) % 7; // Mon→0 .. Sun→6
    const monday = new Date(Date.UTC(y, m - 1, d - sinceMonday));
    const sunday = new Date(Date.UTC(y, m - 1, d - sinceMonday + 6));
    return { gte: zonedDayRange(monday, TZ).start, lte: zonedDayRange(sunday, TZ).end };
  }

  // month: first and last calendar day of the Istanbul month.
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of this one
  return { gte: zonedDayRange(first, TZ).start, lte: zonedDayRange(last, TZ).end };
}

/**
 * "İptaller" — read-only overview of cancelled reservations, filterable by
 * apartment and by stay period (Bugün / Bu hafta / Bu ay / Tümü). Cancelled
 * bookings are excluded from the dashboard/occupancy/auto-reply, so this is the
 * one place a host sees exactly what was cancelled. The period filter keys on the
 * STAY's arrival date (the host's calendar lens), so e.g. "Bu ay" = this month's
 * stays that got cancelled. Pending cleaning/check-in tasks for a cancelled
 * booking are removed automatically (sync) — nothing to act on here.
 */
export default async function CancellationsPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string; period?: string }>;
}) {
  const session = await requireAuth();
  const sp = await searchParams;
  // A repeated ?propertyId= arrives as string[] at runtime; take the first so a
  // bare array never reaches Prisma on this scalar field (would throw).
  const propertyId = Array.isArray(sp.propertyId) ? sp.propertyId[0] : sp.propertyId;
  const period: Period = PERIODS.some((p) => p.value === sp.period) ? (sp.period as Period) : "all";
  const win = windowFor(period);

  const [reservations, properties] = await Promise.all([
    prisma.reservation.findMany({
      where: {
        property: { organizationId: session.organizationId },
        status: "cancelled",
        ...(propertyId ? { propertyId } : {}),
        ...(win ? { arrivalDate: { gte: win.gte, lte: win.lte } } : {}),
      },
      include: { property: { select: { id: true, name: true } } },
      orderBy: { arrivalDate: "desc" },
      take: 200,
    }),
    prisma.property.findMany({
      where: { organizationId: session.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Build a href that preserves the other filter (so picking a property keeps the
  // period and vice-versa). "all"/empty values are dropped for clean URLs.
  function href(next: { propertyId?: string | null; period?: Period }): string {
    const pid = next.propertyId === undefined ? propertyId : next.propertyId;
    const per = next.period === undefined ? period : next.period;
    const q = new URLSearchParams();
    if (pid) q.set("propertyId", pid);
    if (per && per !== "all") q.set("period", per);
    const qs = q.toString();
    return qs ? `/cancellations?${qs}` : "/cancellations";
  }

  const pill = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-sm transition-colors",
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border bg-card text-muted-foreground hover:bg-accent",
    );

  // Group by apartment so the host can answer "daire X'e ne oldu?" at a glance.
  const byProperty = new Map<string, { name: string; rows: typeof reservations }>();
  for (const r of reservations) {
    const entry = byProperty.get(r.property.id) ?? { name: r.property.name, rows: [] };
    entry.rows.push(r);
    byProperty.set(r.property.id, entry);
  }
  const groups = [...byProperty.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));

  return (
    <>
      <PageHeader
        title="İptaller"
        description="İptal edilen rezervasyonlar (daire ve döneme göre). Bunlar panel, doluluk ve otomatik yanıttan zaten dışlanır; iptal olunca bekleyen temizlik/giriş görevleri otomatik kaldırılır. Bu sayfa yalnızca bilgilendirme amaçlıdır."
      />

      {/* Period filter (by stay arrival date) */}
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Link key={p.value} href={href({ period: p.value })} className={pill(period === p.value)}>
            {p.label}
          </Link>
        ))}
      </div>

      {/* Property filter */}
      {properties.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          <Link href={href({ propertyId: null })} className={pill(!propertyId)}>
            Tüm daireler
          </Link>
          {properties.map((p) => (
            <Link key={p.id} href={href({ propertyId: p.id })} className={pill(propertyId === p.id)}>
              {p.name}
            </Link>
          ))}
        </div>
      ) : null}

      {reservations.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {period === "all"
              ? "İptal edilen rezervasyon yok. Bir rezervasyon iptal/red/süresi-dolmuş olduğunda burada dairesine göre listelenir."
              : "Bu dönemde iptal edilen rezervasyon yok. Dönemi değiştirip tekrar bakabilirsiniz."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.name}>
              <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarX2 className="size-4 text-muted-foreground" /> {g.name}
                </CardTitle>
                <Badge tone="destructive">{g.rows.length} iptal</Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {g.rows.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2 last:border-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.guestName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(r.arrivalDate)} – {formatDate(r.departureDate)}
                      </p>
                    </div>
                    <Badge tone={RESERVATION_CHANNEL.tone(r.channel)}>
                      {RESERVATION_CHANNEL.label(r.channel)}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
