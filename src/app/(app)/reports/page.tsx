import {
  Sparkles,
  MessageSquare,
  LogIn,
  LogOut,
  AlertTriangle,
  Trophy,
  BedDouble,
} from "lucide-react";
import { requireAuth } from "@/lib/auth";
import {
  getAiOpsReport,
  getTopTopics,
  getHostPerformanceScore,
  getOccupancyByProperty,
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
  cleaning: "Temizlik",
  amenity: "Ekipman / Eşya",
  complaint: "Şikayet",
  refund: "İade",
  general: "Genel",
};

export default async function ReportsPage() {
  const { organizationId } = await requireAuth();

  const [ai, topics, score, occupancy] = await Promise.all([
    getAiOpsReport(organizationId),
    getTopTopics(organizationId, 6),
    getHostPerformanceScore(organizationId),
    getOccupancyByProperty(organizationId),
  ]);

  const maxTopic = Math.max(1, ...topics.map((t) => t.count));

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
