import { type NextRequest } from "next/server";
import { requireSession, unauthorized, jsonOk, serverError } from "@/lib/api";
import { backfillReservationTasks } from "@/lib/automation";

/**
 * Create the standard check-in/cleaning tasks for every existing reservation
 * that doesn't have them yet (button target). Useful for reservations imported
 * via iCal before task automation existed.
 */
export async function POST(_req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  try {
    const result = await backfillReservationTasks(session.organizationId);
    return jsonOk(result);
  } catch {
    return serverError();
  }
}
