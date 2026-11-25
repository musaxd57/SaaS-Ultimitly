import { requireManagerSession } from "@/lib/auth/manager-page";
import { PageHeader } from "@/components/page-header";
import { ArrivalsList, type ArrivalsListRow } from "@/components/arrivals/arrivals-list";
import { loadArrivalReadiness } from "@/lib/readiness-list/load";
import { wallClockMoment } from "@/lib/early-checkin/readiness";
import { addNights } from "@/modules/availability/core";
import { prisma } from "@/lib/db";
import { canManageChannel } from "@/components/connect-channel-button";
import { CleaningOrderCard } from "@/components/arrivals/cleaning-order";
import { loadCleaningDayOrders, type CleaningDayOrders } from "@/lib/tasks/day-order-load";
import { reportError } from "@/lib/report-error";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// "Girişler" — konaklama bazlı giriş hazırlığı (kurucu H1, 11-05; salt-okuma). Bugün + sonraki iki gün. Temizlik hükmü misafire giden
// "erken giriş onayı" kararıyla AYNI kanıt yolundan (`lib/readiness-list/load.ts`); atanmış olmak kanıt değildir; bilinmeyen asla yeşil
// değildir; erişim v1'de "kontrol edilmedi" (H-2) — bu yüzden en iyi durum "TEMİZLİK HAZIR".
// ---------------------------------------------------------------------------

function dayLabel(dayKey: string, todayKey: string, tz: string): string {
  const prefix = dayKey === todayKey ? "Bugün · " : dayKey === addNights(todayKey, 1) ? "Yarın · " : "";
  const at = wallClockMoment(dayKey, "12:00", tz);
  const text = at ? at.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", timeZone: tz }) : dayKey;
  return `${prefix}${text}`;
}

export default async function ArrivalsPage() {
  const session = await requireManagerSession();
  const data = await loadArrivalReadiness(session.organizationId, new Date());
  // Temizlik sırası önerisi (plan madde 10-A): yalnız öneri, aynı üç günlük pencere. Okunamazsa kart yok, sayfa düşmez.
  const dayOrders: CleaningDayOrders = await loadCleaningDayOrders(session.organizationId, {
    fromKey: data.fromKey,
    toKey: data.toKey,
    timeZone: data.timeZone,
  }).catch((err) => {
    void reportError("arrivals.cleaning-day-order", err);
    return { groups: [], truncated: false };
  });
  const rows: ArrivalsListRow[] = data.rows.map((r) => ({
    reservationId: r.reservationId,
    propertyId: r.propertyId,
    propertyName: r.propertyName,
    guestName: r.guestName,
    dayKey: r.dayKey,
    dayLabel: dayLabel(r.dayKey, data.fromKey, data.timeZone),
    checkInTime: r.checkInTime,
    conversationId: r.conversationId,
    overall: r.readiness.overall,
    factors: r.readiness.factors,
  }));
  // UX-10 D1: penceredeki üç gün her zaman başlığıyla (boş gün "Giriş yok."). Mülk sayısı yalnız hiç giriş yokken (tek sonraki adım için).
  const days = [0, 1, 2].map((n) => {
    const key = addNights(data.fromKey, n);
    return { key, label: dayLabel(key, data.fromKey, data.timeZone) };
  });
  const propertyCount = rows.length === 0 ? await prisma.property.count({ where: { organizationId: session.organizationId } }) : -1;
  // UX-10 D3: satırdan atama — kişi listesi panoyla AYNI sorgu (`tasks/page.tsx`); yalnız atanabilir satır varsa okunur.
  const needsMembers = rows.some((r) => r.factors.some((f) => f.assign));
  const members = needsMembers
    ? await prisma.user.findMany({ where: { organizationId: session.organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    : null;
  return (
    <>
      <PageHeader
        title="Girişler"
        description="Bugün ve sonraki iki gün. Temizlik yalnız çıkıştan sonraki “bitti” kaydıyla hazır sayılır; bilinmeyen hazır gösterilmez."
      />
      <CleaningOrderCard
        groups={dayOrders.groups}
        truncated={dayOrders.truncated}
        dayLabels={Object.fromEntries(days.map((d) => [d.key, d.label]))}
      />
      <ArrivalsList
        rows={rows}
        truncated={data.truncated}
        days={days}
        emptyNextStep={rows.length === 0 ? (propertyCount === 0 ? "add-property" : "calendar") : null}
        canConnect={canManageChannel(session)}
        members={members}
        canAct
      />
    </>
  );
}
