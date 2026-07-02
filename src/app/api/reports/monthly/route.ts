import { getMonthlyReport } from "@/lib/reports";
import { jsonOk } from "@/lib/api";
import { withAuth } from "@/lib/route-guard";

export const GET = withAuth(async (session) => {
  return jsonOk(await getMonthlyReport(session.organizationId));
});
