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

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const { id } = await params;
  try {
    const existing = await prisma.task.findFirst({
      where: { id, property: { organizationId: session.organizationId } },
      select: { id: true },
    });
    if (!existing) return notFound();

    const data = await req.json().catch(() => null);
    const parsed = taskUpdateSchema.safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
    const d = parsed.data;

    if (d.assignedToId) {
      const member = await prisma.user.findFirst({
        where: { id: d.assignedToId, organizationId: session.organizationId },
        select: { id: true },
      });
      if (!member) return badRequest({ assignedToId: "Geçersiz personel" });
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
    });

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
