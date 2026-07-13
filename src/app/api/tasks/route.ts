import { prisma } from "@/lib/db";
import { taskSchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, propertyInOrg, canManage } from "@/lib/api";
import { withAuth, withManage } from "@/lib/route-guard";

export const GET = withAuth(async (session, req) => {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? undefined;
  const propertyId = searchParams.get("propertyId") ?? undefined;

  const tasks = await prisma.task.findMany({
    where: {
      property: { organizationId: session.organizationId },
      // Staff see ONLY the tasks assigned to them; owner/manager see all.
      ...(canManage(session) ? {} : { assignedToId: session.userId }),
      ...(status ? { status } : {}),
      ...(propertyId ? { propertyId } : {}),
    },
    include: {
      property: { select: { name: true } },
      assignedTo: { select: { name: true } },
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    take: 500, // bound the payload — no pagination yet
  });
  return jsonOk(tasks);
});

export const POST = withManage(async (session, req) => {
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

  // The reservation must belong to the SAME org AND the same property — never
  // trust a client-supplied reservationId (cross-tenant reference otherwise).
  if (d.reservationId) {
    const reservation = await prisma.reservation.findFirst({
      where: {
        id: d.reservationId,
        propertyId: d.propertyId,
        property: { organizationId: session.organizationId },
      },
      select: { id: true },
    });
    if (!reservation) return badRequest({ reservationId: "Geçersiz rezervasyon" });
  }

  const task = await prisma.task.create({
    data: {
      propertyId: d.propertyId,
      reservationId: d.reservationId || null,
      type: d.type,
      origin: "manual",
      title: d.title,
      description: d.description || null,
      assignedToId: d.assignedToId || null,
      dueAt: d.dueAt instanceof Date ? d.dueAt : null,
      status: d.status,
      priority: d.priority,
    },
  });
  return jsonOk(task, 201);
});
