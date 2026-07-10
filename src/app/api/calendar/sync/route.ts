import { jsonOk } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { syncAllSourcesForOrg } from "@/lib/import/sync";

// Sync every saved iCal source for the organization (button / cron target).
// Session-only by policy (staff may trigger an iCal refresh); org-scoped.
export const POST = withManage(async (session) => {
  return jsonOk(await syncAllSourcesForOrg(session.organizationId));
});
