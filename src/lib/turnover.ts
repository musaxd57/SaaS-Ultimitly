import "server-only";

import { prisma } from "@/lib/db";
import type { AdjacencyContext } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// Turnover context — neighbouring bookings for the SAME property.
//
// For early-checkin / late-checkout questions, the model otherwise has no idea
// whether another guest is leaving the morning of arrival or arriving the day of
// departure, so the prompt always falls back to "ask the operator". Feeding it
// the adjacent booking dates lets it reason about the cleaning window with data.
// Read-only; confirmed/completed bookings only.
// ---------------------------------------------------------------------------

export async function getAdjacency(
  propertyId: string,
  arrivalDate: Date,
  departureDate: Date,
): Promise<AdjacencyContext> {
  const active = { in: ["confirmed", "completed"] };
  const [prev, next] = await Promise.all([
    // The booking that checks out at or before this stay begins (closest one).
    // A reservation's own departure is always AFTER its arrival, so it can never
    // match itself here.
    prisma.reservation.findFirst({
      where: { propertyId, status: active, departureDate: { lte: arrivalDate } },
      orderBy: { departureDate: "desc" },
      select: { departureDate: true },
    }),
    // The booking that checks in at or after this stay ends (closest one).
    prisma.reservation.findFirst({
      where: { propertyId, status: active, arrivalDate: { gte: departureDate } },
      orderBy: { arrivalDate: "asc" },
      select: { arrivalDate: true },
    }),
  ]);

  return {
    previousDeparture: prev?.departureDate ?? null,
    nextArrival: next?.arrivalDate ?? null,
  };
}
