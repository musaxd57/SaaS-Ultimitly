import {
  BedDouble,
  CalendarDays,
  MessageSquare,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Clock,
} from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOpsStats, getMonthlyReport } from "@/lib/reports";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";

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
  general: "Genel",
};

export default async function ReportsPage() {
  const session = await requireAuth();
  const orgId = session.organizationId;
  const now = new Date();

  const [stats, monthly, topIntentsRaw, overdueTasks] = await Promise.all([
    getOpsStats(orgId),
    getMonthlyReport(orgId),
    prisma.message.groupBy({
      by: ["aiIntent"],
      where: {
        conversation: { property: { organizationId: orgId } },
        aiIntent: { not: null },
      },
      _count: { aiIntent: true },
    }),
    prisma.task.count({
      where: {
        property: { organizationId: orgId },
        status: { not: "done" },
        dueAt: { lt: now },
      },
    }),
  ]);

  const topIntents = [...topIntentsRaw]
    .sort((a, b) => b._count.aiIntent - a._count.aiIntent)
    .slice(0, 6);
  const maxIntent = topIntents[0]?._count.aiIntent ?? 1;

  return (
    <>
      <PageHeader
        title="Raporlar"
        description={`Operasyon ve gelir görünümü · ${monthly.monthLabel}`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Doluluk (bugün)"
          value={`%${stats.occupancyRate}`}
          icon={BedDouble}
          hint={`${stats.occupiedToday}/${stats.totalProperties} mülk`}
        />
        <StatCard label="Aylık Rezervasyon" value={monthly.reservationsCount} icon={CalendarDays} />
        <StatCard label="Aylık Mesaj" value={monthly.messagesCount} icon={MessageSquare} />
        <StatCard
          label="Görev Tamamlama"
          value={`%${monthly.taskCompletionRate}`}
          icon={CheckCircle2}
          hint={`${monthly.completedTasks}/${monthly.totalTasks} görev`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Revenue */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="size-4 text-muted-foreground" /> Aylık Gelir
            </CardTitle>
          </CardHeader>
          <CardContent>
            {monthly.revenueByCurrency.length === 0 ? (
              <p className="text-sm text-muted-foreground">Bu ay için gelir kaydı yok.</p>
            ) : (
              <div className="space-y-3">
                {monthly.revenueByCurrency.map((r) => (
                  <div key={r.currency} className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{r.currency}</span>
                    <span className="text-lg font-semibold">{formatCurrency(r.total, r.currency)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top intents */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="size-4 text-muted-foreground" /> En Sık Konular
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topIntents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Henüz sınıflandırılmış mesaj yok. AI önerisi kullandıkça burası dolar.
              </p>
            ) : (
              <div className="space-y-2.5">
                {topIntents.map((t) => {
                  const label = t.aiIntent ? (INTENT_LABELS[t.aiIntent] ?? t.aiIntent) : "—";
                  const count = t._count.aiIntent;
                  return (
                    <div key={t.aiIntent} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span>{label}</span>
                        <span className="text-muted-foreground">{count}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${Math.round((count / maxIntent) * 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Operations overview */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Açık Görevler" value={stats.openTasks} icon={CheckCircle2} />
        <StatCard
          label="Acil Görevler"
          value={stats.urgentTasks}
          icon={AlertTriangle}
          tone={stats.urgentTasks > 0 ? "destructive" : "default"}
        />
        <StatCard
          label="Geciken Görevler"
          value={overdueTasks}
          icon={Clock}
          tone={overdueTasks > 0 ? "warning" : "default"}
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
