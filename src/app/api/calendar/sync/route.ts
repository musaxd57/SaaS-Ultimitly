import { jsonOk, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { syncAllSourcesForOrg } from "@/lib/import/sync";
import { rateLimit } from "@/lib/rate-limit";

// Sync every saved iCal source for the organization (button / cron target).
// Session-only by policy (staff may trigger an iCal refresh); org-scoped.
export const POST = withManage(async (session) => {
  // Limitsizdi: her istek org'un TUM feed'lerini disariya cekiyor -> kendi IP'mizden ucuncu tarafa hacim + replikada 15 sn'lik fetch tutma.
  const limited = await rateLimit(`calendar-sync:${session.organizationId}`, 6, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  return jsonOk(await syncAllSourcesForOrg(session.organizationId));
});
