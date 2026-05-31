import Link from "next/link";
import { CalendarDays, Plus } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/ui/link-button";
import { EmptyState } from "@/components/empty-state";
import {
  ReservationsList,
  type ReservationRow,
} from "@/components/reservations/reservations-list";
import { RESERVATION_STATUS } from "@/lib/constants";
import { formatDate, formatCurrency, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requireAuth();
  const { status } = await searchParams;

  const reservations = await prisma.reservation.findMany({
    where: {
      property: { organizationId: session.organizationId },
      ...(status ? { status } : {}),
    },
    include: { property: { select: { name: true } } },
    orderBy: { arrivalDate: "desc" },
  });

  const rows: ReservationRow[] = reservations.map((r) => ({
    id: r.id,
    guestName: r.guestName,
    propertyName: r.property.name,
    arrivalLabel: formatDate(r.arrivalDate),
    departureLabel: formatDate(r.departureDate),
    channel: r.channel,
    status: r.status,
    amountLabel: formatCurrency(r.totalAmount, r.currency),
  }));

  const filters = [{ value: "", label: "Tümü" }, ...RESERVATION_STATUS.options];

  return (
    <>
      <PageHeader title="Rezervasyonlar" description="Tüm kanallardan rezervasyonları yönetin.">
        <LinkButton href="/reservations/new">
          <Plus className="size-4" /> Yeni rezervasyon
        </LinkButton>
      </PageHeader>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => {
          const active = (status ?? "") === f.value;
          return (
            <Link
              key={f.value || "all"}
              href={f.value ? `/reservations?status=${f.value}` : "/reservations"}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-accent",
              )}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Rezervasyon bulunamadı"
          description="Manuel rezervasyon ekleyerek operasyon akışını başlatın."
        >
          <LinkButton href="/reservations/new" size="sm">
            <Plus className="size-4" /> Rezervasyon ekle
          </LinkButton>
        </EmptyState>
      ) : (
        <ReservationsList items={rows} />
      )}
    </>
  );
}
