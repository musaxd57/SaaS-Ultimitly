import { getMonthlyReport } from "@/lib/reports";
import { jsonOk } from "@/lib/api";
import { withManage } from "@/lib/route-guard";

export const GET = withManage(async (session) => {
  return jsonOk(await getMonthlyReport(session.organizationId));
});
