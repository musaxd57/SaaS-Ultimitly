import Link from "next/link";
import { checkoutTimesFor, type CheckoutTime } from "@/lib/tasks/checkout-times";
import { reportError } from "@/lib/report-error";
import { redirect } from "next/navigation";
import { ListChecks, Plus, Sparkles } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Pager } from "@/components/pager";
import { LinkButton } from "@/components/ui/link-button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { TaskBoard, type TaskCardData } from "@/components/tasks/task-board";
import { BackfillTasksButton } from "@/components/tasks/backfill-button";
import { cn } from "@/lib/utils";
import { countReservationsMissingCleaning } from "@/lib/tasks/missing-cleaning";
import { orgTimezone } from "@/lib/timezone";
import { clampPage, MAX_LIST_PAGE } from "@/lib/pagination";
import { latestRenderablePhotoByTask } from "@/lib/storage/keys";
import { taskCardData } from "@/lib/tasks/card-data";
import { TASK_BOARD_INCLUDE } from "@/lib/tasks/board-include";

export const dynamic = "force-dynamic";

// Görev panosu bir KANBAN — panonun TAMAMINI sayfalamak yanlış araç olurdu
// (sayfa 2'deki "Yapılacak" kartı görünmezse iş kaybolur). Sınırsız büyüme zaten
// TAMAMEN "Tamamlandı" sütununda: aktif iş gerçek operasyonla doğal olarak
// sınırlıdır, biten görevler ise sonsuza dek birikir. Bu yüzden aktif kartların
// HEPSİ yüklenir; yalnız TAMAMLANANLAR sayfalanır.
//
// Neden tavan değil sayfalama (Codex): sabit bir tavan, sayıyı ekranda yazsa
// bile eski kayıtları ERİŞİLEMEZ bırakıyordu. "Gizli" demek erişim sağlamaz —
// sütun sayfalanınca tavan tamamen kalkar ve geçmişin tamamı gezilebilir.
const DONE_PAGE_SIZE = 50;

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

  const donePage = clampPage(
    Array.isArray(sp.tamamlanan) ? sp.tamamlanan[0] : sp.tamamlanan,
    MAX_LIST_PAGE,
  );
  const taskWhere = {
    property: { organizationId: session.organizationId },
    // Staff see ONLY tasks assigned to them (they don't get the whole board).
    ...(canManage ? {} : { assignedToId: session.userId }),
    ...(propertyId ? { propertyId } : {}),
  };
  // Kart sorgusu tek kaynak (`tasks/board-include.ts`): "son not" NOTU OLAN en son satırdan (Tur 6 T6-SU-2).
  const taskInclude = TASK_BOARD_INCLUDE;

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
      skip: (donePage - 1) * DONE_PAGE_SIZE,
      take: DONE_PAGE_SIZE,
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
    // Gün kuralı ve "zaten var mı?" kuralı görev oluşturmayla AYNI (`countReservationsMissingCleaning`, kurucu D7).
    canManage
      ? countReservationsMissingCleaning(session.organizationId, new Date(), TZ)
      : Promise.resolve(0),
  ]);

  // Drives the Bugün / Bu hafta / Bu ay filter. Each task is bucketed by the
  // calendar day of its dueAt under the SINGLE DATE RULE (`calendarDateOf`, via
  // `taskCardData`) — the SAME basis the card's date label uses — so a task shown
  // as "10 Haz" always lands in "Bugün" on the 10th (the host's local day): a
  // date-only anchor (00:00Z / 12:00Z) is its UTC date, a real instant its org-local day.
  const now = new Date();

  // Panoya tek dizi gider (bileşen zaten duruma göre sütunlara ayırıyor);
  // sütun İÇİ sıralama böylece doğru kalır: aktif iş en yakın tarihli önce,
  // tamamlananlar en yeni önce.
  const tasks = [...activeTasks, ...doneTasks];
  const doneHref = (p: number) => {
    const q = new URLSearchParams();
    if (propertyId) q.set("propertyId", propertyId);
    if (p > 1) q.set("tamamlanan", String(p));
    const qs = q.toString();
    return qs ? `/tasks?${qs}` : "/tasks";
  };

  // Taşan sayfa numarası, toplam BİLİNDİKTEN sonra son geçerli sayfaya çekilir
  // (Codex P3 — URL/UX temizliği). Yalnız "geri dön" düğmesi koymak yetmezdi:
  // ?tamamlanan=999999'da "Önceki" bir sonraki BOŞ sayfaya giderdi, yani çıkış
  // tek tık olmazdı. Döngü riski yok — hedef lastDonePage'dir ve koşul yalnız
  // donePage > lastDonePage iken kurulur (yönlendirme sonrası eşit olur).
  const lastDonePage = Math.max(1, Math.ceil(doneTotal / DONE_PAGE_SIZE));
  if (donePage > lastDonePage) redirect(doneHref(lastDonePage));

  const doneFrom = doneTasks.length === 0 ? 0 : (donePage - 1) * DONE_PAGE_SIZE + 1;
  const doneTo = doneTasks.length === 0 ? 0 : (donePage - 1) * DONE_PAGE_SIZE + doneTasks.length;

  // The LATEST PHOTO, which is not the same thing as the photo on the latest
  // update. Every note, photo and status change writes its own TaskUpdate row,
  // so a note saved after a photo produced a newer row carrying note-but-no-
  // photo — and the card, reading only that newest row, stopped showing a
  // cleaning photo that was still perfectly well stored. The proof appeared to
  // vanish the moment someone wrote "yapıldı" next to it.
  //
  // Scoped to the tasks actually on screen and ordered newest-first, so the
  // first row seen for a task is its most recent photo.
  const photoRows = await prisma.taskUpdate.findMany({
    where: { taskId: { in: tasks.map((t) => t.id) }, photoUrl: { not: null } },
    select: { taskId: true, photoUrl: true },
    orderBy: { createdAt: "desc" },
  });
  // Yalnız bu org'un gerçek yükleme yolları çizilir (09-23: eski dönemden kalan keyfi
  // aynı-kaynak yolu sahibin panosunda `<img src>` olarak TIKSIZ GET üretirdi).
  const latestPhotoByTask = latestRenderablePhotoByTask(photoRows, session.organizationId);

  // "Yapılamıyor" görevlerin EN SON bildirimi (kim · ne zaman · neden) — kurucu 11-05 gece. Ekrandaki görevlerle sınırlı, org kapsamlı.
  const blockedIds = tasks.filter((t) => t.status === "blocked").map((t) => t.id);
  const blockedRows = blockedIds.length
    ? await prisma.taskUpdate.findMany({
        where: { taskId: { in: blockedIds }, status: "blocked", task: { property: { organizationId: session.organizationId } } },
        select: { taskId: true, note: true, createdAt: true, user: { select: { name: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
    : [];
  const blockedByTask = new Map<string, { by: string | null; at: Date; reason: string | null }>();
  for (const r of blockedRows) {
    if (!blockedByTask.has(r.taskId)) blockedByTask.set(r.taskId, { by: r.user?.name ?? null, at: r.createdAt, reason: r.note });
  }
  // Temizlik kartında misafirin çıkış saati (kurucu 11-05 gece: geç çıkış onayı temizlik saatine bağlanır). Hazırlık hükmüyle AYNI kural:
  // mülk saati · misafir beyanı · onaylı geç çıkış'tan en geçi. Kopya değil — rezervasyon / onay değişince kart kendiliğinden güncel.
  const cleaningResIds = [...new Set(tasks.filter((t) => t.type === "cleaning" && t.status !== "done" && t.reservationId).map((t) => t.reservationId as string))];
  // Yardımcı satır: okunamazsa pano YİNE açılır, satır çizilmez (raporlanır — Haiku 11-06).
  const checkoutByRes = await checkoutTimesFor(session.organizationId, cleaningResIds).catch((err) => {
    void reportError("tasks-page.checkout-times", err);
    return new Map<string, CheckoutTime>();
  });
  // Yönetici kartında "Atanan" seçimi: işletmenin kişileri (personel listesi personele gösterilmez).
  const members = canManage
    ? await prisma.user.findMany({ where: { organizationId: session.organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    : [];

  const cards: TaskCardData[] = tasks.map((t) =>
    taskCardData(t, {
      canManage,
      timeZone: TZ,
      now,
      latestPhotoUrl: latestPhotoByTask.get(t.id) ?? null,
      blocked: blockedByTask.get(t.id) ?? null,
      checkout: t.reservationId ? (checkoutByRes.get(t.reservationId) ?? null) : null,
    }),
  );

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
            <strong className="text-foreground">Görevler otomatik açılır:</strong> her rezervasyonda
            giriş hazırlığı ve çıkış temizliği eklenir; eksik olursa üstte “Eksik görevleri oluştur”
            belirir. “Yeni görev” ile elle de ekleyebilirsiniz.
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

      {/* "Görev yok" YALNIZ gerçekten hiç görev yokken. Tamamlananlarda son sayfayı
          aşmış bir ?tamamlanan= değeri bu ekranı yanlış gösterirdi (kayıt var ama
          bu pencerede yok) — o durumda pano + sayfalayıcı render edilir ki
          kullanıcı geri dönebilsin. */}
      {activeTasks.length === 0 && doneTotal === 0 ? (
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
          <TaskBoard tasks={cards} canManage={canManage} members={members} />
          {/* Yalnız "Tamamlandı" sütunu sayfalanır — aktif iş hiç sınırlanmaz.
              Aralık + GERÇEK toplam yazılı ve geçmişin TAMAMI gezilebilir:
              tavan yok, dolayısıyla erişilemez eski kayıt da yok. */}
          {doneTotal > DONE_PAGE_SIZE ? (
            <Pager
              page={donePage}
              totalPages={Math.max(1, Math.ceil(doneTotal / DONE_PAGE_SIZE))}
              summary={`Tamamlandı: ${doneFrom}–${doneTo} / ${doneTotal}`}
              hrefFor={doneHref}
              position="üst"
            />
          ) : null}
        </>
      )}
    </>
  );
}
