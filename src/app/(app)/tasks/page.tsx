import Link from "next/link";
import { ListChecks, Plus } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/ui/link-button";
import { EmptyState } from "@/components/empty-state";
import { TaskBoard, type TaskCardData } from "@/components/tasks/task-board";
import { BackfillTasksButton } from "@/components/tasks/backfill-button";
import { formatDateTime, safeJsonParse, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ChecklistItem = { label: string; done: boolean };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string }>;
}) {
  const session = await requireAuth();
  const { propertyId } = await searchParams;

  const [tasks, properties] = await Promise.all([
    prisma.task.findMany({
      where: {
        property: { organizationId: session.organizationId },
        ...(propertyId ? { propertyId } : {}),
      },
      include: {
        property: { select: { name: true } },
        assignedTo: { select: { name: true } },
        updates: {
          select: { photoUrl: true, note: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    }),
    prisma.property.findMany({
      where: { organizationId: session.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const cards: TaskCardData[] = tasks.map((t) => {
    const checklist = safeJsonParse<ChecklistItem[]>(t.checklistJson, []);
    const latestUpdate = t.updates[0] ?? null;
    return {
      id: t.id,
      title: t.title,
      type: t.type,
      priority: t.priority,
      status: t.status,
      propertyName: t.property.name,
      assigneeName: t.assignedTo?.name ?? null,
      dueLabel: t.dueAt ? formatDateTime(t.dueAt) : null,
      checklist:
        checklist.length > 0
          ? { done: checklist.filter((c) => c.done).length, total: checklist.length }
          : null,
      latestPhotoUrl: latestUpdate?.photoUrl ?? null,
      latestNote: latestUpdate?.note ?? null,
    };
  });

  return (
    <>
      <PageHeader title="Görevler" description="Temizlik, bakım ve check-in görevlerini yönetin.">
        <BackfillTasksButton />
        <LinkButton href="/tasks/new">
          <Plus className="size-4" /> Yeni görev
        </LinkButton>
      </PageHeader>

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
          description="Mevcut rezervasyonlarınız için görev oluşturmak üzere yukarıdaki “Rezervasyonlardan oluştur” düğmesine basın. Yeni rezervasyonlarda görevler otomatik açılır."
        >
          <LinkButton href="/tasks/new" size="sm">
            <Plus className="size-4" /> Görev ekle
          </LinkButton>
        </EmptyState>
      ) : (
        <TaskBoard tasks={cards} />
      )}
    </>
  );
}
