import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { reservationUpdateSchema, zodFieldErrors } from "@/lib/validators";
import {
  requireSession,
  unauthorized,
  badRequest,
  jsonOk,
  notFound,
  serverError,
  canManage,
  forbidden,
} from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

async function findScoped(id: string, orgId: string) {
  return prisma.reservation.findFirst({
    where: { id, property: { organizationId: orgId } },
    select: { id: true },
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!canManage(session)) return forbidden();
  const { id } = await params;
  try {
    if (!(await findScoped(id, session.organizationId))) return notFound();
    const data = await req.json().catch(() => null);
    const parsed = reservationUpdateSchema.safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

    const reservation = await prisma.reservation.update({
      where: { id },
      data: parsed.data,
    });
    return jsonOk(reservation);
  } catch (err) {
    return serverError(undefined, err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!canManage(session)) return forbidden();
  const { id } = await params;
  const result = await prisma.reservation.deleteMany({
    where: { id, property: { organizationId: session.organizationId } },
  });
  if (result.count === 0) return notFound();
  return jsonOk({ ok: true });
}
