import Link from "next/link";
import { ListChecks, Plus, Sparkles } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/ui/link-button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { TaskBoard, type TaskCardData } from "@/components/tasks/task-board";
import { BackfillTasksButton } from "@/components/tasks/backfill-button";
import { safeJsonParse, cn, daysUntilDate, formatDayInTz } from "@/lib/utils";
import { zonedDayRange } from "@/lib/automation";
import { orgTimezone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

// Görev panosu bir KANBAN — sayfalama burada yanlış araç olurdu (sayfa 2'deki
// "Yapılacak" kartı görünmezse iş kaybolur). Sınırsız büyüme zaten TAMAMEN
// "Tamamlandı" sütununda: aktif iş gerçek operasyonla doğal olarak sınırlıdır,
// biten görevler ise sonsuza dek birikir. Bu yüzden aktif kartların HEPSİ
// yüklenir, tamamlananlar en yeniden başlayarak sınırlanır ve sınır EKRANDA
// SÖYLENİR.
const DONE_LIMIT = 50;
const DONE_LIMIT_EXPANDED = 500;

type ChecklistItem = { label: string; done: boolean };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string; tamamlanan?: string }>;
}) {
  const session = await requireAuth();
  const canManage = session.role === "owner" || session.role === "manager";
  const sp = await searchParams;
  // A repeated ?propertyId= param arrives as string[] at runtime; take the first
  // so a bare array never reaches Prisma on this scalar field (would throw).
  const propertyId = Array.isArray(sp.propertyId) ? sp.propertyId[0] : sp.propertyId;

  // Day bucketing ("Bugün" filter, cleaning-gap count) follows the HOST'S
  // calendar day (org.timezone; default Istanbul — unchanged for existing orgs).
  const orgRow = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { timezone: true },
  });
  const TZ = orgTimezone(orgRow?.timezone);

  const expandedDone = (Array.isArray(sp.tamamlanan) ? sp.tamamlanan[0] : sp.tamamlanan) === "hepsi";
  const doneLimit = expandedDone ? DONE_LIMIT_EXPANDED : DONE_LIMIT;
  const taskWhere = {
    property: { organizationId: session.organizationId },
    // Staff see ONLY tasks assigned to them (they don't get the whole board).
    ...(canManage ? {} : { assignedToId: session.userId }),
    ...(propertyId ? { propertyId } : {}),
  };
  const taskInclude = {
    property: { select: { name: true } },
    assignedTo: { select: { name: true } },
    updates: {
      select: { photoUrl: true, note: true, createdAt: true },
      orderBy: { createdAt: "desc" as const },
      take: 1,
    },
  };

  const [activeTasks, doneTasks, doneTotal, properties, reservationsMissingTasks] = await Promise.all([
    // AKTİF iş: tamamı yüklenir — bir hostun bekleyen görevi asla gizlenmemeli.
    prisma.task.findMany({
      where: { ...taskWhere, status: { not: "done" } },
      include: taskInclude,
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    }),
    // TAMAMLANAN geçmiş: en yeniden başlayarak sınırlı (tam sıra — eşit damgada
    // sınırın kayması kartı görünmez yapardı).
    prisma.task.findMany({
      where: { ...taskWhere, status: "done" },
      include: taskInclude,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: doneLimit,
    }),
    prisma.task.count({ where: { ...taskWhere, status: "done" } }),
    // Property filter chips: managers see the whole portfolio; STAFF must only
    // see the properties of tasks assigned to them — the full org property list
    // is business-internal (Codex staff-leak finding).
    canManage
      ? prisma.property.findMany({
          where: { organizationId: session.organizationId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : prisma.property.findMany({
          where: {
            organizationId: session.organizationId,
            tasks: { some: { assignedToId: session.userId } },
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
    // Current/future checkouts still missing their CLEANING task — so the backfill
    // button appears and one click fills the gap. MANAGER-ONLY: the org-wide count
    // (and the backfill button itself) is management UI; staff must not see it.
    canManage
      ? prisma.reservation.count({
          where: {
            property: { organizationId: session.organizationId },
            status: { not: "cancelled" },
            tasks: { none: { type: "cleaning" } },
            departureDate: { gte: zonedDayRange(new Date(), TZ).start },
          },
        })
      : Promise.resolve(0),
  ]);

  // Drives the Bugün / Bu hafta / Bu ay filter. Each task is bucketed by the
  // org-local calendar day of its dueAt (daysUntilDate) — the SAME basis the
  // card's date label uses (formatDayInTz) — so a task shown as "10 Haz" always
  // lands in "Bugün" on the 10th (the host's local day), no matter what
  // time-of-day it was stored at (UTC-midnight, iCal local-noon, or local-midnight).
  const now = new Date();

  // Panoya tek dizi gider (bileşen zaten duruma göre sütunlara ayırıyor);
  // sütun İÇİ sıralama böylece doğru kalır: aktif iş en yakın tarihli önce,
  // tamamlananlar en yeni önce.
  const tasks = [...activeTasks, ...doneTasks];
  const hiddenDone = doneTotal - doneTasks.length;

  const cards: TaskCardData[] = tasks.map((t) => {
    const parsedChecklist = safeJsonParse<ChecklistItem[]>(t.checklistJson, []);
    // Guard against a stored non-array JSON scalar (e.g. "foo") slipping past
    // safeJsonParse — .length/.filter on a non-array would 500 the page.
    const checklist = Array.isArray(parsedChecklist) ? parsedChecklist : [];
    const latestUpdate = t.updates[0] ?? null;
    return {
      id: t.id,
      title: t.title,
      type: t.type,
      priority: t.priority,
      status: t.status,
      propertyName: t.property.name,
      assigneeName: t.assignedTo?.name ?? null,
      dueLabel: t.dueAt ? formatDayInTz(t.dueAt, TZ) : null,
      dueDays: t.dueAt ? daysUntilDate(t.dueAt, now, TZ) : null,
      checklist: checklist.length > 0 ? { items: checklist } : null,
      latestPhotoUrl: latestUpdate?.photoUrl ?? null,
      latestNote: latestUpdate?.note ?? null,
    };
  });

  return (
    <>
      <PageHeader title="Görevler" description="Temizlik, bakım ve check-in görevlerini yönetin.">
        {canManage && reservationsMissingTasks > 0 ? (
          <BackfillTasksButton count={reservationsMissingTasks} />
        ) : null}
        {canManage ? (
          <LinkButton href="/tasks/new">
            <Plus className="size-4" /> Yeni görev
          </LinkButton>
        ) : null}
      </PageHeader>

      {/* Compact one-liner (was a tall always-open explainer card pushing the
          board below the fold — the board IS the page, the note is a footnote). */}
      <Card className="border-primary/20 bg-accent/40">
        <CardContent className="flex items-center gap-2.5 p-3 text-sm">
          <Sparkles className="size-4 shrink-0 text-primary" />
          <p className="text-muted-foreground">
            <strong className="text-foreground">Görevleri AI yönetir:</strong> her rezervasyonda
            check-in hazırlık + çıkış temizliği otomatik açılır; eksik olursa üstte “Eksik görevleri
            oluştur” belirir. “Yeni görev” ile elle de ekleyebilirsiniz.
          </p>
        </CardContent>
      </Card>

      {properties.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          <Link
            href="/tasks"
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              !propertyId
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-accent",
            )}
          >
            Tümü
          </Link>
          {properties.map((p) => (
            <Link
              key={p.id}
              href={`/tasks?propertyId=${p.id}`}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                propertyId === p.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-accent",
              )}
            >
              {p.name}
            </Link>
          ))}
        </div>
      ) : null}

      {tasks.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Görev yok"
          description={
            canManage
              ? "Yeni rezervasyonlarda görevler otomatik açılır. Eksik kalan varsa aşağıdan elle de görev ekleyebilirsiniz."
              : "Yeni rezervasyonlarda görevler otomatik açılır. Size atanmış bir görev olduğunda burada listelenir."
          }
        >
          {/* Staff can't create tasks (/tasks/new redirects them back) — only show
              the button to managers/owners so it never dead-ends. */}
          {canManage ? (
            <LinkButton href="/tasks/new" size="sm">
              <Plus className="size-4" /> Görev ekle
            </LinkButton>
          ) : null}
        </EmptyState>
      ) : (
        <>
          <TaskBoard tasks={cards} canManage={canManage} />
          {/* Sınır SESSİZ DEĞİL: kaç tamamlanmış görevin gizlendiği yazılı ve
              açma yolu var. Aktif iş hiç sınırlanmaz, o yüzden burada yalnız
              "Tamamlandı" sütunundan söz edilir. */}
          {hiddenDone > 0 ? (
            <p className="pt-3 text-xs text-muted-foreground">
              Tamamlanan {doneTotal} görevin en yeni {doneTasks.length} tanesi gösteriliyor;{" "}
              {hiddenDone} tanesi gizli.{" "}
              {expandedDone ? (
                <>Bu daire için görüntüleme tavanına ({DONE_LIMIT_EXPANDED}) ulaşıldı.</>
              ) : (
                <Link
                  href={propertyId ? `/tasks?propertyId=${propertyId}&tamamlanan=hepsi` : "/tasks?tamamlanan=hepsi"}
                  className="text-primary hover:underline"
                >
                  Daha fazlasını göster
                </Link>
              )}
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
