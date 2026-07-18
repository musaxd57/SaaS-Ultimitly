import { prisma } from "@/lib/db";
import { reservationUpdateSchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";

async function findScoped(id: string, orgId: string) {
  return prisma.reservation.findFirst({
    where: { id, property: { organizationId: orgId } },
    select: { id: true },
  });
}

export const PATCH = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;
  if (!(await findScoped(id, session.organizationId))) return notFound();
  const data = await readJsonCappedOrNull(req);
  const parsed = reservationUpdateSchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

  const reservation = await prisma.reservation.update({
    where: { id },
    data: parsed.data,
  });
  return jsonOk(reservation);
});

export const DELETE = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  const result = await prisma.reservation.deleteMany({
    where: { id, property: { organizationId: session.organizationId } },
  });
  if (result.count === 0) return notFound();
  return jsonOk({ ok: true });
});
