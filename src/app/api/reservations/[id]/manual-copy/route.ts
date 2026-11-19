import { jsonOk, notFound } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { auditActor, writeAudit } from "@/lib/audit";
import { MANUAL_COPY_SOURCE_BOUND_ERROR, removeManualBookingCopy } from "@/lib/reservations/remove-manual-copy";

// ---------------------------------------------------------------------------
// "Kayıtları karşılaştır" → elle girilen kopyayı kaldır (UA-1, kurucu 11-19). Sahip / yönetici (`withManage`; personel 403, bürünme
// yazamaz). Yalnız elle / dosya sınıfındaki satır silinir; takvim / kanal satırı 409 (silinirse sonraki senkron geri getirir). Başka
// işletmenin satırı 404 (varlık sızdırılmaz). Kural ve silme `lib/reservations/remove-manual-copy.ts`te.
// ---------------------------------------------------------------------------

export const DELETE = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  const result = await removeManualBookingCopy({ organizationId: session.organizationId, reservationId: id });
  if (result.kind === "not_found") return notFound();
  if (result.kind === "source_bound") return Response.json({ error: MANUAL_COPY_SOURCE_BOUND_ERROR }, { status: 409 });
  // Denetim kaydı kimlik + sınıf taşır (misafir adı / kaynak kimliği yazılmaz).
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "reservation.manual_copy_removed",
    metadata: { reservationId: id, propertyId: result.propertyId, sourceClass: result.sourceClass },
  });
  return jsonOk({ ok: true });
});
