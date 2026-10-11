import { prisma } from "@/lib/db";
import { taskUpdateSchema, zodFieldErrors } from "@/lib/validators";
import { NextResponse } from "next/server";
import { badRequest, jsonOk, notFound, canManage, forbidden, readJsonCappedOrNull } from "@/lib/api";
import { withAuth, withManage } from "@/lib/route-guard";
import { emailService } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/report-error";
import { taskAssignedEmail } from "@/lib/email-templates";
import { enqueueUnreferencedPhotoDeletions } from "@/lib/storage/deletion-queue";
import { STORAGE_PHOTO_URL_PREFIX, isAcceptablePhotoUrl } from "@/lib/storage/keys";
import { staffTaskProjection } from "@/lib/tasks/staff-view";
import { cancelCommitmentsForDeletedTask, syncCommitmentsForTaskDueAt, syncCommitmentsForTaskStatus } from "@/lib/guest-commitments";

/** Parse a stored checklistJson into a clean {label, done}[] (never throws). */
function parseChecklist(json: string | null): { label: string; done: boolean }[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr)
      ? arr
          .filter((x) => x && typeof x.label === "string")
          .map((x) => ({ label: String(x.label), done: Boolean(x.done) }))
      : [];
  } catch {
    return [];
  }
}

class ChecklistConflict extends Error {}
const CHECKLIST_CONFLICT_TEXT = "Görev listesi bu arada değişti. Sayfayı yenileyip tekrar deneyin.";
/** Aynı görev için saatte en çok bu kadar atama e-postası (kurucu kararı 10-11; route.ts yalnız rota alanlarını dışa verir → export yok). */
const TASK_ASSIGN_MAILS_PER_HOUR = 3;

/**
 * Kilitli satırın listesine göre yazılacak liste. Tek madde: sıra + beklenen etiket tutmazsa çatışma, yalnız o maddenin işareti
 * değişir. Yönetici dizisi: olduğu gibi (açık yeniden yazma). Personel dizisi: uzunluk ve etiketler kayıtlıyla aynı olmalı (bayat
 * listenin işareti başka maddeye düşmesin), yalnız işaretler alınır.
 */
function nextChecklist(
  stored: { label: string; done: boolean }[],
  d: { checklist?: { label: string; done: boolean }[]; checklistToggle?: { index: number; label: string; done: boolean } },
  manager: boolean,
): string {
  if (d.checklistToggle) {
    const t = d.checklistToggle;
    if (stored[t.index]?.label !== t.label) throw new ChecklistConflict();
    return JSON.stringify(stored.map((item, i) => (i === t.index ? { label: item.label, done: t.done } : item)));
  }
  const list = d.checklist ?? [];
  if (manager) return JSON.stringify(list);
  if (list.length !== stored.length || list.some((item, i) => item.label !== stored[i].label)) throw new ChecklistConflict();
  return JSON.stringify(stored.map((item, i) => ({ label: item.label, done: Boolean(list[i]?.done) })));
}

