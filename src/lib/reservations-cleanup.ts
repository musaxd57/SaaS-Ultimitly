import "server-only";

import { prisma } from "@/lib/db";
import { listReservations } from "@/lib/hospitable";

// ---------------------------------------------------------------------------
// Ghost-reservation cleanup
//
// A channel reconnect can re-issue reservation IDs, leaving an old reservation
// row attached to the WRONG apartment in our DB (e.g. a checkout showing under
// "Serdar'ı Ekrem 2" when the guest is really in "serdarı ekrem 1"). The sync
// only upserts — it never deletes — so these ghosts linger on the dashboard.
//
// SAFE BY DESIGN:
//   * listReservations returns the COMPLETE set for a property or THROWS — it
//     never returns partial data (see fetchAllPages) — so a successful fetch is
//     authoritative truth.
//   * A property is pruned only when its fetch SUCCEEDED and returned at least
//     one reservation. An empty/failed fetch is treated as "couldn't verify" and
//     SKIPPED — a property is never wiped wholesale.
//   * Only Hospitable-sourced rows whose ARRIVAL is inside the same window the
//     sync queries are eligible (Hospitable would definitely have returned them
//     if they still existed). Genuine bookings — including a group's second flat
//     on the same dates — survive, because Hospitable still lists them.
// ---------------------------------------------------------------------------

export interface ReservationCleanupResult {
  removed: number; // ghost reservations deleted
  checkedProperties: number; // properties verified against Hospitable
  skippedProperties: number; // properties not verified (fetch failed/empty) — never pruned
}

const DAY = 24 * 60 * 60 * 1000;

export async function cleanupStaleReservations(
  organizationId: string,
): Promise<ReservationCleanupResult> {
  const result: ReservationCleanupResult = {
    removed: 0,
    checkedProperties: 0,
    skippedProperties: 0,
  };

  // Mirror the sync's reservation window exactly so "would Hospitable have
  // returned it?" lines up with what the sync imports.
  const startDate = new Date(Date.now() - 60 * DAY).toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + 540 * DAY).toISOString().slice(0, 10);
  const windowStart = new Date(`${startDate}T00:00:00.000Z`);
  const windowEnd = new Date(`${endDate}T23:59:59.999Z`);

  const properties = await prisma.property.findMany({
    where: { organizationId, hospitableId: { not: null } },
    select: { id: true, hospitableId: true },
  });

  for (const p of properties) {
    if (!p.hospitableId) continue;

    let current;
    try {
      current = await listReservations({ propertyIds: [p.hospitableId], startDate, endDate });
    } catch {
      result.skippedProperties++; // couldn't verify → never prune
      continue;
    }

    // An empty result is treated as "couldn't verify" — never wipe a property.
    if (current.length === 0) {
      result.skippedProperties++;
      continue;
    }
    result.checkedProperties++;

    const seen = new Set(current.map((r) => String(r.id)));

    // Hospitable-sourced rows arriving inside the window: Hospitable definitely
    // would have returned them if they still existed. Any not in `seen` are gone.
    const locals = await prisma.reservation.findMany({
      where: {
        propertyId: p.id,
        sourceReference: { not: null },
        arrivalDate: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true, sourceReference: true },
    });

    const staleIds = locals
      .filter((l) => l.sourceReference && !seen.has(l.sourceReference))
      .map((l) => l.id);

    if (staleIds.length > 0) {
      await prisma.reservation.deleteMany({ where: { id: { in: staleIds } } });
      result.removed += staleIds.length;
    }
  }

  return result;
}
