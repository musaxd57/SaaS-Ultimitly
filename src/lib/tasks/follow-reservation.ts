// ---------------------------------------------------------------------------
// YAŞAM DÖNGÜSÜ GÖREVLERİ REZERVASYON TARİHİNİ İZLER (C-16, dilim 4a). Giriş hazırlığı ve çıkış temizliği rezervasyon
// oluşurken bir kez yazılır (`createReservationTasks`, tür başına idempotent); konaklama uzayınca / kısalınca görev
// ESKİ günde kalıyordu → temizlikçi yanlış güne gider, erken giriş hazırlığı o devrin temizliğini bulamaz.
//
// Kural (tarih değişiminin OLDUĞU yerde, aynı TX'te): AÇIK (bitmemiş) SİSTEM görevi, tarihi ESKİ rezervasyon tarihine
// BİREBİR eşitse — yani sistemin yazdığı gibi duruyorsa — yeni tarihe taşınır. Host görevi elle başka güne/saate
// taşıdıysa (tarih eşit değil), görev bittiyse (geçmiş kayıt) ya da elle / mesajdan açıldıysa DOKUNULMAZ. Yazma yolları:
// kanal senkronu (canonical yazma servisi), takvim bağlantısı (iCal), dosyadan içe aktarma. Rezervasyon satırı zaten
// kiracı kapsamlı yoldan geldi; görev yalnız O rezervasyona bağlı olanlardır.
// ---------------------------------------------------------------------------

import type { ErasureDb } from "@/lib/erasure";

export interface StayDates {
  arrivalDate: Date;
  departureDate: Date;
}

/** Hangi görev türü hangi rezervasyon tarihine bağlı (`createReservationTasks` ile aynı eşleme). */
const LIFECYCLE_DATE: readonly { type: string; field: keyof StayDates }[] = [
  { type: "checkin_prep", field: "arrivalDate" },
  { type: "cleaning", field: "departureDate" },
];

/** Taşınan görev sayısı. Tarih değişmediyse sorgu atmaz. */
export async function followReservationDates(
  db: ErasureDb,
  reservationId: string,
  before: StayDates,
  after: StayDates,
): Promise<number> {
  let moved = 0;
  for (const { type, field } of LIFECYCLE_DATE) {
    if (before[field].getTime() === after[field].getTime()) continue;
    const { count } = await db.task.updateMany({
      where: { reservationId, origin: "system", type, status: { not: "done" }, dueAt: before[field] },
      data: { dueAt: after[field] },
    });
    moved += count;
  }
  return moved;
}
