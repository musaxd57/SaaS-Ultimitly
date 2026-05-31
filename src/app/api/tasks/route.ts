import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { taskSchema, zodFieldErrors } from "@/lib/validators";
import {
  requireSession,
  unauthorized,
  badRequest,
  jsonOk,
  serverError,
  propertyInOrg,
} from "@/lib/api";

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? undefined;
  const propertyId = searchParams.get("propertyId") ?? undefined;

  const tasks = await prisma.task.findMany({
    where: {
      property: { organizationId: session.organizationId },
      ...(status ? { status } : {}),
      ...(propertyId ? { propertyId } : {}),
    },
    include: {
      property: { select: { name: true } },
      assignedTo: { select: { name: true } },
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
  });
  return jsonOk(tasks);
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  try {
    const data = await req.json().catch(() => null);
    const parsed = taskSchema.safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
    const d = parsed.data;

    if (!(await propertyInOrg(d.propertyId, session.organizationId))) {
      return badRequest({ propertyId: "Geçersiz mülk" });
    }

    if (d.assignedToId) {
      const member = await prisma.user.findFirst({
        where: { id: d.assignedToId, organizationId: session.organizationId },
        select: { id: true },
      });
      if (!member) return badRequest({ assignedToId: "Geçersiz personel" });
    }

    const task = await prisma.task.create({
      data: {
        propertyId: d.propertyId,
        reservationId: d.reservationId || null,
        type: d.type,
        title: d.title,
        description: d.description || null,
        assignedToId: d.assignedToId || null,
        dueAt: d.dueAt instanceof Date ? d.dueAt : null,
        status: d.status,
        priority: d.priority,
      },
    });
    return jsonOk(task, 201);
  } catch {
    return serverError();
  }
}
