import type { Prisma } from "@prisma/client";
import { onOrAfterTodayRange, reservationDayRangeWhere } from "@/lib/day-where";

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
    tasks: { none: { type: "cleaning" } },
    AND: [reservationDayRangeWhere("departureDate", onOrAfterTodayRange(now, tz), tz)],
  };
}
