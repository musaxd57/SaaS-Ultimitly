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

export const dynamic = "force-dynamic";

type ChecklistItem = { label: string; done: boolean };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string }>;
}) {
  const session = await requireAuth();
  const { propertyId } = await searchParams;

  const [tasks, properties, reservationsMissingTasks] = await Promise.all([
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
    // Current/future checkouts still missing their CLEANING task — so the backfill
    // button appears and one click fills the gap. Keyed on the cleaning type
    // specifically (a reservation can have a check-in task yet still need cleaning),
    // and on the Istanbul day boundary so it matches the dashboard's "today".
    prisma.reservation.count({
      where: {
        property: { organizationId: session.organizationId },
        status: { not: "cancelled" },
        tasks: { none: { type: "cleaning" } },
        departureDate: { gte: zonedDayRange(new Date(), "Europe/Istanbul").start },
      },
    }),
  ]);

  // Drives the Bugün / Bu hafta / Bu ay filter. Each task is bucketed by the
  // Istanbul calendar day of its dueAt (daysUntilDate) — the SAME basis the card's
  // date label uses (formatDayInTz) — so a task shown as "10 Haz" always lands in
  // "Bugün" on the 10th (the host's Istanbul day), no matter what time-of-day it
  // was stored at (Hospitable UTC-midnight, iCal local-noon, or Istanbul-midnight).
  const TZ = "Europe/Istanbul"; // Türkiye, UTC+3 year-round
  const now = new Date();

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
      dueLabel: t.dueAt ? formatDayInTz(t.dueAt, TZ) : null,
      dueDays: t.dueAt ? daysUntilDate(t.dueAt, now, TZ) : null,
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
        {reservationsMissingTasks > 0 ? (
          <BackfillTasksButton count={reservationsMissingTasks} />
        ) : null}
        <LinkButton href="/tasks/new">
          <Plus className="size-4" /> Yeni görev
        </LinkButton>
      </PageHeader>

      <Card className="border-primary/20 bg-accent/40">
        <CardContent className="flex gap-3 p-5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-5" />
          </div>
          <div className="space-y-1 text-sm">
            <p className="font-semibold">Görevleri AI yönetir</p>
            <p className="text-muted-foreground">
              Her yeni rezervasyonda AI otomatik olarak <strong>check-in hazırlık</strong> ve{" "}
              <strong>çıkış temizliği</strong> görevlerini doğru tarihlerle açar. Eksik kalan olursa
              yukarıda bir <strong>“Eksik görevleri oluştur”</strong> düğmesi belirir; görünmüyorsa tüm
              görevler zaten oluşmuş demektir. Dilediğinizde <strong>“Yeni görev”</strong> ile elle de
              ekleyebilir, ekibinize atayabilir, fotoğraflı kontrol notu ekleyebilirsiniz.
            </p>
          </div>
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
          description="Yeni rezervasyonlarda görevler otomatik açılır. Eksik kalan varsa yukarıdaki düğmeyle tamamlayabilir, dilerseniz aşağıdan elle de görev ekleyebilirsiniz."
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
