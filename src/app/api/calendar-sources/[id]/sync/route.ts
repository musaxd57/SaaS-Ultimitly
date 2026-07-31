import { prisma } from "@/lib/db";
import { notFound, jsonOk, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { syncCalendarSource } from "@/lib/import/sync";
import { rateLimit } from "@/lib/rate-limit";

export const POST = withManage<{ id: string }>(async (session, _req, { params }) => {
  // Limitsizdi: tek kaynak icin bile tekrarli disari cikis.
  const limited = await rateLimit(`calendar-source-sync:${session.organizationId}`, 12, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const { id } = await params;
  const source = await prisma.calendarSource.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    select: { id: true },
  });
  if (!source) return notFound();

  const result = await syncCalendarSource(id);
  return jsonOk(result);
});
