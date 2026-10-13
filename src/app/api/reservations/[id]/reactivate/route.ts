import { prisma } from "@/lib/db";
import { jsonOk, notFound } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { createReservationTasks } from "@/lib/automation";
import { REACTIVATION_ATTENTION_DAYS, REACTIVATION_BLOCKED_FIELD } from "@/lib/ingest/reactivation";

// ---------------------------------------------------------------------------
// "GERÇEKTEN ETKİN — YENİDEN AÇ" (H2, kurucu kararı 10-13 "Evet, düğme ekle").
//
// G9'dan beri kanal iptal edilmiş bir rezervasyonu yeniden etkin gösterirse satır İPTAL kalır ve panelde "kanaldan kontrol edin" satırı
// çıkar. Misafir rezervasyonu gerçekten geri aldıysa ev sahibi buradan yeniden açar: rezervasyon "onaylı"ya döner (sonraki senkron kanalın
// gerçek durumuna eşitler), eksik yaşam döngüsü görevleri tekrarsız oluşturulur, karşılama / giriş mesajları normal akışa girer.
// Kurallar:
//  · Yalnız sahip / yönetici (`withManage`); bürünmede (destek görünümü) yazma kapalı (`withAuth`).
//  · Yalnız İPTAL edilmiş VE son REACTIVATION_ATTENTION_DAYS günde kanalın etkin gösterdiği rezervasyon — panel satırı olmayan bir iptali
//    bu yoldan açmak mümkün değil (409).
//  · Koşullu yazma (yarış: iki tık / arada kanalın iptali) + denetim kaydı.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function conflict(code: string, error: string) {
  return Response.json({ error, code }, { status: 409 });
}

export const POST = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  const reservation = await prisma.reservation.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    select: { id: true, status: true },
  });
  if (!reservation) return notFound();
  if (reservation.status !== "cancelled") return conflict("not_cancelled", "Bu rezervasyon zaten etkin.");

  const signal = await prisma.ingestEvent.findFirst({
    where: {
      organizationId: session.organizationId,
      entityType: "reservation",
      entityId: id,
      kind: "reservation.updated",
      changedFieldsJson: { contains: REACTIVATION_BLOCKED_FIELD },
      occurredAt: { gte: new Date(Date.now() - REACTIVATION_ATTENTION_DAYS * DAY_MS) },
    },
    select: { id: true },
  });
  if (!signal) return conflict("no_channel_signal", "Kanal bu rezervasyonu etkin göstermiyor; yeniden açılamaz.");

  const reopened = await prisma.reservation.updateMany({
    where: { id, status: "cancelled", property: { organizationId: session.organizationId } },
    data: { status: "confirmed" },
  });
  if (reopened.count === 0) return conflict("stale", "Rezervasyonun durumu az önce değişti. Sayfayı yenileyin.");

  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: session.actorUserId ?? session.userId,
    action: "reservation.reactivated",
    metadata: { reservationId: id },
  });
  // İptal edilmiş rezervasyona üretilmemiş giriş hazırlığı / temizlik görevleri (tekrarsız; geçmiş tarihli konaklamada üretmez).
  await createReservationTasks(id);
  return jsonOk({ ok: true });
});
