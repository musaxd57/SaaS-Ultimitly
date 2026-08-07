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
import { orgTimezone, zonedDateStart } from "@/lib/timezone";
import { clampPage, MAX_LIST_PAGE } from "@/lib/pagination";

export const dynamic = "force-dynamic";

/** Sayfa başına iptal kaydı. Ekran eskiden sabit 200 satırda SESSİZCE kesiliyordu
 *  ve tümünü gösteriyormuş gibi davranıyordu. */
const PAGE_SIZE = 50;

type Period = "day" | "week" | "month" | "all";
const PERIODS: { value: Period; label: string }[] = [
  { value: "all", label: "Tümü" },
  { value: "day", label: "Bugün" },
  { value: "week", label: "Bu hafta" },
  { value: "month", label: "Bu ay" },
];

/**
 * Date window (by stay arrival date) for the selected period, anchored to the
 * HOST'S calendar (org.timezone) — NOT the server's zone (Railway is UTC).
 * Hospitable stores arrivalDate at local-midnight-UTC and iCal/CSV at noon-UTC,
 * so a UTC boundary mis-buckets a stay by a day; we mirror tasks/page.tsx &
 * automation.ts and key off the org-local day. Calendar-day boundaries map to
 * exact UTC instants via zonedDateStart (probe-date yaklaşımı UTC'nin batısındaki
 * dilimlerde bir gün kayardı). Null = no filter ("Tümü"). */
