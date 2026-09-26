// ---------------------------------------------------------------------------
// Görev panosu kart verisi (sayfanın satır → kart eşlemesi; saf, test edilir). Personel oturumunda başlık temizlikçi
// görünümüdür (misafir adı yok, `staff-view.ts`); temizlik listesi (WhatsApp) HER ZAMAN temizlikçi görünümüyle kurulur
// çünkü alıcısı temizlikçidir.
// ---------------------------------------------------------------------------

import type { TaskCardData } from "@/components/tasks/task-board";
import { formatDayInTz, formatTime, safeJsonParse } from "@/lib/utils";
import { calendarDateOf, nightsBetween, todayKey } from "@/modules/availability/core";
import { cleanerTaskTitle } from "./staff-view";

/**
 * Vadenin SAATİ yalnız gerçek bir anda anlamlıdır (09-26). Yaşam döngüsü görevinin vadesi rezervasyon TARİHİDİR — "yalnız
 * tarih" çapası (D 00:00Z / D 12:00Z, `calendarDateOf`); saatini göstermek panoda İstanbul'da "Çıkış temizliği · 03:00"
 * (iCal'de 15:00) yazıyordu, sanki temizlik gece üçteymiş gibi. Çapa → null (saat yok); gerçek an → org diliminde saat.
 */
export function taskDueTimeLabel(dueAt: Date | null, timeZone: string): string | null {
  if (!dueAt || calendarDateOf(dueAt, timeZone).anchor !== "instant") return null;
  return formatTime(dueAt, timeZone);
}

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
  // Vadenin GÜNÜ tek tarih kuralıyla (`calendarDateOf`, 09-26): yaşam döngüsü vadesi yalnız-tarih çapasıdır. Ham
  // "an → yerel gün" New York'ta kartı ve "Bugün" süzgecini bir gün ERKEN gösteriyordu (İstanbul'da birebir aynı).
  const due = t.dueAt ? calendarDateOf(t.dueAt, ctx.timeZone) : null;
  return {
    id: t.id,
    title: ctx.canManage ? t.title : cleanerTitle,
    shareTitle: cleanerTitle,
    type: t.type,
    priority: t.priority,
    status: t.status,
    propertyName: t.property.name,
    assigneeName: t.assignedTo?.name ?? null,
    dueLabel: due ? formatDayInTz(new Date(`${due.key}T12:00:00.000Z`), "UTC") : null,
    dueDays: due ? nightsBetween(todayKey(ctx.now, ctx.timeZone), due.key) : null,
    checklist: checklist.length > 0 ? { items: checklist } : null,
    latestPhotoUrl: ctx.latestPhotoUrl,
    latestNote: latestUpdate?.note ?? null,
  };
}
