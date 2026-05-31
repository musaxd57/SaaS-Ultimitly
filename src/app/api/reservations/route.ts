import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { reservationSchema, zodFieldErrors } from "@/lib/validators";
import {
  requireSession,
  unauthorized,
  badRequest,
  jsonOk,
  serverError,
  propertyInOrg,
} from "@/lib/api";
import { applyReservationCreatedRules } from "@/lib/automation";

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId") ?? undefined;
  const status = searchParams.get("status") ?? undefined;

  const reservations = await prisma.reservation.findMany({
    where: {
      property: { organizationId: session.organizationId },
      ...(propertyId ? { propertyId } : {}),
      ...(status ? { status } : {}),
    },
    include: { property: { select: { name: true } } },
    orderBy: { arrivalDate: "desc" },
  });
  return jsonOk(reservations);
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  try {
    const data = await req.json().catch(() => null);
    const parsed = reservationSchema.safeParse(data);
    if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
    const d = parsed.data;

    if (!(await propertyInOrg(d.propertyId, session.organizationId))) {
      return badRequest({ propertyId: "Geçersiz mülk" });
    }

    const reservation = await prisma.reservation.create({
      data: {
        propertyId: d.propertyId,
        guestName: d.guestName,
        guestPhone: d.guestPhone || null,
        guestEmail: d.guestEmail || null,
        arrivalDate: d.arrivalDate,
        departureDate: d.departureDate,
        channel: d.channel,
        status: d.status,
        totalAmount: typeof d.totalAmount === "number" ? d.totalAmount : null,
        currency: d.currency,
        sourceReference: d.sourceReference || null,
        notes: d.notes || null,
      },
    });

    // Fixed automation: prepare check-in & cleaning tasks.
    await applyReservationCreatedRules(reservation.id);

    return jsonOk(reservation, 201);
  } catch {
    return serverError();
  }
}
