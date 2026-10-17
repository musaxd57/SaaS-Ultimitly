import { prisma } from "@/lib/db";
import { reservationUpdateSchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { stripReservationInternals } from "@/lib/reservation-view";
import { removeAutoTasksForCancelledReservation } from "@/lib/automation";
import { reportError } from "@/lib/report-error";
import { REOPEN_ERRORS, reopenCancelledReservation } from "@/lib/reservations/reopen";

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
  // DURUM YAZIMI KOŞULLU (Opus O2 / O8): `prev` kilitsiz okundu; arada senkron satırı iptal edebilir ya da yeniden onaylayabilir.
  //  · iptal-dışı durum yazımı yalnız satır HÂLÂ iptal değilse — arada iptal edildiyse 409 (yeniden açma "Yeniden aç" kurallarından geçer).
  //  · iptal yazımında geçiş mi onarım mı, okumaya değil yazımın KENDİSİNE bakılır (count 1 = bu istek iptal etti → tam küme temizlik).
  const scope = { id, property: { organizationId: session.organizationId } };
  let cancelledNow = false;
  if (!reopening && nextStatus !== undefined && nextStatus !== "cancelled") {
    const res = await prisma.reservation.updateMany({ where: { ...scope, status: { not: "cancelled" } }, data: parsed.data });
    if (res.count === 0) return Response.json({ error: REOPEN_ERRORS.stale, code: "stale" }, { status: 409 });
  } else if (nextStatus === "cancelled") {
    const res = await prisma.reservation.updateMany({ where: { ...scope, status: { not: "cancelled" } }, data: parsed.data });
    cancelledNow = res.count === 1;
    if (!cancelledNow && Object.keys(rest).length > 0) await prisma.reservation.updateMany({ where: scope, data: rest });
  } else {
    await prisma.reservation.updateMany({ where: scope, data: reopening ? rest : parsed.data });
  }
  const reservation = await prisma.reservation.findFirst({ where: scope });
  if (!reservation) return notFound();
  // Bu rota da iptal edebiliyor (arayüz kullanmıyor, API açık — Haiku 10-15): öteki iptal yollarıyla AYNI protokol, iptal commit
  // edildikten SONRA kilitli görev temizliği (`cancel-paths-lock-protocol.test.ts`). Temizlik düşerse iptal geri alınmaz; operatöre alarm.
  if (nextStatus === "cancelled") {
    // Bu istek iptal ETMEDİYSE (satır zaten iptaldi) = ONARIM (yalnız başlanmamış + dokunulmamış görev; kurucu D5, Haiku 10-15).
    await removeAutoTasksForCancelledReservation(id, { repair: !cancelledNow }).catch((err: unknown) =>
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