// PATCH stays withAuth (session-only): staff MAY progress a task (status/note/
// photo/checklist tick) — but only THEIR assigned task, and only the done flag on
// existing checklist items. Manager-only fields are gated in-body. DELETE = withManage.
export const PATCH = withAuth<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;
  const existing = await prisma.task.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    select: { id: true, assignedToId: true, checklistJson: true },
  });
  if (!existing) return notFound();

  // Staff scope: a staff member may only touch a task ASSIGNED TO THEM. (Owner /
  // manager may touch any task in the org.)
  if (!canManage(session) && existing.assignedToId !== session.userId) {
    return forbidden("Bu görev size atanmamış.");
  }

  const data = await readJsonCappedOrNull(req);
  const parsed = taskUpdateSchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
  const d = parsed.data;

  // A storage photoUrl must belong to THIS org (its key's org segment == session org).
  // The schema only checks the URL SHAPE; without this a member could store a photoUrl
  // pointing at another tenant's object key, which task DELETE / erasure would later
  // enqueue for deletion. Belt-and-braces with the deletion choke point + serve guard.
  if (d.photoUrl !== undefined && !isAcceptablePhotoUrl(d.photoUrl, session.organizationId, id)) {
    return badRequest({ photoUrl: "Geçersiz görsel bağlantısı." });
  }

  // Staff may only progress a task (status / note / photo). Re-assigning,
  // renaming, re-prioritising or rescheduling is an owner/manager action.
  if (
    !canManage(session) &&
    (d.assignedToId !== undefined ||
      d.title !== undefined ||
      d.description !== undefined ||
      d.priority !== undefined ||
      d.dueAt !== undefined)
  ) {
    return forbidden("Personel yalnızca görev durumunu güncelleyebilir.");
  }

  // Checklist: a manager may rewrite it freely; STAFF may only flip the `done`
  // flag on the EXISTING items — never rename, add or remove a checklist item.
  // 🚨 U26 (Codex 10-07): karar KİLİTLİ satırın listesine göre (işlem içinde, ↓) — eskiden işlem DIŞINDA okunan liste ve
  // istemcinin bayat dizisi yazılıyordu: iki kişi aynı anda iki maddeyi işaretleyince biri kayboluyor, liste arada değiştiyse
  // personelin işareti SIRAYLA başka maddeye düşüyordu. Pano artık tek madde gönderir (`checklistToggle`).
  if (d.checklist !== undefined && d.checklistToggle !== undefined) {
    return badRequest({ checklist: "Tek seferde ya liste ya tek madde gönderin." });
  }
  if (d.checklist !== undefined && !canManage(session)) {
    const stored = parseChecklist(existing.checklistJson);
    if (d.checklist.length !== stored.length) {
      return forbidden("Personel görev maddelerini değiştiremez, yalnızca işaretleyebilir.");
    }
  }

  let newAssignee: { id: string; name: string; email: string; role: string } | null = null;
  if (d.assignedToId) {
    const member = await prisma.user.findFirst({
      where: { id: d.assignedToId, organizationId: session.organizationId },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!member) return badRequest({ assignedToId: "Geçersiz personel" });
    // Only notify if the assignee actually changed.
    if (d.assignedToId !== existing.assignedToId) {
      newAssignee = member;
    }
  }

  // C-17 (09-24): durum ve geçmiş kaydı TEK işlemde. Ayrı yazımda durum "bitti" olup kayıt düşerse "hazır" kanıtı
  // eksik kalıyordu (güvenli yön ama tutarsız); tersinde kayıt bir durumu anlatıp görev başka durumda kalabiliyordu.
  // Satır kilidi (update) iki eşzamanlı güncellemeyi sıralar → son geçmiş kaydı görevin son durumunu anlatır.
  // 🚨 PERSONEL KAPSAMI YAZMA ANINDA (Codex 09-30, A4): yetki yukarıda okunan atamaya göreydi, yazma koşulsuzdu → arada
  // yönetici görevi BAŞKASINA atadıysa eski personelin "bitti"si / notu yeni atananın görevine yazılıyordu. Personelin
  // yazması artık "görev hâlâ bana atalı" koşuluyla (koşullu yazma, satır kilidi); tutmazsa hiçbir şey yazılmaz.
  const staffScoped = !canManage(session);
  let task;
  try {
    task = await prisma.$transaction(async (tx) => {
      if (staffScoped) {
        const own = await tx.task.updateMany({ where: { id, assignedToId: session.userId }, data: { updatedAt: new Date() } });
        if (own.count === 0) return null;
      }
      // Misafir sözü (migration 62): durum değişiyorsa ÖNCEKİ durum satır kilidiyle okunur — söz aynı işlemde kapanır / yeniden açılır.
      let prevStatus: string | null = null;
      if (d.status !== undefined) {
        const [row] = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "Task" WHERE "id" = ${id} FOR UPDATE`;
        prevStatus = row?.status ?? null;
      }
      let checklistWrite: string | undefined;
      if (d.checklist !== undefined || d.checklistToggle !== undefined) {
        const [locked] = await tx.$queryRaw<{ checklistJson: string | null }[]>`
          SELECT "checklistJson" FROM "Task" WHERE "id" = ${id} FOR UPDATE`;
        const stored = parseChecklist(locked?.checklistJson ?? null);
        checklistWrite = nextChecklist(stored, d, !staffScoped);
      }
      const updated = await tx.task.update({
        where: { id },
        data: {
          ...(d.status !== undefined ? { status: d.status } : {}),
          ...(d.assignedToId !== undefined ? { assignedToId: d.assignedToId || null } : {}),
          ...(d.title !== undefined ? { title: d.title } : {}),
          ...(d.description !== undefined ? { description: d.description } : {}),
          ...(d.priority !== undefined ? { priority: d.priority } : {}),
          ...(d.dueAt !== undefined ? { dueAt: d.dueAt } : {}),
          // Checklist tick-off (staff: done-only, rebuilt above; manager: free).
          ...(checklistWrite !== undefined ? { checklistJson: checklistWrite } : {}),
        },
        include: {
          property: { select: { name: true, address: true, city: true } },
        },
      });
      const commitmentScope = { organizationId: session.organizationId, taskId: id };
      if (d.status !== undefined && prevStatus !== null) {
        await syncCommitmentsForTaskStatus(tx, commitmentScope, prevStatus, d.status, new Date());
      }
      if (d.dueAt instanceof Date) await syncCommitmentsForTaskDueAt(tx, commitmentScope, d.dueAt);
      // Record an activity update when status / note / photo changes.
      if (d.status !== undefined || d.note || d.photoUrl) {
        await tx.taskUpdate.create({
          data: {
            taskId: id,
            userId: session.userId,
            status: d.status ?? null,
            note: d.note ?? null,
            photoUrl: d.photoUrl ?? null,
          },
        });
      }
      return updated;
    });
  } catch (err) {
    if (err instanceof ChecklistConflict) return NextResponse.json({ error: CHECKLIST_CONFLICT_TEXT, code: "checklist_changed" }, { status: 409 });
    throw err;
  }
  if (!task) return forbidden("Bu görev size atanmamış.");

  // Send email to the newly assigned user. Personele giden e-posta misafir adını / mesajını taşımaz (temizlikçi
  // görünümü; e-posta onun kutusunda, saklama süremizin dışında kalır).
  // TAVAN (kurucu kararı 10-11): aynı görev için saatte en çok 3 atama e-postası — döngüyle yeniden atama personelin kutusunu
  // doldurmasın. Atama YİNE yapılır (yukarıda yazıldı); yalnız fazladan e-posta gitmez.
  const mailAllowed = newAssignee ? (await rateLimit(`task-assign-mail:${task.id}`, TASK_ASSIGN_MAILS_PER_HOUR, 60 * 60_000)).ok : false;
  if (newAssignee && mailAllowed) {
    const emailTask = newAssignee.role === "owner" || newAssignee.role === "manager" ? task : staffTaskProjection(task);
    const html = taskAssignedEmail(
      emailTask,
      { name: newAssignee.name, email: newAssignee.email },
      { name: task.property.name, address: task.property.address, city: task.property.city },
    );
    // ⚠️ `send` DEĞİL `sendReporting` (denetim, 08-01 — üçüncü tur). `send` sonucu
    // YUTAR: atanan kişi görevi hiç öğrenmeyebilir ve HİÇBİR YERDE iz kalmazdı.
    // İstek yolunda `await` etmiyoruz (yanıt gecikmesin) ama SONUCU OKUYORUZ.
    // ⚠️ Alarm PII TAŞIMAZ: görev başlığı misafir adı taşıyabilir (KVKK süpürge
    // kapsamında) → alarma yalnız görev ID'si girer.
    void emailService
      .sendReporting(newAssignee.email, `Yeni Görev: ${emailTask.title}`, html)
      .then((res) => {
        if (!res.ok) {
          void reportError(
            "task-assign-mail",
            new Error(`task=${task.id} — görev atama bildirimi gönderilemedi`),
          );
        }
      })
      .catch((err) => void reportError("task-assign-mail", err));
  }

  return jsonOk(canManage(session) ? task : staffTaskProjection(task));
});

export const DELETE = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  // Storage-backed photos: the task cascade wipes the TaskUpdate rows that
  // reference the objects, so record the deletion INTENTS in the SAME
  // transaction as the delete — the provider is never on this critical path
  // (a storage outage can't block the delete NOR silently leak the objects;
  // the queue drains later). Legacy /uploads photos are untouched (no rows match).
  const photoRows = await prisma.taskUpdate.findMany({
    where: {
      taskId: id,
      task: { property: { organizationId: session.organizationId } },
      photoUrl: { startsWith: STORAGE_PHOTO_URL_PREFIX },
    },
    select: { photoUrl: true },
  });
  const result = await prisma.$transaction(async (tx) => {
    // Misafir sözü (migration 62): görev silinmeden ÖNCE bağlı açık söz iptal olur. Görev satırı ÖNCE kilitlenir — durum güncellemesiyle
    // AYNI kilit sırası (görev → söz); ters sıra eşzamanlı güncelleme + silmede kilitlenme üretebilirdi (Haiku incelemesi).
    const owned = await tx.$queryRaw<{ id: string }[]>`
      SELECT t."id" FROM "Task" t JOIN "Property" p ON p."id" = t."propertyId"
      WHERE t."id" = ${id} AND p."organizationId" = ${session.organizationId} FOR UPDATE OF t`;
    if (owned.length > 0) await cancelCommitmentsForDeletedTask(tx, { organizationId: session.organizationId, taskId: id }, new Date());
    const del = await tx.task.deleteMany({
      where: { id, property: { organizationId: session.organizationId } },
    });
    // Yalnız artık hiçbir görevin göstermediği nesne (eski satırlar aynı nesneyi başka görevde de gösterebilir — inceleme b1).
    if (del.count > 0 && photoRows.length > 0) {
      await enqueueUnreferencedPhotoDeletions(tx, session.organizationId, photoRows.map((r) => r.photoUrl));
    }
    return del;
  });
  if (result.count === 0) return notFound();
  return jsonOk({ ok: true });
});
