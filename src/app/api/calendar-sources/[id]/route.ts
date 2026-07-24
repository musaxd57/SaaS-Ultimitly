import { prisma } from "@/lib/db";
import { notFound, jsonOk } from "@/lib/api";
import { withManage } from "@/lib/route-guard";

export const DELETE = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  const source = await prisma.calendarSource.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    select: { id: true },
  });
  if (!source) return notFound();

  await prisma.calendarSource.delete({ where: { id } });
  return jsonOk({ ok: true });
});
