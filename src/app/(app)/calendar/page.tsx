import { startOfDay, addDays, isSameDay, format } from "date-fns";
import { CalendarRange } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { LinkButton } from "@/components/ui/link-button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const HORIZON = 14;

export default async function CalendarPage() {
  const session = await requireAuth();
  const today = startOfDay(new Date());
  const days = Array.from({ length: HORIZON }, (_, i) => addDays(today, i));
  const horizonEnd = addDays(today, HORIZON);

  const [properties, reservations] = await Promise.all([
    prisma.property.findMany({
      where: { organizationId: session.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.reservation.findMany({
      where: {
        property: { organizationId: session.organizationId },
        status: { in: ["confirmed", "pending", "completed"] },
        arrivalDate: { lt: horizonEnd },
        departureDate: { gte: today },
      },
      include: { property: { select: { id: true } } },
    }),
  ]);

  function cellFor(propertyId: string, day: Date) {
    const res = reservations.find(
      (r) =>
        r.property.id === propertyId &&
        startOfDay(r.arrivalDate) <= day &&
        day <= startOfDay(r.departureDate),
    );
    if (!res) return null;
    return {
      guestName: res.guestName,
      isArrival: isSameDay(r0(res.arrivalDate), day),
      isDeparture: isSameDay(r0(res.departureDate), day),
    };
  }

  return (
    <>
      <PageHeader
        title="Takvim"
        description={`${format(today, "d MMM")} – ${format(addDays(today, HORIZON - 1), "d MMM yyyy")} · ${HORIZON} günlük görünüm`}
      />

      {properties.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="Mülk yok"
          description="Takvimi görmek için önce bir mülk ve rezervasyon ekleyin."
        >
          <LinkButton href="/properties/new" size="sm">
            Mülk ekle
          </LinkButton>
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded bg-primary/20 ring-1 ring-inset ring-primary/40" /> Dolu
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded border-l-2 border-success bg-success/15" /> Giriş
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded border-r-2 border-destructive bg-destructive/10" /> Çıkış
            </span>
          </div>

          <div className="scrollbar-thin overflow-x-auto rounded-xl border border-border bg-card">
            <div
              className="min-w-[760px]"
              style={{ display: "grid", gridTemplateColumns: `170px repeat(${HORIZON}, 1fr)` }}
            >
              {/* Header row */}
              <div className="sticky left-0 z-10 border-b border-r border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground">
                Mülk
              </div>
              {days.map((d, i) => {
                const isToday = isSameDay(d, today);
                return (
                  <div
                    key={i}
                    className={cn(
                      "border-b border-border px-1 py-2 text-center text-[11px]",
                      isToday ? "bg-primary/5 font-semibold text-primary" : "text-muted-foreground",
                    )}
                  >
                    <div>{format(d, "EEE")}</div>
                    <div>{format(d, "d MMM")}</div>
                  </div>
                );
              })}

              {/* Property rows */}
              {properties.map((p) => (
                <div key={p.id} className="contents">
                  <div className="sticky left-0 z-10 flex items-center border-r border-t border-border bg-card px-3 py-3 text-sm font-medium">
                    <span className="truncate">{p.name}</span>
                  </div>
                  {days.map((d, i) => {
                    const cell = cellFor(p.id, d);
                    return (
                      <div key={i} className="border-t border-border p-0.5" title={cell?.guestName}>
                        {cell ? (
                          <div
                            className={cn(
                              "flex h-9 items-center overflow-hidden px-1 text-[10px] font-medium",
                              "bg-primary/15 text-primary",
                              cell.isArrival && "rounded-l-md border-l-2 border-success bg-success/15",
                              cell.isDeparture && "rounded-r-md border-r-2 border-destructive bg-destructive/10",
                            )}
                          >
                            {cell.isArrival ? (
                              <span className="truncate">{cell.guestName.split(" ")[0]}</span>
                            ) : null}
                          </div>
                        ) : (
                          <div className="h-9" />
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// Normalize a date to start-of-day for same-day comparisons.
function r0(d: Date) {
  return startOfDay(d);
}
