import { type NextRequest } from "next/server";
import { requireSession, unauthorized, jsonOk, serverError } from "@/lib/api";
import { cleanupDuplicateConversations } from "@/lib/conversations-cleanup";

/**
 * Remove stale duplicate conversations left behind when a channel reconnect
 * re-issues reservation IDs. Org-scoped and safe: only deletes a duplicate whose
 * messages are all already present in the kept copy (never loses a message).
 */
export async function POST(_req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  try {
    const result = await cleanupDuplicateConversations(session.organizationId);
    return jsonOk({ ok: true, ...result });
  } catch {
    return serverError();
  }
}
