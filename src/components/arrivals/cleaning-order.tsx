import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CleaningJob, DayOrderGroup } from "@/lib/tasks/day-order";

// ---------------------------------------------------------------------------
// Girişler — "Temizlik sırası önerisi" kartı (plan madde 10-A). Sunucu bileşeni, salt okuma; yalnız yönetici sayfası çizer. Hiçbir görevi
// değiştirmez. Grup yoksa (her kişinin o gün en çok bir temizliği var) kart HİÇ çizilmez.
// ---------------------------------------------------------------------------

function jobDetail(j: CleaningJob): string {
  if (!j.arrival) return "o gün giriş yok";
  const time = j.arrival.checkInTime ? `giriş ${j.arrival.checkInTime}` : "giriş saati yok";
  if (j.arrival.early === "approved") return `${time} · erken giriş onaylandı`;
  if (j.arrival.early === "requested") return `${time} · erken giriş istendi`;
  return time;
}

export function CleaningOrderCard({
  groups,
  truncated,
  dayLabels,
}: {
  groups: DayOrderGroup[];
  truncated: boolean;
  dayLabels: Record<string, string>;
}) {
  if (!truncated && groups.length === 0) return null;
  const days = [...new Set(groups.map((g) => g.dayKey))];
  return (
    <Card data-cleaning-order>
      <CardHeader>
        <CardTitle className="text-base">Temizlik sırası önerisi</CardTitle>
        <p className="text-sm text-muted-foreground">
          Aynı gün birden çok temizliği olan kişiler için: önce erken giriş istenen daire, sonra girişi en erken olan. Görevlerin saati ve
          ataması değişmez.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {truncated ? (
          <p className="text-muted-foreground">Bu günlerde çok fazla temizlik olduğu için sıra önerisi gösterilmiyor.</p>
        ) : null}
        {days.map((day) => (
          <div key={day} className="space-y-2">
            <p className="font-medium">{dayLabels[day] ?? day}</p>
            {groups
              .filter((g) => g.dayKey === day)
              .map((g) => (
                <div key={`${day}-${g.assigneeId ?? "none"}`} className="rounded-lg border border-border px-3 py-2">
                  <p className="font-medium">{g.assigneeId ? (g.assigneeName ?? "Ekip üyesi") : "Atanmamış"}</p>
                  <ol className="mt-1 space-y-0.5">
                    {g.jobs.map((j, i) => (
                      <li key={j.taskId}>
                        {i + 1}. {j.propertyName} <span className="text-muted-foreground">— {jobDetail(j)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
