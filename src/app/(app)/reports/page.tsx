import {
  Sparkles,
  MessageSquare,
  LogIn,
  LogOut,
  AlertTriangle,
  Trophy,
  BedDouble,
  Wallet,
} from "lucide-react";
import { requireAuth } from "@/lib/auth";
import {
  getAiOpsReport,
  getTopTopics,
  getHostPerformanceScore,
  getOccupancyByProperty,
  getRevenueAnalytics,
} from "@/lib/reports";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

// Friendly Turkish labels for the AI intent taxonomy.
const INTENT_LABEL: Record<string, string> = {
  wifi: "Wi-Fi",
  parking: "Otopark",
  location: "Konum / Yol tarifi",
  checkin: "Giriş",
  checkout: "Çıkış",
  early_checkin: "Erken giriş",
  late_checkout: "Geç çıkış",
  early_departure: "Erken ayrılma",
  human_request: "Ev sahibi talebi",
  cleaning: "Temizlik",
  amenity: "Ekipman / Eşya",
  complaint: "Şikayet",
  refund: "İade",
  general: "Genel",
};

export default async function ReportsPage() {
  const { organizationId } = await requireAuth();

  const [ai, topics, score, occupancy, revenue] = await Promise.all([
    getAiOpsReport(organizationId),
    getTopTopics(organizationId, 6),
    getHostPerformanceScore(organizationId),
    getOccupancyByProperty(organizationId),
    getRevenueAnalytics(organizationId, 6),
  ]);

  const maxTopic = Math.max(1, ...topics.map((t) => t.count));

  // Pick the dominant currency over the 6-month window for the revenue chart.
  const currencyTotals = new Map<string, number>();
  for (const m of revenue) {
    for (const c of m.byCurrency) currencyTotals.set(c.currency, (currencyTotals.get(c.currency) ?? 0) + c.total);
  }
  const primaryCurrency = [...currencyTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "EUR";
  const monthly = revenue.map((m) => ({
    label: m.monthLabel,
    total: m.byCurrency.find((c) => c.currency === primaryCurrency)?.total ?? 0,
  }));
  const maxRevenue = Math.max(1, ...monthly.map((m) => m.total));
  const thisMonthRevenue = monthly[monthly.length - 1]?.total ?? 0;
  const hasRevenue = currencyTotals.size > 0 && [...currencyTotals.values()].some((v) => v > 0);
  const fmtMoney = (n: number) =>
    new Intl.NumberFormat("tr-TR", { style: "currency", currency: primaryCurrency, maximumFractionDigits: 0 }).format(n);

  return (
    <>
      <PageHeader
        title="Raporlar"
        description="AI performansı, şikayet yoğunluğu ve operasyon metrikleri — son 30 gün."
      />

      {/* AI & automation activity */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="AI Cevapları" value={ai.aiReplies} icon={Sparkles} />
        <StatCard label="Karşılama" value={ai.welcomes} icon={MessageSquare} />
        <StatCard label="Giriş Bilgileri" value={ai.checkins} icon={LogIn} />
        <StatCard label="Çıkış Mesajları" value={ai.checkouts} icon={LogOut} />
      </div>

      {/* Revenue */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="size-4 text-muted-foreground" /> Gelir — Son 6 Ay
          </CardTitle>
          {hasRevenue ? (
            <div className="text-right">
              <p className="text-xl font-semibold">{fmtMoney(thisMonthRevenue)}</p>
              <p className="text-[11px] text-muted-foreground">bu ay (giriş tarihine göre)</p>
            </div>
          ) : null}
        </CardHeader>
        <CardContent>
          {!hasRevenue ? (
            <EmptyState
              title="Henüz gelir verisi yok"
              description="Rezervasyonlarınız bağlandıkça (Airbnb/Booking tutarları) gelir burada görünür."
              className="py-6"
            />
          ) : (
            <div className="space-y-2.5">
              {monthly.map((m) => (
                <div key={m.label} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">{m.label}</span>
                  <div className="h-5 flex-1 overflow-hidden rounded bg-muted">
                    <div
                      className="flex h-full items-center rounded bg-primary/80 px-2"
                      style={{ width: `${Math.max(6, (m.total / maxRevenue) * 100)}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-sm font-medium">{fmtMoney(m.total)}</span>
                </div>
              ))}
              {currencyTotals.size > 1 ? (
                <p className="pt-1 text-[11px] text-muted-foreground">
                  Not: birden fazla para birimi var; grafik {primaryCurrency} bazında gösteriliyor.
                </p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Host performance + response time */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="size-4 text-muted-foreground" /> Performans Skoru
            </CardTitle>
            {score.hasData ? <Badge tone="success">{score.grade}</Badge> : null}
          </CardHeader>
          <CardContent className="space-y-2">
            {score.hasData ? (
              <>
                <p className="text-3xl font-semibold">{score.score}/100</p>
                <p className="text-sm text-muted-foreground">{score.label}</p>
              </>
            ) : (
              <EmptyState title="Skor için yeterli veri yok" className="py-6" />
            )}
          </CardContent>
        </Card>

        {/* Top guest topics */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="size-4 text-muted-foreground" /> En Çok Sorulanlar
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {topics.length === 0 ? (
              <EmptyState title="Henüz veri yok" className="py-6" />
            ) : (
              topics.map((t) => (
                <div key={t.intent} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{INTENT_LABEL[t.intent] ?? t.intent}</span>
                    <span className="text-muted-foreground">{t.count}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(t.count / maxTopic) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Complaints by property */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-muted-foreground" /> Açık Şikayetler (daireye göre)
            </CardTitle>
            <Badge tone={ai.openProblems > 0 ? "destructive" : "muted"}>{ai.openProblems}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {ai.problemsByProperty.length === 0 ? (
              <EmptyState title="Açık şikayet yok 🎉" className="py-6" />
            ) : (
              ai.problemsByProperty.map((p) => (
                <div
                  key={p.propertyName}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span className="font-medium">{p.propertyName}</span>
                  <Badge tone="destructive">{p.count}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Occupancy by property */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BedDouble className="size-4 text-muted-foreground" /> Doluluk (daireye göre)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {occupancy.length === 0 ? (
              <EmptyState title="Henüz veri yok" className="py-6" />
            ) : (
              occupancy.map((o) => (
                <div
                  key={o.propertyId}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span className="font-medium">{o.propertyName}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground">%{o.thisMonthRate} bu ay</span>
                    {o.delta !== 0 ? (
                      <Badge tone={o.delta > 0 ? "success" : "muted"}>
                        {o.delta > 0 ? "+" : ""}
                        {o.delta}
                      </Badge>
                    ) : null}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
