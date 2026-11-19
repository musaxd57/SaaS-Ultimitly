import { prisma } from "@/lib/db";
import { deleteReservationsWithAutoTasks } from "@/lib/automation";
import {
  bookingRowSourceClass,
  isRemovableBookingRowClass,
  REMOVABLE_BOOKING_ROW_WHERE,
  type BookingRowSourceClass,
} from "@/lib/booking-row-source";

// ---------------------------------------------------------------------------
// ELLE GİRİLEN KOPYAYI KALDIR (UA-1, kurucu 11-19; tasarım `docs/TASARIM-2026-11-19-ua1-kayitlari-karsilastir.md` §2 "Sunucu kuralı").
//
// "Kayıtları karşılaştır" sayfasının kaldırma isteği buradan geçer ve YALNIZ elle / dosya sınıfındaki satırı siler. Takvim / kanal satırı
// silinirse sonraki senkron onu geri getirir (iz yalnız KVKK silmesinde var) → 409. Silmenin kendisi var olan yol
// (`deleteReservationsWithAutoTasks`: rezervasyon kilidi + başlanmamış sistem görevleri); sınıf kuralı o işlemin İÇİNDE, satır kilitli
// yeniden uygulanır. Var olan genel silme ucunun (`DELETE /api/reservations/[id]`) davranışı DEĞİŞMEDİ.
// ---------------------------------------------------------------------------

/** 409 metni — tasarımdaki cümle AYNEN (kurucu onayı bekliyor, UA-a). */
export const MANUAL_COPY_SOURCE_BOUND_ERROR = "Bu kayıt kaynağından geliyor; silinirse geri gelir.";

export type RemoveManualCopyResult =
  | { kind: "removed"; propertyId: string; sourceClass: BookingRowSourceClass }
  | { kind: "not_found" }
  | { kind: "source_bound" };

/** Test kancası: sınıf okunduktan SONRA, silme işleminden ÖNCE (yarış testi — arada satır kaynağa bağlanır). */
export const __manualCopyHooks: { afterClassRead: null | (() => Promise<void>) } = { afterClassRead: null };

export async function removeManualBookingCopy(input: { organizationId: string; reservationId: string }): Promise<RemoveManualCopyResult> {
  const scope = { id: input.reservationId, property: { organizationId: input.organizationId } };
  const row = await prisma.reservation.findFirst({
    where: scope,
    select: { propertyId: true, calendarSourceId: true, connectionId: true, channel: true, guestNameSource: true },
  });
  if (!row) return { kind: "not_found" };
  const sourceClass = bookingRowSourceClass(row);
  if (!isRemovableBookingRowClass(sourceClass)) return { kind: "source_bound" };
  if (__manualCopyHooks.afterClassRead) await __manualCopyHooks.afterClassRead();
  const deleted = await deleteReservationsWithAutoTasks([input.reservationId], input.organizationId, {
    onlyWhere: REMOVABLE_BOOKING_ROW_WHERE,
  });
  if (deleted === 1) return { kind: "removed", propertyId: row.propertyId, sourceClass };
  // Silinmediyse sebebi yeniden okunur: arada kaynağa bağlandı (satır yerinde → 409) ya da başka yoldan silindi (404).
  const still = await prisma.reservation.findFirst({ where: scope, select: { id: true } });
  return still ? { kind: "source_bound" } : { kind: "not_found" };
}
