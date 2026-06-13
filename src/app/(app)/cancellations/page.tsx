import { CalendarX2 } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RESERVATION_CHANNEL } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * "İptaller" — a read-only overview of cancelled reservations across every
 * apartment, grouped by property. Cancelled bookings are correctly excluded from
 * the dashboard / occupancy / auto-reply, so without this view a host couldn't
 * tell whether an apartment "went quiet" because of a cancellation or a bug. Here
 * they see exactly what was cancelled and when. When a booking is cancelled its
 * still-pending cleaning/check-in tasks are removed automatically (sync), so this
 * page is purely informational — nothing to act on.
 */
export default async function CancellationsPage() {
  const session = await requireAuth();

  const reservations = await prisma.reservation.findMany({
    where: {
      property: { organizationId: session.organizationId },
      status: "cancelled",
    },
    include: { property: { select: { id: true, name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

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
        description="İptal edilen rezervasyonlar (daire bazlı). Bunlar panel, doluluk ve otomatik yanıttan zaten dışlanır; iptal olunca bekleyen temizlik/giriş görevleri otomatik kaldırılır. Bu sayfa yalnızca bilgilendirme amaçlıdır."
      />

      {reservations.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            İptal edilen rezervasyon yok. Bir rezervasyon iptal/red/süresi-dolmuş olduğunda burada
            dairesine göre listelenir.
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
                    <div className="flex items-center gap-2">
                      <Badge tone={RESERVATION_CHANNEL.tone(r.channel)}>
                        {RESERVATION_CHANNEL.label(r.channel)}
                      </Badge>
                      <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                        İptal: {formatDateTime(r.updatedAt)}
                      </span>
                    </div>
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
