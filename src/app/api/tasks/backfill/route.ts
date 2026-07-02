import { jsonOk } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { backfillReservationTasks } from "@/lib/automation";

/**
 * Create the standard check-in/cleaning tasks for every existing reservation
 * that doesn't have them yet (button target). Useful for reservations imported
 * via iCal before task automation existed.
 */
export const POST = withManage(async (session) => {
  return jsonOk(await backfillReservationTasks(session.organizationId));
});
