import { prisma } from "@/lib/db";
import { notFound, jsonOk } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { syncCalendarSource } from "@/lib/import/sync";

export const POST = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  const source = await prisma.calendarSource.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    select: { id: true },
  });
  if (!source) return notFound();

  const result = await syncCalendarSource(id);
  return jsonOk(result);
});
