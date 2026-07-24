import { prisma } from "@/lib/db";
import { toAmountDec } from "@/lib/money";
import { reservationSchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, propertyInOrg, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { applyReservationCreatedRules } from "@/lib/automation";

export const GET = withManage(async (session, req) => {
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
    take: 500, // bound the payload — full guest PII, no pagination yet
  });
  return jsonOk(reservations);
});

export const POST = withManage(async (session, req) => {
  const data = await readJsonCappedOrNull(req);
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
      totalAmountDec: toAmountDec(typeof d.totalAmount === "number" ? d.totalAmount : null),
      currency: d.currency,
      sourceReference: d.sourceReference || null,
      notes: d.notes || null,
    },
  });

  // Fixed automation: prepare check-in & cleaning tasks.
  await applyReservationCreatedRules(reservation.id);

  return jsonOk(reservation, 201);
});
