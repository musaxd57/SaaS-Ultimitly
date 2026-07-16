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
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOpsStats, buildDailySummary } from "@/lib/reports";
import { getConnectionInfo } from "@/lib/hospitable-credentials";
import { premiumAllowed } from "@/lib/billing/subscription";
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
    select: { timezone: true, aiSignature: true, autoReplyHospitable: true },
  });
  const { start: dayStart, end: dayEnd } = zonedDayRange(now, org?.timezone ?? "Europe/Istanbul");
  const scope = { property: { organizationId: orgId } };

  const [stats, arrivalsRaw, departuresRaw, conversations, tasksToday] = await Promise.all([
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
  ]);
  // "Bu Gece Kalan" = night-strict (occupied at end-of-today) via
  // getOpsStats.stayingTonight — a flat that checks out today with no re-let is
  // empty tonight and is NOT counted (distinct from the overlap-based occupancy%).
  // Label says "tonight", not "right now", so it matches that semantics exactly.
  const stayingCount = stats.stayingTonight;

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
  const [connection, conversationCount, kbCount, premiumOk] = await Promise.all([
    getConnectionInfo(orgId),
    prisma.conversation.count({ where: scope }),
    prisma.knowledgeBaseItem.count({ where: { isActive: true, ...scope } }),
    premiumAllowed(orgId),
  ]);
  const onboardingSteps: OnboardingStep[] = [
    {
      done: connection.connected,
      title: "Airbnb / Booking bağlantınızı kurun",
      desc: "Airbnb / Booking bağlantınızı Ayarlar'dan kurun — misafir mesajlarınız otomatik akmaya başlar.",
      href: "/settings#hospitable",
      cta: "Bağlantıyı kur",
    },
    {
      done: stats.totalProperties > 0,
      title: "Daireleriniz hazır olsun",
      desc: "Bağlantı kurulunca daireleriniz otomatik gelir; birkaç dakika sürebilir.",
      href: "/properties",
      cta: "Daireleri gör",
    },
    {
      done: kbCount > 0,
      title: "Bilgi tabanınızı doldurun",
      desc: "AI misafire buradaki bilgilerden cevap verir — Wi-Fi, giriş, otopark, kurallar. Hazır şablonlarla birkaç dakika sürer.",
      href: "/knowledge",
      cta: "Bilgi ekle",
    },
    {
      done: Boolean(org?.aiSignature?.trim()),
      title: "AI sesinizi ve imzanızı ayarlayın",
      desc: "AI'ın tonunu seçin ve mesaj imzanızı ekleyin — misafire sizin üslubunuzla yazsın.",
      href: "/settings",
      cta: "Ayarla",
    },
    {
      done: conversationCount > 0,
      title: "Gelen kutunuzu keşfedin",
      desc: "Her misafir mesajına AI hazır bir cevap önerir — tek tıkla gönderin ya da düzenleyin.",
      href: "/inbox",
      cta: "Gelen kutusu",
    },
    {
      // "Done" must mean AUTOMATION CAN ACTUALLY SEND, not just "toggle is on":
      // an expired trial (premium gate) or a platform master switch that is off
      // silently suppresses every send — showing this step as complete then
      // would be a lie (Codex audit finding).
      done:
        Boolean(org?.autoReplyHospitable) &&
        premiumOk &&
        process.env.AUTO_REPLY_ENABLED === "1",
      title: "Otomatik yanıtı açın",
      desc: "Hazır hissettiğinizde açın — basit sorular kendiliğinden yanıtlanır, şikayet gibi riskli konular her zaman size bırakılır.",
      href: "/inbox",
      cta: "Aç",
    },
  ];
  const onboardingDone = onboardingSteps.every((s) => s.done);

  // Sort today's tasks urgent-first, then by due time.
  const priorityRank: Record<string, number> = { urgent: 0, standard: 1, low: 2 };
  const sortedTasksToday = [...tasksToday].sort(
    (a, b) => (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1),
  );

  // Feed the summary the SAME deduped counts the cards/lists already show, so
  // the sentence count can never disagree with the visible numbers. Cap the
  // listed names to the first 3 (then "ve N diğer") so a busy day stays one
  // tidy line instead of dumping every guest name.
  const capGuests = (rows: { guestName: string; property: { name: string } }[]) => {
    const names = rows.slice(0, 3).map((r) => `${r.guestName} (${r.property.name})`).join(", ");
    const extra = rows.length - 3;
    return extra > 0 ? `${names} ve ${extra} diğer` : names;
  };
  // Use the shared helper for the stats sentences (with deduped counts), then
  // append our own capped name lists — the helper would otherwise dump every
  // name uncapped.
  const summaryParts = [
    buildDailySummary(
      { ...stats, arrivalsToday: arrivals.length, departuresToday: departures.length },
      [],
      [],
    ),
  ];
  if (arrivals.length > 0) summaryParts.push(`Girişler: ${capGuests(arrivals)}.`);
  if (departures.length > 0) summaryParts.push(`Çıkışlar: ${capGuests(departures)}.`);
  const summary = summaryParts.join(" ");

  // Guard against an empty/blank name so the greeting never shows a dangling
  // comma or trailing space (e.g. accounts created without a display name).
  const firstName = session.name?.trim().split(/\s+/)[0] ?? "";
  const greeting = firstName ? `Merhaba, ${firstName} 👋` : "Merhaba 👋";

  return (
    <>
      <PageHeader
        title={greeting}
        description={now.toLocaleDateString("tr-TR", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: org?.timezone ?? "Europe/Istanbul",
        })}
      />

      {/* Getting-started guide — only until the account is fully set up. */}
      {!onboardingDone ? <OnboardingGuide steps={onboardingSteps} /> : null}

      {/* AI daily summary — compact one-liner (same footprint as the tasks
          note): label and text share the line, no icon tile, p-3. */}
      <Card className="border-primary/20 bg-accent/40">
        <CardContent className="flex items-start gap-2.5 p-3 text-sm">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="text-muted-foreground">
            <strong className="text-foreground">AI Günlük Özet:</strong> {summary}
          </p>
        </CardContent>
      </Card>


      {/* Stat row — ONE row, no duplicates: arrivals/departures counts already
          live on the list cards right below (their badges), so tiles repeating
          them were pure filler. Every tile here is information the lists do NOT
          show, and every tile carries a hint line so none is a bare number. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Acil Görevler"
          value={stats.urgentTasks}
          icon={AlertTriangle}
          tone={stats.urgentTasks > 0 ? "destructive" : "default"}
          hint="acil öncelikli açık görev"
          href="/tasks"
        />
        <StatCard
          label="Bu Gece Kalan"
          value={stayingCount}
          icon={Users}
          hint="bu gece evde kalan misafir"
        />
        <StatCard
          label="Doluluk (bugün)"
          value={`%${stats.occupancyRate}`}
          icon={BedDouble}
          hint={`${stats.occupiedToday}/${stats.totalProperties} mülk dolu`}
          href="/reports"
        />
        <StatCard
          label="Sorunlu Konuşmalar"
          value={stats.problemConversations}
          icon={AlertTriangle}
          tone={stats.problemConversations > 0 ? "destructive" : "default"}
          hint="insan incelemesi bekleyen"
          href="/inbox?status=problem"
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
          <CardContent>
            {arrivals.length === 0 ? (
              <EmptyState title="Bugün giriş yok" className="py-6" />
            ) : (
              // Busy days (10-15+ arrivals) scroll INSIDE the card (~7 rows
              // visible) instead of stretching the whole page — the header
              // badge still shows the full count, nothing is hidden.
              <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {arrivals.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.guestName}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.property.name}</p>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-muted-foreground">
                    {r.property.checkInTime}
                  </span>
                </div>
              ))}
              </div>
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
          <CardContent>
            {departures.length === 0 ? (
              <EmptyState title="Bugün çıkış yok" className="py-6" />
            ) : (
              <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {departures.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.guestName}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.property.name}</p>
                  </div>
                  <div className="shrink-0 text-right">
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
              ))}
              </div>
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
                title={connection.connected ? "Bekleyen mesaj yok" : "Henüz mesaj yok"}
                description={
                  connection.connected
                    ? "Tüm konuşmalar güncel."
                    : "Airbnb / Booking bağlantısını kurunca misafir mesajları burada görünür."
                }
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
                    <p className="min-w-0 truncate text-sm font-medium">{c.guestIdentifier}</p>
                    <Badge tone={CONVERSATION_STATUS.tone(c.status)} className="shrink-0">
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

    </>
  );
}
