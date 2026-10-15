// ---------------------------------------------------------------------------
// İPTAL EDİLMİŞ REZERVASYONU YENİDEN AÇMA — TEK KURAL (kurucu D6, 10-15, aynen: "API ve panel aynı yeniden açma kurallarını kullansın;
// yetki kontrolü, işlem kaydı ve otomatik görev ayarı korunsun. Sağlayıcıya ait olmayan rezervasyonda sağlayıcı işareti aranmasın.
// Tekrarlanan istek ikinci görev oluşturmasın.")
//
// Çağıranlar: "Gerçekten etkin — yeniden aç" düğmesi (`POST /api/reservations/[id]/reactivate`, H2) ve `PATCH /api/reservations/[id]`
// (iptalliyken `status` istenirse). İkisi de `withManage` (sahip / yönetici; bürünmede yazma kapalı) arkasında.
// Kurallar:
//  · Yalnız İPTAL edilmiş rezervasyon (değilse 409 — tekrarlanan istek böylece ikinci görev açamaz).
//  · Konaklaması bitmiş rezervasyon açılmaz (çıkış günü işletmenin takviminde bugünden önce; çıkış günü açılabilir).
//  · SAĞLAYICIYA AİT satırda (kanıtlı bağlantı damgası — `hasProvenConnection`) kanal son REACTIVATION_ATTENTION_DAYS günde rezervasyonu
//    etkin göstermiş olmalı; dosya / takvim bağlantısı / elle girilmiş satırda bu işaret ARANMAZ (o kaynaklar böyle bir işaret üretmez —
//    yanlışlıkla iptal edilmiş dosya satırını geri açmanın tek yolu buydu).
//  · Koşullu yazma (iki tık / arada kanalın iptali yarışı) + denetim kaydı + eksik yaşam döngüsü görevleri (tekrarsız, kilitli yol).
// ---------------------------------------------------------------------------
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { createReservationTasks } from "@/lib/automation";
import { reportError } from "@/lib/report-error";
import { REACTIVATION_ATTENTION_DAYS, REACTIVATION_BLOCKED_FIELD } from "@/lib/ingest/reactivation";
import { hasProvenConnection } from "@/lib/channels/provenance";
import { stayEndedBefore } from "@/modules/availability/core";
import { orgTimezone } from "@/lib/timezone";

const DAY_MS = 24 * 60 * 60 * 1000;

export type ReopenStatus = "confirmed" | "pending" | "completed";

export type ReopenOutcome =
  | { ok: true }
  | { ok: false; status: 404 }
  | { ok: false; status: 409; code: "not_cancelled" | "past_stay" | "no_channel_signal" | "stale"; error: string };

export const REOPEN_ERRORS = {
  not_cancelled: "Bu rezervasyon zaten etkin.",
  past_stay: "Konaklaması bitmiş rezervasyon yeniden açılamaz.",
  no_channel_signal: "Kanal bu rezervasyonu etkin göstermiyor; yeniden açılamaz.",
  stale: "Rezervasyonun durumu az önce değişti. Sayfayı yenileyin.",
} as const;

const conflict = (code: keyof typeof REOPEN_ERRORS): ReopenOutcome => ({ ok: false, status: 409, code, error: REOPEN_ERRORS[code] });

export async function reopenCancelledReservation(input: {
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  /** İstenen yeni durum (düğme "onaylı"; PATCH istenen durumu gönderebilir). */
  to?: ReopenStatus;
  /** Denetim kaydında hangi yüzeyden geldiği. */
  via: "panel" | "api";
  now?: Date;
}): Promise<ReopenOutcome> {
  const now = input.now ?? new Date();
  const to = input.to ?? "confirmed";
  const reservation = await prisma.reservation.findFirst({
    where: { id: input.reservationId, property: { organizationId: input.organizationId } },
    select: {
      id: true,
      status: true,
      departureDate: true,
      connectionId: true,
      connectionEvidence: true,
      ingestedAt: true,
      property: { select: { organization: { select: { timezone: true } } } },
    },
  });
  if (!reservation) return { ok: false, status: 404 };
  if (reservation.status !== "cancelled") return conflict("not_cancelled");
  const tz = orgTimezone(reservation.property.organization.timezone);
  if (stayEndedBefore(reservation.departureDate, now, tz)) return conflict("past_stay");

  if (hasProvenConnection(reservation)) {
    const signal = await prisma.ingestEvent.findFirst({
      where: {
        organizationId: input.organizationId,
        entityType: "reservation",
        entityId: reservation.id,
        kind: "reservation.updated",
        changedFieldsJson: { contains: REACTIVATION_BLOCKED_FIELD },
        occurredAt: { gte: new Date(now.getTime() - REACTIVATION_ATTENTION_DAYS * DAY_MS) },
      },
      select: { id: true },
    });
    if (!signal) return conflict("no_channel_signal");
  }

  const reopened = await prisma.reservation.updateMany({
    where: { id: reservation.id, status: "cancelled", property: { organizationId: input.organizationId } },
    data: { status: to },
  });
  if (reopened.count === 0) return conflict("stale");

  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: "reservation.reactivated",
    metadata: { reservationId: reservation.id, via: input.via, to },
  });
  // Eksik giriş hazırlığı / temizlik görevleri (tekrarsız; geçmiş tarihli konaklamada üretmez). Hata yanıtı bozmaz: rezervasyon AÇILDI
  // (hata dönmek düğmeyi "zaten etkin" 409'una iterdi); arıza raporlanır. `reopened`: kilitsiz hızlı yol atlanır — süren bir iptal
  // temizliğinin henüz silmediği eski görevleri "var" sayıp çıkmasın (Opus O1).
  try {
    await createReservationTasks(reservation.id, { reopened: true });
  } catch (err) {
    void reportError("reservation-reactivate-tasks", err);
  }
  return { ok: true };
}
