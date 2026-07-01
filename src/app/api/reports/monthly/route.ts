import { getMonthlyReport } from "@/lib/reports";
import { requireSession, unauthorized, jsonOk } from "@/lib/api";

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const report = await getMonthlyReport(session.organizationId);
  return jsonOk(report);
}
