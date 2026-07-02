import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, notFound, jsonOk, serverError, canManage, forbidden } from "@/lib/api";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!canManage(session)) return forbidden();

  try {
    const { id } = await params;
    const source = await prisma.calendarSource.findFirst({
      where: { id, property: { organizationId: session.organizationId } },
      select: { id: true },
    });
    if (!source) return notFound();

    await prisma.calendarSource.delete({ where: { id } });
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError(undefined, err);
  }
}
