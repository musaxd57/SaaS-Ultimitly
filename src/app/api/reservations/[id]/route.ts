import { prisma } from "@/lib/db";
import { reservationUpdateSchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { stripReservationInternals } from "@/lib/reservation-view";
import { removeAutoTasksForCancelledReservation } from "@/lib/automation";
import { reportError } from "@/lib/report-error";

async function findScoped(id: string, orgId: string) {
  return prisma.reservation.findFirst({
    where: { id, property: { organizationId: orgId } },
    select: { id: true },
  });
}

export const PATCH = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;
  if (!(await findScoped(id, session.organizationId))) return notFound();
  const data = await readJsonCappedOrNull(req);
  const parsed = reservationUpdateSchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

  const reservation = await prisma.reservation.update({
    where: { id },
    data: parsed.data,
  });
  // Bu rota da iptal edebiliyor (arayüz kullanmıyor, API açık — Haiku 10-15): öteki iptal yollarıyla AYNI protokol, iptal commit
  // edildikten SONRA kilitli görev temizliği (`cancel-paths-lock-protocol.test.ts`). Temizlik düşerse iptal geri alınmaz; operatöre alarm.
  if (parsed.data.status === "cancelled") {
    await removeAutoTasksForCancelledReservation(id).catch((err: unknown) => void reportError("reservations.patch.tasks", err));
  }
  return jsonOk(stripReservationInternals(reservation));
});

export const DELETE = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  const result = await prisma.reservation.deleteMany({
    where: { id, property: { organizationId: session.organizationId } },
  });
  if (result.count === 0) return notFound();
  return jsonOk({ ok: true });
});
