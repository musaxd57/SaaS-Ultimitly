import { requireManagerSession } from "@/lib/auth/manager-page";
import { PageHeader } from "@/components/page-header";
import { ArrivalsList, type ArrivalsListRow } from "@/components/arrivals/arrivals-list";
import { loadArrivalReadiness } from "@/lib/readiness-list/load";
import { wallClockMoment } from "@/lib/early-checkin/readiness";
import { addNights } from "@/modules/availability/core";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// "Girişler" — konaklama bazlı giriş hazırlığı (kurucu H1, 11-05; salt-okuma). Bugün + sonraki iki gün. Temizlik hükmü misafire giden
// "Daireniz hazır" kararıyla AYNI kanıt yolundan (`lib/readiness-list/load.ts`); atanmış olmak kanıt değildir; bilinmeyen asla yeşil
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
  return (
    <>
      <PageHeader
        title="Girişler"
        description="Bugün ve sonraki iki gün girecek misafirlerin daireleri hazır mı. Temizlik yalnız çıkıştan sonra atılmış “bitti” kaydıyla hazır sayılır; görevin birine atanmış olması yetmez. Bilinmeyen durum hazır gösterilmez."
      />
      <ArrivalsList rows={rows} truncated={data.truncated} />
    </>
  );
}
