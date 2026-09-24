// ---------------------------------------------------------------------------
// Görev panosu kart verisi (sayfanın satır → kart eşlemesi; saf, test edilir). Personel oturumunda başlık temizlikçi
// görünümüdür (misafir adı yok, `staff-view.ts`); temizlik listesi (WhatsApp) HER ZAMAN temizlikçi görünümüyle kurulur
// çünkü alıcısı temizlikçidir.
// ---------------------------------------------------------------------------

import type { TaskCardData } from "@/components/tasks/task-board";
import { daysUntilDate, formatDayInTz, safeJsonParse } from "@/lib/utils";
import { cleanerTaskTitle } from "./staff-view";

type ChecklistItem = { label: string; done: boolean };

export interface TaskCardRow {
  id: string;
  title: string;
  type: string;
  origin: string | null;
  priority: string;
  status: string;
  dueAt: Date | null;
  checklistJson: string | null;
  property: { name: string };
  assignedTo: { name: string } | null;
  updates: { note: string | null }[];
}

export function taskCardData(
  t: TaskCardRow,
  ctx: { canManage: boolean; timeZone: string; now: Date; latestPhotoUrl: string | null },
): TaskCardData {
  const parsedChecklist = safeJsonParse<ChecklistItem[]>(t.checklistJson, []);
  // Guard against a stored non-array JSON scalar (e.g. "foo") slipping past
  // safeJsonParse — .length/.filter on a non-array would 500 the page.
  const checklist = Array.isArray(parsedChecklist) ? parsedChecklist : [];
  const latestUpdate = t.updates[0] ?? null;
  const cleanerTitle = cleanerTaskTitle(t);
  return {
    id: t.id,
    title: ctx.canManage ? t.title : cleanerTitle,
    shareTitle: cleanerTitle,
    type: t.type,
    priority: t.priority,
    status: t.status,
    propertyName: t.property.name,
    assigneeName: t.assignedTo?.name ?? null,
    dueLabel: t.dueAt ? formatDayInTz(t.dueAt, ctx.timeZone) : null,
    dueDays: t.dueAt ? daysUntilDate(t.dueAt, ctx.now, ctx.timeZone) : null,
    checklist: checklist.length > 0 ? { items: checklist } : null,
    latestPhotoUrl: ctx.latestPhotoUrl,
    latestNote: latestUpdate?.note ?? null,
  };
}
