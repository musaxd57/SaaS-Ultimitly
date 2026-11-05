import "server-only";

import { prisma } from "@/lib/db";
import { emailService } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/report-error";
import { isDemoOrg } from "@/lib/demo-tenant/constants";
import { taskAssignedEmail, taskBlockedEmail } from "@/lib/email-templates";
import { staffTaskProjection } from "@/lib/tasks/staff-view";
import { orgTimezone } from "@/lib/timezone";
import { formatDayInTz } from "@/lib/utils";
import { calendarDateOf } from "@/modules/availability/core";

// ---------------------------------------------------------------------------
// GÖREV BİLDİRİMLERİ (kurucu 11-05 gece; tasarım docs/TASARIM-2026-11-06-dogrudan-gorevlendirme-ve-whatsapp.md §2.3 / §2.5).
// Ana kanal ileride WhatsApp (ev sahibi kanalının altyapısı); bugün e-posta (geçici). Bütün YENİ gönderimler `STAFF_NOTIFY_ENABLED=1`
// arkasında KAPALI doğar — ilk gerçek gönderim kurucuyla birlikte (kural: e-posta akışı ilk denemeler birlikte). Bugünkü elle atama
// e-postası (`api/tasks/[id]`) bu anahtardan BAĞIMSIZ, eskisi gibi.
// ---------------------------------------------------------------------------

/** Yalnız "1" ile açılır (`STRICT_ONE_FLAGS`). */
export function staffNotifyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.STAFF_NOTIFY_ENABLED === "1";
}

/** Aynı görev için saatte en çok bu kadar "yapılamıyor" bildirimi (ileri-geri basma ev sahibinin kutusunu doldurmasın). */
const BLOCKED_MAILS_PER_TASK_HOUR = 3;

export interface TaskBlockedNotice {
  organizationId: string;
  taskId: string;
  /** "Yapamıyorum" diyen kişi (kendisine gitmez). Denetim kaydının "eylemi yapan"ı DEĞİL — o `auditActor(session)`. */
  reporterUserId: string;
  reporterName: string;
  propertyName: string;
  taskTypeLabel: string;
  /** Görevin vadesi (gün mülk takviminde, tek tarih kuralıyla yazılır). */
  dueAt: Date | null;
  /** Kişinin yazdığı neden (isteğe bağlı, kısaltılmış). */
  reason: string | null;
}

/**
 * Atanan kişi "Yapamıyorum" dedi → işletmenin sahip / yöneticilerine e-posta (anahtar açıkken). En iyi çaba: hata görevi etkilemez, raporlanır.
 * Misafir adı / mesajı TAŞIMAZ (görev başlığı yerine tür + daire + gün).
 */
export async function notifyTaskBlocked(n: TaskBlockedNotice): Promise<"sent" | "skipped"> {
  if (!staffNotifyEnabled() || isDemoOrg(n.organizationId)) return "skipped";
  if (!(await rateLimit(`task-blocked-mail:${n.taskId}`, BLOCKED_MAILS_PER_TASK_HOUR, 60 * 60_000)).ok) return "skipped";
  const managers = await prisma.user.findMany({
    where: { organizationId: n.organizationId, role: { in: ["owner", "manager"] }, id: { not: n.reporterUserId } },
    select: { email: true, name: true },
  });
  if (managers.length === 0) return "skipped";
  const org = await prisma.organization.findUnique({ where: { id: n.organizationId }, select: { timezone: true } });
  const tz = orgTimezone(org?.timezone);
  const dueLabel = n.dueAt ? formatDayInTz(new Date(`${calendarDateOf(n.dueAt, tz).key}T12:00:00.000Z`), "UTC") : null;
  const html = taskBlockedEmail({ ...n, dueLabel });
  for (const m of managers) {
    void emailService
      .sendReporting(m.email, `Görev yapılamıyor: ${n.propertyName}`, html)
      .then((res) => {
        if (!res.ok) void reportError("task-blocked-mail", new Error(`task=${n.taskId} — 'yapılamıyor' bildirimi gönderilemedi`));
      })
      .catch((err) => void reportError("task-blocked-mail", err));
  }
  return "sent";
}

/** Aynı görev için saatte en çok bu kadar atama e-postası (elle atamanın tavanıyla AYNI anahtar — iki yol toplamda 3). */
const ASSIGN_MAILS_PER_TASK_HOUR = 3;
/** Aynı KİŞİYE saatte en çok bu kadar otomatik atama e-postası (Haiku 11-06): yeni bağlanan takvim / dosya bir anda onlarca rezervasyon
 *  getirince temizlikçinin kutusu dolmasın. Görevler YİNE atanır ve listesinde görünür; yalnız fazladan e-posta gitmez. */
const AUTO_ASSIGN_MAILS_PER_USER_HOUR = 10;

/**
 * Sistem görevi dairenin temizlikçisine OTOMATİK atandı (kurucu 11-05 gece) → kişiye "yeni görev" e-postası (anahtar açıkken). Bugünkü elle
 * atama e-postasıyla aynı şablon ve aynı tavan anahtarı; personele giden metin temizlikçi görünümüdür (misafir adı / mesajı yok). Ana kanal
 * ileride WhatsApp (tasarım §2.3).
 */
export async function notifyTaskAssigned(organizationId: string, taskId: string): Promise<"sent" | "skipped"> {
  if (!staffNotifyEnabled() || isDemoOrg(organizationId)) return "skipped";
  const task = await prisma.task.findFirst({
    where: { id: taskId, property: { organizationId } },
    include: { property: { select: { name: true, address: true, city: true } }, assignedTo: { select: { name: true, email: true, role: true } } },
  });
  if (!task?.assignedTo) return "skipped";
  if (!(await rateLimit(`task-assign-mail:${task.id}`, ASSIGN_MAILS_PER_TASK_HOUR, 60 * 60_000)).ok) return "skipped";
  if (!(await rateLimit(`task-auto-assign-mail-user:${task.assignedToId}`, AUTO_ASSIGN_MAILS_PER_USER_HOUR, 60 * 60_000)).ok) return "skipped";
  const assignee = task.assignedTo;
  const emailTask = assignee.role === "owner" || assignee.role === "manager" ? task : staffTaskProjection(task);
  const html = taskAssignedEmail(emailTask, { name: assignee.name, email: assignee.email }, task.property);
  void emailService
    .sendReporting(assignee.email, `Yeni Görev: ${emailTask.title}`, html)
    .then((res) => {
      if (!res.ok) void reportError("task-assign-mail", new Error(`task=${task.id} — otomatik atama bildirimi gönderilemedi`));
    })
    .catch((err) => void reportError("task-assign-mail", err));
  return "sent";
}
