import { prisma } from "@/lib/db";
import { reservationUpdateSchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { stripReservationInternals } from "@/lib/reservation-view";
import { removeAutoTasksForCancelledReservation } from "@/lib/automation";
import { reportError } from "@/lib/report-error";
import { reopenCancelledReservation } from "@/lib/reservations/reopen";

async function findScoped(id: string, orgId: string) {
  return prisma.reservation.findFirst({
    where: { id, property: { organizationId: orgId } },
    select: { id: true, status: true },
  });
}

export const PATCH = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;
  const prev = await findScoped(id, session.organizationId);
  if (!prev) return notFound();
  const data = await readJsonCappedOrNull(req);
  const parsed = reservationUpdateSchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

  // İPTALDEN ÇIKIŞ "Yeniden aç" ile AYNI kurallardan geçer (kurucu D6, 10-15: bitmiş konaklama açılmaz, sağlayıcı satırında kanal işareti
  // aranır, denetim kaydı, eksik görevler tekrarsız; tekrar istek 409). Eskiden bu rota kuralları, denetim kaydını ve görevleri atlıyordu.
  const { status: nextStatus, ...rest } = parsed.data;
  if (prev.status === "cancelled" && nextStatus !== undefined && nextStatus !== "cancelled") {
    const outcome = await reopenCancelledReservation({
      organizationId: session.organizationId,
      actorUserId: session.actorUserId ?? session.userId,
      reservationId: id,
      to: nextStatus,
      via: "api",
    });
    if (!outcome.ok) {
      if (outcome.status === 404) return notFound();
      return Response.json({ error: outcome.error, code: outcome.code }, { status: 409 });
    }
  }
  const reopening = prev.status === "cancelled" && nextStatus !== undefined && nextStatus !== "cancelled";
  const reservation = await prisma.reservation.update({
    where: { id },
    data: reopening ? rest : parsed.data,
  });
  // Bu rota da iptal edebiliyor (arayüz kullanmıyor, API açık — Haiku 10-15): öteki iptal yollarıyla AYNI protokol, iptal commit
  // edildikten SONRA kilitli görev temizliği (`cancel-paths-lock-protocol.test.ts`). Temizlik düşerse iptal geri alınmaz; operatöre alarm.
  if (parsed.data.status === "cancelled") {
    // Zaten iptalli satıra tekrar "iptal" = ONARIM (yalnız başlanmamış + dokunulmamış görev; kurucu D5, Haiku 10-15).
    await removeAutoTasksForCancelledReservation(id, { repair: prev.status === "cancelled" }).catch((err: unknown) =>
      void reportError("reservations.patch.tasks", err),
    );
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
