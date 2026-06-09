import Link from "next/link";
import { zonedDayRange } from "@/lib/automation";
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
import { Plug } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOpsStats, buildDailySummary } from "@/lib/reports";
import { getConnectionInfo } from "@/lib/hospitable-credentials";
import { OnboardingGuide, type OnboardingStep } from "@/components/onboarding-guide";
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
  // "Today" is the host's local calendar day (org timezone), not the server's
  // UTC day — otherwise arrivals/departures can land on the wrong date.
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { timezone: true, aiSignature: true },
  });
  const { start: dayStart, end: dayEnd } = zonedDayRange(now, org?.timezone ?? "Europe/Istanbul");
  const scope = { property: { organizationId: orgId } };

  const [stats, arrivalsRaw, departuresRaw, conversations, tasksToday, stayingRows] = await Promise.all([
    getOpsStats(orgId),
    prisma.reservation.findMany({
      where: {
        ...scope,
        status: { in: ["confirmed", "completed"] },
        arrivalDate: { gte: dayStart, lte: dayEnd },
      },
      include: { property: { select: { name: true, checkInTime: true } } },
      orderBy: { arrivalDate: "asc" },
    }),
    prisma.reservation.findMany({
      where: {
        ...scope,
        status: { in: ["confirmed", "completed"] },
        departureDate: { gte: dayStart, lte: dayEnd },
      },
      include: { property: { select: { name: true, checkOutTime: true } } },
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
    // Flats currently in-house — DISTINCT properties, so a turnover day (one guest
    // out + one in, same flat) counts once, never inflating the number.
    prisma.reservation.findMany({
      where: {
        ...scope,
        status: { in: ["confirmed", "completed"] },
        arrivalDate: { lte: dayEnd },
        departureDate: { gte: dayStart },
      },
      select: { propertyId: true },
      distinct: ["propertyId"],
    }),
  ]);
  const stayingCount = stayingRows.length;
  // The "Bekleyen Mesajlar" card must count the SAME statuses the list below it
  // shows (new + waiting + problem). openConversations is new+waiting only
  // (kept distinct for the daily report), so add the escalated complaints back
  // here — otherwise the headline number undercounts what's listed.
  const pendingMessages = stats.openConversations + stats.problemConversations;

  // Collapse duplicate Hospitable rows (same sourceReference) but keep each
  // manual/iCal booking (null sourceReference) — mirrors getOpsStats so the
  // cards and the lists agree and never undercount.
  const dedupeBookings = <T extends { sourceReference: string | null }>(rows: T[]): T[] => {
    const seen = new Set<string>();
    return rows.filter((r) => {
      if (r.sourceReference == null) return true;
      if (seen.has(r.sourceReference)) return false;
      seen.add(r.sourceReference);
      return true;
    });
  };
  const arrivals = dedupeBookings(arrivalsRaw);
  const departures = dedupeBookings(departuresRaw);

  // "Başlarken" onboarding: compute setup progress. The card only renders until
  // every step is done, then disappears for established accounts.
  const [connection, conversationCount] = await Promise.all([
    getConnectionInfo(orgId),
    prisma.conversation.count({ where: scope }),
  ]);
  const onboardingSteps: OnboardingStep[] = [
    {
      done: connection.connected,
      title: "Airbnb / Booking bağlantısını kur",
      desc: "Ayarlar'dan Hospitable token'ını bağla (ya da operatörün senin için bağlasın).",
      href: "/settings",
      cta: "Bağlantıyı kur",
      icon: Plug,
    },
    {
      done: stats.totalProperties > 0,
      title: "Dairelerin hazır olsun",
      desc: "Bağlantı kurulunca daireleriniz otomatik gelir; birkaç dakika sürebilir.",
      href: "/properties",
      cta: "Daireleri gör",
      icon: BedDouble,
    },
    {
      done: Boolean(org?.aiSignature?.trim()),
      title: "AI sesini ve imzanı ayarla",
      desc: "AI'ın tonunu seç ve mesaj imzanı ekle — misafire senin üslubunla yazsın.",
      href: "/settings",
      cta: "Ayarla",
      icon: Sparkles,
    },
    {
      done: conversationCount > 0,
      title: "Gelen kutusunu keşfet",
      desc: "Her misafir mesajına AI hazır bir cevap önerir — tek tıkla gönder ya da düzenle.",
      href: "/inbox",
      cta: "Gelen kutusu",
      icon: MessageSquare,
    },
  ];
  const onboardingDone = onboardingSteps.every((s) => s.done);

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

      {/* Getting-started guide — only until the account is fully set up. */}
      {!onboardingDone ? <OnboardingGuide steps={onboardingSteps} /> : null}

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
        <StatCard label="Bugünkü Girişler" value={arrivals.length} icon={LogIn} />
        <StatCard label="Bugünkü Çıkışlar" value={departures.length} icon={LogOut} />
        <StatCard
          label="Bekleyen Mesajlar"
          value={pendingMessages}
          icon={MessageSquare}
          tone={pendingMessages > 0 ? "warning" : "default"}
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
                  <div className="text-right">
                    <span className="text-sm font-medium text-muted-foreground">
                      {r.guestCheckoutTime ?? r.property.checkOutTime}
                    </span>
                    {r.guestCheckoutTime ? (
                      <span className="block text-[10px] font-medium text-emerald-600">
                        misafirin verdiği saat
                      </span>
                    ) : null}
                  </div>
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
