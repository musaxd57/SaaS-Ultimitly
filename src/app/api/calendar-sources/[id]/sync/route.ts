import { prisma } from "@/lib/db";
import { notFound, jsonOk, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { syncCalendarSource } from "@/lib/import/sync";
import { rateLimit } from "@/lib/rate-limit";
import { TRIAL_IDENTITY_REUSED_MESSAGE } from "@/lib/billing/trial-identity";

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

  const { trialEnded, ...result } = await syncCalendarSource(id);
  // Deneme kimliği: bu okumada takvim başka hesapta görülmüş çıktı → sade not (iç alan yanıta çıkmaz).
  return jsonOk(trialEnded ? { ...result, trialNotice: TRIAL_IDENTITY_REUSED_MESSAGE } : result);
});
