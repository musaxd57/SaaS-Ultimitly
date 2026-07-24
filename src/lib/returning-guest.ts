import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Returning-guest lookup.
//
// Matches strictly on the Hospitable stable guest id (Reservation.guestExternalId)
// — the only RELIABLE per-person key (Airbnb masks email/phone, and name
// collides). No name/email fuzzy matching, so there are no false "welcome back"
// positives. Returns null unless the current reservation has a guest id AND at
// least one other (non-cancelled) stay shares it.
// ---------------------------------------------------------------------------

export interface PastStay {
  id: string;
  propertyName: string;
  arrivalDate: Date;
  departureDate: Date;
  status: string;
}

export interface ReturningGuestInfo {
  /** Total stays including the current one (so "N. konaklama"). */
  stayCount: number;
  /** The other stays, newest first. */
  pastStays: PastStay[];
}

export async function getReturningGuestInfo(
  orgId: string,
  current: { id: string; guestExternalId: string | null },
): Promise<ReturningGuestInfo | null> {
  if (!current.guestExternalId) return null;

  const rows = await prisma.reservation.findMany({
    where: {
      // ORG SCOPE — joined through the property; a reservation in another tenant
      // can never enter the result set.
      property: { organizationId: orgId },
      guestExternalId: current.guestExternalId,
      id: { not: current.id }, // exclude the current reservation
      status: { not: "cancelled" }, // don't count dead bookings
    },
    select: {
      id: true,
      arrivalDate: true,
      departureDate: true,
      status: true,
      property: { select: { name: true } },
    },
    orderBy: { arrivalDate: "desc" },
    take: 20,
  });

  if (rows.length === 0) return null;

  return {
    stayCount: rows.length + 1,
    pastStays: rows.map((r) => ({
      id: r.id,
      propertyName: r.property.name,
      arrivalDate: r.arrivalDate,
      departureDate: r.departureDate,
      status: r.status,
    })),
  };
}
