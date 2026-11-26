import { addNights, calendarDateOf, todayKey, type NightKey } from "@/modules/availability/core";
import { currentHourInTimeZone, zonedWallClockToUtc } from "@/lib/timezone";
import { CHECKIN_LEAD_DAYS, CHECKIN_SEND_HOUR } from "@/lib/lifecycle-window";

/**
 * OTOMATİK giriş bilgisi mesajının penceresi (GM-1, kurucu 11-26: "gece 3'de gitmesin, 4 gün önceden alınmışsa saat tam 10'da gitmiş olsun").
 *
 * Eski kural ANLIKTI ("varış ânı ≤ şimdi + 4 gün"): sağlayıcı tarihi gece yarısı (UTC) sakladığı için pencere İstanbul'da gece 03:00'te
 * açılıyor, mesaj ilk turda o saatte gidiyordu. Yeni kural GÜNE göredir: pencere, varış GÜNÜNDEN `CHECKIN_LEAD_DAYS` gün önceki günün
 * işletme saatiyle `CHECKIN_SEND_HOUR`:00'ında açılır ve varışa kadar açık kalır. Son dakika rezervasyonu (pencere çoktan açık) eskisi gibi
 * ilk turda gider — misafir o anda rezervasyon yapmıştır, bekletilmez.
 *
 * TEK KAYNAK: aday seçimi (`sendDueCheckins`), otomatik yolun son talebi (`claimAndSendCheckin`) ve kuyruk işçisinin ertelemesi
 * (`outbox/worker.ts checkinNotYetDue`) aynı iki işlevi kullanır. Ev sahibinin Girişler'den ELLE gönderimi bu saat kuralına tabi değildir.
 */

/** `now` anında giriş bilgisi gidebilecek EN GEÇ varış günü (işletme takvimi). Saat 10:00'dan önce bir gün daha yakındır. */
export function checkinLatestArrivalDay(now: Date, timeZone: string): NightKey {
  const lead = currentHourInTimeZone(timeZone, now) >= CHECKIN_SEND_HOUR ? CHECKIN_LEAD_DAYS : CHECKIN_LEAD_DAYS - 1;
  return addNights(todayKey(now, timeZone), lead);
}

/** Bu varış için pencerenin açıldığı an: varış gününden `CHECKIN_LEAD_DAYS` gün önce, işletme saatiyle `CHECKIN_SEND_HOUR`:00. */
export function checkinWindowOpensAt(arrivalDate: Date, timeZone: string): Date {
  const [y, m, d] = addNights(calendarDateOf(arrivalDate, timeZone).key, -CHECKIN_LEAD_DAYS).split("-").map(Number);
  return zonedWallClockToUtc(y, m, d, CHECKIN_SEND_HOUR, 0, 0, timeZone);
}
