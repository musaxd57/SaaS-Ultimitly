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
  /**
   * Total stays including the current one (so "N. konaklama"). Comes from a
   * COUNT — never from `pastStays.length`, which is capped for display.
   */
  stayCount: number;
  /** The most recent other stays, newest first — at most PAST_STAYS_SHOWN. */
  pastStays: PastStay[];
}

/**
 * Kaç önceki konaklama LİSTELENİR. Kart dar bir kenar çubuğunda duruyor; 25
 * satır oraya sığmaz. Sayı (`stayCount`) ayrı bir COUNT'tan gelir, bu yüzden
 * listeyi kısaltmak rakamı ASLA bozmaz.
 *
 * Eskiden tek sorgu vardı (`take: 20`) ve sayı DÖNEN SATIRDAN türetiliyordu:
 * 25 önceki konaklaması olan misafirde rozet "21. konaklama" diyordu. Kırpma
 * değil, yanlış rakamdı — üstelik ekranda kesin bir sayı gibi duruyordu.
 */
export const PAST_STAYS_SHOWN = 5;

export async function getReturningGuestInfo(
  orgId: string,
  current: { id: string; guestExternalId: string | null },
): Promise<ReturningGuestInfo | null> {
  if (!current.guestExternalId) return null;

  const where = {
    // ORG SCOPE — joined through the property; a reservation in another tenant
    // can never enter the result set.
    property: { organizationId: orgId },
    guestExternalId: current.guestExternalId,
    id: { not: current.id }, // exclude the current reservation
    status: { not: "cancelled" as const }, // don't count dead bookings
  };

  // Sayı ve liste AYRI sorgular: liste gösterim için kısa, sayı tam. Aynı WHERE
  // ve aynı index (`@@index([guestExternalId])`) kullanılır.
  const [priorCount, rows] = await Promise.all([
    prisma.reservation.count({ where }),
    prisma.reservation.findMany({
      where,
      select: {
        id: true,
        arrivalDate: true,
        departureDate: true,
        status: true,
        property: { select: { name: true } },
      },
      orderBy: { arrivalDate: "desc" },
      take: PAST_STAYS_SHOWN,
    }),
  ]);

  if (priorCount === 0) return null;

  return {
    stayCount: priorCount + 1,
    pastStays: rows.map((r) => ({
      id: r.id,
      propertyName: r.property.name,
      arrivalDate: r.arrivalDate,
      departureDate: r.departureDate,
      status: r.status,
    })),
  };
}
