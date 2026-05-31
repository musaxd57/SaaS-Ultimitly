import {
  Award,
  TrendingUp,
  MessageSquare,
  Clock,
  BedDouble,
  CalendarDays,
  CheckCircle2,
  AlertTriangle,
  Building2,
  ArrowUp,
  ArrowDown,
  Minus,
} from "lucide-react";
import { requireAuth } from "@/lib/auth";
import {
  getOpsStats,
  getMonthlyReport,
  getRevenueAnalytics,
  getOccupancyByProperty,
  getTopTopics,
  getResponseTimeStats,
  getOccupancyForecast,
  getHostPerformanceScore,
  type PerformanceGrade,
} from "@/lib/reports";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const INTENT_LABELS: Record<string, string> = {
  complaint: "Şikayet",
  refund: "İade / ücret",
  early_checkin: "Erken giriş",
  late_checkout: "Geç çıkış",
  checkin: "Giriş",
  checkout: "Çıkış",
  wifi: "Wi-Fi",
  parking: "Otopark",
  location: "Konum",
  cleaning: "Temizlik",
  amenity: "Donanım",
  general: "Genel",
};

const GRADE_STYLES: Record<PerformanceGrade, string> = {
  A: "bg-emerald-500",
  B: "bg-lime-500",
  C: "bg-amber-500",
  D: "bg-orange-500",
  F: "bg-rose-500",
};

const WEEKDAYS = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

function forecastCellStyle(rate: number): string {
  if (rate === 0) return "bg-muted text-muted-foreground";
  if (rate >= 70) return "bg-emerald-500 text-white";
  if (rate >= 40) return "bg-amber-400 text-amber-950";
  return "bg-rose-400 text-white";
}

function formatDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 1) return "< 1 dk";
  if (minutes < 60) return `${minutes} dk`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} sa ${m} dk` : `${h} sa`;
}

export default async function ReportsPage() {
  const session = await requireAuth();
  const orgId = session.organizationId;

  const [stats, monthly, performance, revenue, occByProperty, topTopics, responseTime, forecast] =
    await Promise.all([
      getOpsStats(orgId),
      getMonthlyReport(orgId),
      getHostPerformanceScore(orgId),
      getRevenueAnalytics(orgId, 6),
      getOccupancyByProperty(orgId),
      getTopTopics(orgId, 6),
      getResponseTimeStats(orgId),
      getOccupancyForecast(orgId, 30),
    ]);

  // --- Revenue chart: chart the dominant currency across the 6 months. ---
  const currencyTotals = new Map<string, number>();
  for (const m of revenue) {
    for (const c of m.byCurrency) {
      currencyTotals.set(c.currency, (currencyTotals.get(c.currency) ?? 0) + c.total);
    }
  }
  const dominantCurrency =
    [...currencyTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "EUR";
  const revenueBars = revenue.map((m) => ({
    label: m.monthLabel.split(" ")[0], // month name only
    full: m.monthLabel,
    value: m.byCurrency.find((c) => c.currency === dominantCurrency)?.total ?? 0,
  }));
  const maxRevenue = Math.max(1, ...revenueBars.map((b) => b.value));
  const hasRevenue = revenueBars.some((b) => b.value > 0);

  const maxTopic = topTopics[0]?.count ?? 1;

  const breakdownItems = [
    { label: "Cevap oranı (24s içinde)", value: performance.breakdown.responseRate, invert: false },
    { label: "Görev tamamlama", value: performance.breakdown.taskCompletionRate, invert: false },
    { label: "Doluluk (bu ay)", value: performance.breakdown.occupancyRate, invert: false },
    { label: "Şikayet oranı (düşük = iyi)", value: performance.breakdown.complaintRate, invert: true },
  ];

  return (
    <>
      <PageHeader
        title="Raporlar"
        description={`Operasyon, gelir ve performans görünümü · ${monthly.monthLabel}`}
      />

      {/* ---------- Host Performance Score ---------- */}
      <Card>
        <CardContent className="flex flex-col gap-6 p-6 md:flex-row md:items-center">
          <div className="flex items-center gap-4">
            <div
              className={cn(
                "flex size-24 shrink-0 flex-col items-center justify-center rounded-2xl text-white",
                GRADE_STYLES[performance.grade],
              )}
            >
              <span className="text-4xl font-bold leading-none">{performance.grade}</span>
              <span className="mt-1 text-xs opacity-90">{performance.label}</span>
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Award className="size-4" /> Host Performans Skoru
              </p>
              <p className="text-4xl font-bold">
                {performance.score}
                <span className="text-lg font-normal text-muted-foreground">/100</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Cevap hızı, görev tamamlama, doluluk ve şikayet oranından hesaplanır.
              </p>
            </div>
          </div>

          <div className="flex-1 space-y-2.5 md:border-l md:border-border md:pl-6">
            {breakdownItems.map((b) => {
              const good = b.invert ? 100 - b.value : b.value;
              const barColor =
                good >= 75 ? "bg-emerald-500" : good >= 50 ? "bg-amber-500" : "bg-rose-500";
              return (
                <div key={b.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{b.label}</span>
                    <span className="font-medium">%{b.value}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full", barColor)} style={{ width: `${b.value}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ---------- Key stats ---------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Doluluk (bugün)"
          value={`%${stats.occupancyRate}`}
          icon={BedDouble}
          hint={`${stats.occupiedToday}/${stats.totalProperties} mülk`}
        />
        <StatCard label="Aylık Rezervasyon" value={monthly.reservationsCount} icon={CalendarDays} />
        <StatCard
          label="Ort. Cevap Süresi"
          value={formatDuration(responseTime.avgMinutes)}
          icon={Clock}
          hint={`${responseTime.conversationsAnalyzed} konuşma (30 gün)`}
        />
        <StatCard
          label="Görev Tamamlama"
          value={`%${monthly.taskCompletionRate}`}
          icon={CheckCircle2}
          hint={`${monthly.completedTasks}/${monthly.totalTasks} görev`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---------- Revenue (6-month bar chart) ---------- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="size-4 text-muted-foreground" /> Gelir (Son 6 Ay)
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {dominantCurrency}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!hasRevenue ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Henüz gelir kaydı yok. Rezervasyonlara tutar girdikçe burası dolar.
              </p>
            ) : (
              <div className="flex h-44 items-end justify-between gap-2">
                {revenueBars.map((b) => (
                  <div key={b.full} className="flex flex-1 flex-col items-center gap-1.5">
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {b.value > 0 ? formatCurrency(b.value, dominantCurrency) : ""}
                    </span>
                    <div className="flex w-full flex-1 items-end">
                      <div
                        className="w-full rounded-t bg-primary transition-all"
                        style={{ height: `${Math.max(2, (b.value / maxRevenue) * 100)}%` }}
                        title={`${b.full}: ${formatCurrency(b.value, dominantCurrency)}`}
                      />
                    </div>
                    <span className="text-[11px] text-muted-foreground">{b.label}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ---------- Top topics ---------- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="size-4 text-muted-foreground" /> En Sık Konular
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topTopics.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Henüz sınıflandırılmış mesaj yok. AI önerisi kullandıkça burası dolar.
              </p>
            ) : (
              <div className="space-y-2.5">
                {topTopics.map((t) => (
                  <div key={t.intent} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span>{INTENT_LABELS[t.intent] ?? t.intent}</span>
                      <span className="text-muted-foreground">{t.count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${Math.round((t.count / maxTopic) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---------- Occupancy forecast (30-day grid) ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <CalendarDays className="size-4 text-muted-foreground" /> Doluluk Tahmini (30 Gün)
            <span className="ml-auto flex items-center gap-3 text-xs font-normal text-muted-foreground">
              <span>Ortalama: %{forecast.avgRate}</span>
              {forecast.peakDay ? <span>Zirve: %{forecast.peakDay.rate}</span> : null}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {forecast.days.map((d) => {
              const date = new Date(d.date + "T12:00:00");
              const dayNum = date.getDate();
              const weekday = WEEKDAYS[date.getDay()];
              return (
                <div
                  key={d.date}
                  title={`${d.date} · %${d.rate} doluluk · ${d.confirmedCount}/${d.totalProperties} mülk`}
                  className={cn(
                    "flex aspect-square flex-col items-center justify-center rounded-md text-center",
                    forecastCellStyle(d.rate),
                  )}
                >
                  <span className="text-[9px] opacity-75">{weekday}</span>
                  <span className="text-sm font-semibold leading-none">{dayNum}</span>
                  <span className="text-[9px] opacity-90">%{d.rate}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-emerald-500" /> ≥70%
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-amber-400" /> 40–69%
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-rose-400" /> &lt;40%
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-muted" /> Boş
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ---------- Occupancy by property ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4 text-muted-foreground" /> Mülk Bazlı Doluluk
          </CardTitle>
        </CardHeader>
        <CardContent>
          {occByProperty.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Henüz mülk eklenmemiş.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2 font-medium">Mülk</th>
                    <th className="px-2 py-2 text-right font-medium">Bu Ay</th>
                    <th className="px-2 py-2 text-right font-medium">Geçen Ay</th>
                    <th className="py-2 pl-2 text-right font-medium">Değişim</th>
                  </tr>
                </thead>
                <tbody>
                  {occByProperty.map((p) => (
                    <tr key={p.propertyId} className="border-b border-border/50 last:border-0">
                      <td className="py-2.5 pr-2 font-medium">{p.propertyName}</td>
                      <td className="px-2 py-2.5 text-right">%{p.thisMonthRate}</td>
                      <td className="px-2 py-2.5 text-right text-muted-foreground">
                        %{p.lastMonthRate}
                      </td>
                      <td className="py-2.5 pl-2 text-right">
                        <span
                          className={cn(
                            "inline-flex items-center gap-0.5 font-medium",
                            p.delta > 0 && "text-emerald-600",
                            p.delta < 0 && "text-rose-600",
                            p.delta === 0 && "text-muted-foreground",
                          )}
                        >
                          {p.delta > 0 ? (
                            <ArrowUp className="size-3.5" />
                          ) : p.delta < 0 ? (
                            <ArrowDown className="size-3.5" />
                          ) : (
                            <Minus className="size-3.5" />
                          )}
                          {p.delta > 0 ? "+" : ""}
                          {p.delta}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- Operations overview ---------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Aylık Mesaj" value={monthly.messagesCount} icon={MessageSquare} />
        <StatCard label="Açık Görevler" value={stats.openTasks} icon={CheckCircle2} />
        <StatCard
          label="Acil Görevler"
          value={stats.urgentTasks}
          icon={AlertTriangle}
          tone={stats.urgentTasks > 0 ? "destructive" : "default"}
        />
        <StatCard
          label="Sorunlu Konuşmalar"
          value={stats.problemConversations}
          icon={AlertTriangle}
          tone={stats.problemConversations > 0 ? "destructive" : "default"}
        />
      </div>
    </>
  );
}
