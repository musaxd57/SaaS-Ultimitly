import { jsonOk, notFound } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { reopenCancelledReservation } from "@/lib/reservations/reopen";

// ---------------------------------------------------------------------------
// "GERÇEKTEN ETKİN — YENİDEN AÇ" (H2, kurucu kararı 10-13 "Evet, düğme ekle").
//
// G9'dan beri kanal iptal edilmiş bir rezervasyonu yeniden etkin gösterirse satır İPTAL kalır ve panelde "kanaldan kontrol edin" satırı
// çıkar. Misafir rezervasyonu gerçekten geri aldıysa ev sahibi buradan yeniden açar: rezervasyon "onaylı"ya döner (sonraki senkron kanalın
// gerçek durumuna eşitler), eksik yaşam döngüsü görevleri tekrarsız oluşturulur, karşılama / giriş mesajları normal akışa girer.
// Kurallar TEK YERDE (`lib/reservations/reopen.ts`, kurucu D6 10-15: API ve panel AYNI yeniden açma kuralları). Yalnız sahip / yönetici
// (`withManage`); bürünmede (destek görünümü) yazma kapalı (`withAuth`).
// ---------------------------------------------------------------------------

export const POST = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  const outcome = await reopenCancelledReservation({
    organizationId: session.organizationId,
    actorUserId: session.actorUserId ?? session.userId,
    reservationId: id,
    via: "panel",
  });
  if (outcome.ok) return jsonOk({ ok: true });
  if (outcome.status === 404) return notFound();
  return Response.json({ error: outcome.error, code: outcome.code }, { status: 409 });
});
