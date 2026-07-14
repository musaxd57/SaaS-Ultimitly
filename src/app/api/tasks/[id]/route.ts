import { prisma } from "@/lib/db";
import { taskUpdateSchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, notFound, canManage, forbidden } from "@/lib/api";
import { withAuth, withManage } from "@/lib/route-guard";
import { emailService } from "@/lib/email";
import { taskAssignedEmail } from "@/lib/email-templates";
import { enqueueStorageDeletions } from "@/lib/storage/deletion-queue";
import { STORAGE_PHOTO_URL_PREFIX, keyFromPhotoUrl, isAcceptablePhotoUrl } from "@/lib/storage/keys";

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

  const data = await req.json().catch(() => null);
  const parsed = taskUpdateSchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
  const d = parsed.data;

  // A storage photoUrl must belong to THIS org (its key's org segment == session org).
  // The schema only checks the URL SHAPE; without this a member could store a photoUrl
  // pointing at another tenant's object key, which task DELETE / erasure would later
  // enqueue for deletion. Belt-and-braces with the deletion choke point + serve guard.
  if (d.photoUrl !== undefined && !isAcceptablePhotoUrl(d.photoUrl, session.organizationId)) {
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
  // Rebuild from the stored labels + the incoming done flags (by index).
  let checklistWrite: string | undefined;
  if (d.checklist !== undefined) {
    if (canManage(session)) {
      checklistWrite = JSON.stringify(d.checklist);
    } else {
      const stored = parseChecklist(existing.checklistJson);
      if (d.checklist.length !== stored.length) {
        return forbidden("Personel görev maddelerini değiştiremez, yalnızca işaretleyebilir.");
      }
      checklistWrite = JSON.stringify(
        stored.map((item, i) => ({ label: item.label, done: Boolean(d.checklist?.[i]?.done) })),
      );
    }
  }

  let newAssignee: { id: string; name: string; email: string } | null = null;
  if (d.assignedToId) {
    const member = await prisma.user.findFirst({
      where: { id: d.assignedToId, organizationId: session.organizationId },
      select: { id: true, name: true, email: true },
    });
    if (!member) return badRequest({ assignedToId: "Geçersiz personel" });
    // Only notify if the assignee actually changed.
    if (d.assignedToId !== existing.assignedToId) {
      newAssignee = member;
    }
  }

  const task = await prisma.task.update({
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

  // Send email to the newly assigned user.
  if (newAssignee) {
    const html = taskAssignedEmail(
      task,
      { name: newAssignee.name, email: newAssignee.email },
      { name: task.property.name, address: task.property.address, city: task.property.city },
    );
    void emailService.send(newAssignee.email, `Yeni Görev: ${task.title}`, html);
  }

  // Record an activity update when status / note / photo changes.
  if (d.status !== undefined || d.note || d.photoUrl) {
    await prisma.taskUpdate.create({
      data: {
        taskId: id,
        userId: session.userId,
        status: d.status ?? null,
        note: d.note ?? null,
        photoUrl: d.photoUrl ?? null,
      },
    });
  }

  return jsonOk(task);
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
  const keys = photoRows.map((r) => keyFromPhotoUrl(r.photoUrl)).filter((k): k is string => k !== null);
  const result = await prisma.$transaction(async (tx) => {
    const del = await tx.task.deleteMany({
      where: { id, property: { organizationId: session.organizationId } },
    });
    if (del.count > 0 && keys.length > 0) {
      await enqueueStorageDeletions(tx, session.organizationId, keys);
    }
    return del;
  });
  if (result.count === 0) return notFound();
  return jsonOk({ ok: true });
});
