import { getOpsStats } from "@/lib/reports";
import { requireSession, unauthorized, jsonOk } from "@/lib/api";

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const stats = await getOpsStats(session.organizationId);
  return jsonOk(stats);
}
