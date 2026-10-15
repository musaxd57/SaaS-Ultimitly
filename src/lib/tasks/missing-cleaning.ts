import type { Prisma } from "@prisma/client";
import { onOrAfterTodayRange, reservationDayRangeWhere } from "@/lib/day-where";
import { prisma } from "@/lib/db";
import { LIFECYCLE_TASK_LITE_SELECT, lifecycleTaskPresent } from "@/lib/tasks/lifecycle-presence";

/**
 * Görevler sayfasındaki "Eksik görevleri oluştur (N)" sayısı: çıkış temizliği görevi OLMAYAN, iptal edilmemiş ve çıkışı
 * org gününe göre bugün ya da sonra olan rezervasyonlar. `createReservationTasks` ile AYNI gün kuralı (`onOrAfterToday`)
 * — düğmedeki sayı ile tıklayınca açılan temizlik görevi sayısı birbirini tutar (pinli). Eskiden ham `gün başı` kıyası
 * New York'ta bugün çıkan konaklamayı saymıyordu (düğme hiç görünmüyordu).
 */
export function reservationsMissingCleaningWhere(organizationId: string, now: Date, tz: string): Prisma.ReservationWhereInput {
  return {
    property: { organizationId },
    status: { not: "cancelled" },
    // Kurucu D7 (10-15): yalnız SİSTEMİN açtığı BİTMEMİŞ temizlik "var" sayılır (elle / söz / mesaj görevi saymaz); bitmiş sistem
    // temizliği yalnız AYNI çıkış günüyse sayılır → o kısım satır satır `countReservationsMissingCleaning`te (sütun-sütun kıyas SQL'de yok).
    tasks: { none: { type: "cleaning", origin: "system", status: { not: "done" } } },
    AND: [reservationDayRangeWhere("departureDate", onOrAfterTodayRange(now, tz), tz)],
  };
}

/** "Eksik görevleri oluştur (N)" sayısı — `createReservationTasks` ile AYNI "zaten var mı?" kuralı (`lifecycleTaskPresent`): bitmiş
 *  sistem temizliği yalnız rezervasyonun ŞİMDİKİ çıkış günündeyse eksikliği kapatır (çıkış tarihi sonradan değiştiyse eski bitmiş iş
 *  yeni günün temizliği sayılmaz — kurucu D7). */
export async function countReservationsMissingCleaning(organizationId: string, now: Date, tz: string): Promise<number> {
  const rows = await prisma.reservation.findMany({
    where: reservationsMissingCleaningWhere(organizationId, now, tz),
    select: {
      departureDate: true,
      tasks: { where: { type: "cleaning", origin: "system", status: "done" }, select: LIFECYCLE_TASK_LITE_SELECT },
    },
  });
  return rows.filter((r) => !lifecycleTaskPresent("cleaning", r.departureDate, r.tasks, tz)).length;
}
