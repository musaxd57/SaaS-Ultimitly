import { jsonOk, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { cleanupDuplicateConversations } from "@/lib/conversations-cleanup";
import { cleanupStaleReservations } from "@/lib/reservations-cleanup";

/**
 * Clean up the artefacts a channel reconnect leaves behind, org-scoped and safe:
 *   - duplicate conversations (kept copy keeps every message), and
 *   - ghost reservations Hospitable no longer has (verified against live data).
 * Never loses a message or a still-valid booking. Destructive maintenance
 * (deletes rows) — owner/manager only (withManage).
 */
export const POST = withManage(async (session) => {
  // Verifies every property against Hospitable (outbound burst) — throttle per org.
  const limited = await rateLimit(`cleanup-dup:${session.organizationId}`, 4, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const [conversations, reservations] = await Promise.all([
    cleanupDuplicateConversations(session.organizationId),
    cleanupStaleReservations(session.organizationId),
  ]);
  return jsonOk({
    ok: true,
    ...conversations,
    reservationsRemoved: reservations.removed,
    reservationsChecked: reservations.checkedProperties,
    reservationsSkipped: reservations.skippedProperties,
  });
});
