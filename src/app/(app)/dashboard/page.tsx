import Link from "next/link";
import { startOfDay, endOfDay } from "date-fns";
import {
  LogIn,
  LogOut,
  MessageSquare,
  AlertTriangle,
  Sparkles,
  BedDouble,
  CheckCircle2,
  ListChecks,
  Users,
} from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOpsStats, buildDailySummary } from "@/lib/reports";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { CONVERSATION_STATUS, PRIORITY, TASK_TYPE } from "@/lib/constants";
import { formatTime, truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireAuth();
  const orgId = session.organizationId;
  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const scope = { property: { organizationId: orgId } };

  const [stats, arrivals, departures, conversations, tasksToday, stayingCount] = await Promise.all([
    getOpsStats(orgId),
    prisma.reservation.findMany({
      where: {
        ...scope,
        status: { in: ["confirmed", "completed"] },
        arrivalDate: { gte: dayStart, lte: dayEnd },
      },
      include: { property: { select: { name: true, checkInTime: true } } },
      distinct: ["sourceReference"],
      orderBy: { arrivalDate: "asc" },
    }),
    prisma.reservation.findMany({
      where: {
        ...scope,
        status: { in: ["confirmed", "completed"] },
        departureDate: { gte: dayStart, lte: dayEnd },
      },
      include: { property: { select: { name: true, checkOutTime: true } } },
      distinct: ["sourceReference"],
      orderBy: { departureDate: "asc" },
    }),
    prisma.conversation.findMany({
      where: { ...scope, status: { in: ["new", "waiting", "problem"] } },
      include: {
        property: { select: { name: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { lastMessageAt: "desc" },
      take: 5,
    }),
    // Tasks due today (any priority) — the operational "to-do for today".
    prisma.task.findMany({
      where: { ...scope, status: { not: "done" }, dueAt: { gte: dayStart, lte: dayEnd } },
      include: { property: { select: { name: true } } },
      orderBy: { dueAt: "asc" },
    }),
    // Guests currently in-house (arrived and not yet departed).
    prisma.reservation.count({
      where: {
        ...scope,
        status: { in: ["confirmed", "completed"] },
        arrivalDate: { lte: dayEnd },
        departureDate: { gte: dayStart },
      },
    }),
  ]);

  // Sort today's tasks urgent-first, then by due time.
  const priorityRank: Record<string, number> = { urgent: 0, standard: 1, low: 2 };
  const sortedTasksToday = [...tasksToday].sort(
    (a, b) => (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1),
  );

  const summary = buildDailySummary(
    stats,
    arrivals.map((a) => ({ guestName: a.guestName, propertyName: a.property.name })),
    departures.map((d) => ({ guestName: d.guestName, propertyName: d.property.name })),
  );

  return (
    <>
      <PageHeader
        title={`Merhaba, ${session.name.split(" ")[0]} 👋`}
        description={now.toLocaleDateString("tr-TR", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })}
      />


      {/* AI daily summary */}
      <Card className="border-primary/20 bg-accent/40">
        <CardContent className="flex gap-3 p-5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">AI Günlük Operasyon Özeti</p>
            <p className="text-sm text-muted-foreground">{summary}</p>
          </div>
        </CardContent>
      </Card>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Bugünkü Girişler" value={stats.arrivalsToday} icon={LogIn} />
        <StatCard label="Bugünkü Çıkışlar" value={stats.departuresToday} icon={LogOut} />
        <StatCard
          label="Bekleyen Mesajlar"
          value={stats.openConversations}
          icon={MessageSquare}
          tone={stats.openConversations > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Acil Görevler"
          value={stats.urgentTasks}
          icon={AlertTriangle}
          tone={stats.urgentTasks > 0 ? "destructive" : "default"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Arrivals */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <LogIn className="size-4 text-muted-foreground" /> Bugünkü Girişler
            </CardTitle>
            <Badge tone="muted">{arrivals.length}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {arrivals.length === 0 ? (
              <EmptyState title="Bugün giriş yok" className="py-6" />
            ) : (
              arrivals.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium">{r.guestName}</p>
                    <p className="text-xs text-muted-foreground">{r.property.name}</p>
                  </div>
                  <span className="text-sm font-medium text-muted-foreground">
                    {r.property.checkInTime}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Departures */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <LogOut className="size-4 text-muted-foreground" /> Bugünkü Çıkışlar
            </CardTitle>
            <Badge tone="muted">{departures.length}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {departures.length === 0 ? (
              <EmptyState title="Bugün çıkış yok" className="py-6" />
            ) : (
              departures.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium">{r.guestName}</p>
                    <p className="text-xs text-muted-foreground">{r.property.name}</p>
                  </div>
                  <span className="text-sm font-medium text-muted-foreground">
                    {r.guestCheckoutTime ?? r.property.checkOutTime}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Pending messages */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="size-4 text-muted-foreground" /> Bekleyen Mesajlar
            </CardTitle>
            <Link href="/inbox" className="text-xs font-medium text-primary hover:underline">
              Tümü
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {conversations.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="Bekleyen mesaj yok"
                description="Tüm konuşmalar güncel."
                className="py-6"
              />
            ) : (
              conversations.map((c) => (
                <Link
                  key={c.id}
                  href={`/inbox/${c.id}`}
                  className="block rounded-lg border border-border px-3 py-2 hover:bg-accent"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{c.guestIdentifier}</p>
                    <Badge tone={CONVERSATION_STATUS.tone(c.status)}>
                      {CONVERSATION_STATUS.label(c.status)}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {c.messages[0] ? truncate(c.messages[0].body, 70) : c.property.name}
                  </p>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Today's tasks */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="size-4 text-muted-foreground" /> Bugünkü Görevler
            </CardTitle>
            <Link href="/tasks" className="text-xs font-medium text-primary hover:underline">
              Tümü
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {sortedTasksToday.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="Bugün görev yok"
                description="Bugün için planlanmış iş bulunmuyor."
                className="py-6"
              />
            ) : (
              sortedTasksToday.map((t) => (
                <Link
                  key={t.id}
                  href="/tasks"
                  className="block rounded-lg border border-border px-3 py-2 hover:bg-accent"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{t.title}</p>
                    <Badge tone={PRIORITY.tone(t.priority)}>{PRIORITY.label(t.priority)}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {TASK_TYPE.label(t.type)} · {t.property.name}
                    {t.dueAt ? ` · ${formatTime(t.dueAt)}` : ""}
                  </p>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Secondary stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Şu An Konaklayan"
          value={stayingCount}
          icon={Users}
          hint="evde olan misafir"
        />
        <StatCard
          label="Doluluk (bugün)"
          value={`%${stats.occupancyRate}`}
          icon={BedDouble}
          hint={`${stats.occupiedToday}/${stats.totalProperties} mülk dolu`}
        />
        <StatCard label="Açık Görevler" value={stats.openTasks} icon={CheckCircle2} />
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
