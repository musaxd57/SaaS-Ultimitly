import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { taskUpdateSchema, zodFieldErrors } from "@/lib/validators";
import {
  requireSession,
  unauthorized,
  badRequest,
  jsonOk,
  notFound,
  serverError,
} from "@/lib/api";
import { emailService } from "@/lib/email";
import { taskAssignedEmail } from "@/lib/email-templates";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id } = await params;
  try {
    const existing = await prisma.task.findFirst({
      where: { id, property: { organizationId: session.organizationId } },
      select: { id: true, assignedToId: true },
    });
    if (!existing) return notFound();

    const data = await req.json().catch(() => null);
    const parsed = taskUpdateSchema.safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
    const d = parsed.data;

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
  } catch {
    return serverError();
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id } = await params;
  const result = await prisma.task.deleteMany({
    where: { id, property: { organizationId: session.organizationId } },
  });
  if (result.count === 0) return notFound();
  return jsonOk({ ok: true });
}