function windowFor(period: Period, tz: string): { gte: Date; lte: Date } | null {
  const now = new Date();
  if (period === "all") return null;

  // Today's org-local calendar day boundaries (start = local-midnight UTC instant).
  const today = zonedDayRange(now, tz);
  if (period === "day") return { gte: today.start, lte: today.end };

  // The org-local calendar Y-M-D of "today", used to derive week/month edges.
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m, d] = key.split("-").map(Number);

  if (period === "week") {
    // Week starts Monday (matches the previous weekStartsOn: 1). Compute the
    // Mon/Sun calendar day NUMBERS via UTC date math on the local Y-M-D (pure
    // calendar arithmetic), then map each day to its local instant directly.
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
    const sinceMonday = (dow + 6) % 7; // Mon→0 .. Sun→6
    return {
      gte: zonedDateStart(y, m, d - sinceMonday, tz),
      lte: new Date(zonedDateStart(y, m, d - sinceMonday + 7, tz).getTime() - 1),
    };
  }

  // month: first day of the local month → last instant before next month's 1st.
  return {
    gte: zonedDateStart(y, m, 1, tz),
    lte: new Date(zonedDateStart(y, m + 1, 1, tz).getTime() - 1),
  };
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
  searchParams: Promise<{ propertyId?: string; period?: string; sayfa?: string }>;
}) {
  const session = await requireAuth();
  const sp = await searchParams;
  // A repeated ?propertyId= arrives as string[] at runtime; take the first so a
  // bare array never reaches Prisma on this scalar field (would throw).
  const propertyId = Array.isArray(sp.propertyId) ? sp.propertyId[0] : sp.propertyId;
  const period: Period = PERIODS.some((p) => p.value === sp.period) ? (sp.period as Period) : "all";
  const orgRow = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { timezone: true },
  });
  const win = windowFor(period, orgTimezone(orgRow?.timezone));

  const page = clampPage(sp.sayfa, MAX_LIST_PAGE);
  // Sayım ve listeleme AYNI koşulu paylaşır — ayrışırsa sayaç yalan söyler.
  const where = {
    property: { organizationId: session.organizationId },
    status: "cancelled",
    ...(propertyId ? { propertyId } : {}),
    ...(win ? { arrivalDate: { gte: win.gte, lte: win.lte } } : {}),
  };

  const [total, reservations, properties] = await Promise.all([
    prisma.reservation.count({ where }),
    prisma.reservation.findMany({
      where,
      include: { property: { select: { id: true, name: true } } },
      // TAM SIRA: aynı arrivalDate'i taşıyan iptaller sayfa sınırında kaymasın
      // (Gönderilenler ekranındaki aynı ders — tekrar/kayıp riski).
      orderBy: [{ arrivalDate: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.property.findMany({
      where: { organizationId: session.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Build a href that preserves the other filter (so picking a property keeps the
  // period and vice-versa). "all"/empty values are dropped for clean URLs.
  function href(next: { propertyId?: string | null; period?: Period; sayfa?: number }): string {
    const pid = next.propertyId === undefined ? propertyId : next.propertyId;
    const per = next.period === undefined ? period : next.period;
    // Filtre değişince sayfa 1'e döner: 7. sayfadayken daire değiştirip boş ekran
    // görmek, "kayıt yok" sanılan bir hata gibi okunur.
    const changesFilter = next.propertyId !== undefined || next.period !== undefined;
    const pg = changesFilter ? 1 : (next.sayfa ?? page);
    const q = new URLSearchParams();
    if (pid) q.set("propertyId", pid);
    if (per && per !== "all") q.set("period", per);
    if (pg > 1) q.set("sayfa", String(pg));
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

  const from = reservations.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = reservations.length === 0 ? 0 : (page - 1) * PAGE_SIZE + reservations.length;
  const hasPrev = page > 1;
  const hasNext = to < total;

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
            {/* ⚠️ ÜÇ AYRI BOŞLUK, ÜÇ AYRI CÜMLE (denetim 08-07 (4)).
                Eskiden yalnız `period`e bakılıyordu, yani (a) sayfa numarası
                listenin sonunu aştığında ve (b) bir DAİRE filtresi hiç eşleşme
                vermediğinde de "hiç iptal yok" yazıyordu. İkisi de yalan ve
                ikisi de ÇIKIŞSIZ: sayfalama yalnız `else` dalında çiziliyor,
                yani bu kartta geri dönüş bağlantısı YOKTU. Kardeş sayfaların
                (guest-chats/inbox/tasks/sent) hepsi bu durumu karşılıyor. */}
            {page > 1 ? (
              <>
                Bu sayfada iptal yok — sayfa numarası listenin sonunu aşmış görünüyor.{" "}
                <Link href={href({ sayfa: 1 })} className="text-primary hover:underline">
                  İlk sayfaya dön
                </Link>
              </>
            ) : propertyId ? (
              <>
                Seçili dairede{period === "all" ? "" : " bu dönemde"} iptal edilen rezervasyon yok.{" "}
                <Link href={href({ propertyId: null })} className="text-primary hover:underline">
                  Tüm daireleri göster
                </Link>
              </>
            ) : period === "all" ? (
              "İptal edilen rezervasyon yok. Bir rezervasyon iptal/red/süresi-dolmuş olduğunda burada dairesine göre listelenir."
            ) : (
              "Bu dönemde iptal edilen rezervasyon yok. Dönemi değiştirip tekrar bakabilirsiniz."
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Gruplar YALNIZ BU SAYFADAKİ kayıtlardan oluşur — söylenmezse ekran,
              o daireye ait iptallerin tamamını gösteriyormuş gibi okunur. */}
          {total > reservations.length ? (
            <p className="text-xs text-muted-foreground">
              Toplam {total} iptalden {from}–{to} arası gösteriliyor; aşağıdaki daire grupları bu
              sayfadaki kayıtlara aittir.
            </p>
          ) : null}
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

          <div className="flex items-center justify-between pt-1 text-sm text-muted-foreground">
            <span>
              {from}–{to} / {total}
            </span>
            <div className="flex gap-2">
              {hasPrev ? (
                <Link
                  href={href({ sayfa: page - 1 })}
                  className="rounded-md border border-border px-3 py-1 hover:bg-accent"
                >
                  Önceki
                </Link>
              ) : null}
              {hasNext ? (
                <Link
                  href={href({ sayfa: page + 1 })}
                  className="rounded-md border border-border px-3 py-1 hover:bg-accent"
                >
                  Sonraki
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
