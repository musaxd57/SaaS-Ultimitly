import { type NextRequest } from "next/server";
import { requireSession, unauthorized, jsonOk, serverError } from "@/lib/api";
import { syncAllSourcesForOrg } from "@/lib/import/sync";

/** Sync every saved iCal source for the organization (button / cron target). */
export async function POST(_req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  try {
    const result = await syncAllSourcesForOrg(session.organizationId);
    return jsonOk(result);
  } catch (err) {
    return serverError(undefined, err);
  }
}
