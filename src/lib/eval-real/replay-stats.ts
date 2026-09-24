// ---------------------------------------------------------------------------
// GEÇMİŞ MİSAFİR MESAJLARININ TOPLU TARAMASI — SAF (09-24, kurucu: "admin hesabından önceden çektiğimiz her mesajla
// kontrol edebilir miyiz"). Etiketsiz; yalnız SAYI üretir — mesaj metni, ad, kimlik, tarih çıktıya GİRMEZ. Model
// ÇAĞRILMAZ: yalnız deterministik katman (kelime ağı) + veritabanı olguları. Sorular:
//  · Konaklama değişikliği istekleri ne sıklıkta (birleşim kuralının "insana" payının ALT SINIRI — kelime ağı yalnız
//    yedektir, kör bataryada izinlerin 19/60'ını görür; model katmanlarının oranı Set B + kredi ister).
//  · Yalnız erken giriş isteklerinden kaçı varış günü, aynı gün devirde geldi; o devirde temizlik görevi var mıydı;
//    misafir sorduğunda daire HAZIR mıydı, yoksa standart girişe kadar mı hazır oldu (temizlik sonrası yeniden
//    değerlendirmenin — `early-checkin/recheck.ts` — kaç isteği kurtaracağı)?
// Hazırlık kuralı ürünle AYNI (`early-checkin/readiness.ts`); tarih kuralı ürünle AYNI (`calendarDateOf`).
// ---------------------------------------------------------------------------

import { detectAvailabilityRequestKinds, type AvailabilityRequestKind } from "@/lib/ai/availability-claims";
import { calendarDateOf } from "@/modules/availability/core";
import { laterTime, readinessOf, wallClockMoment } from "@/lib/early-checkin/readiness";

export interface ReplayProperty {
  id: string;
  checkInTime: string | null;
  checkOutTime: string | null;
}
export interface ReplayReservation {
  id: string;
  propertyId: string;
  status: string;
  arrivalDate: Date;
  departureDate: Date;
  guestCheckoutTime: string | null;
}
export interface ReplayCleaning {
  propertyId: string;
  reservationId: string | null;
  dueAt: Date | null;
  status: string;
  /** Görevi "bitti" yapan en son kaydın zamanı. */
  doneAt: Date | null;
}
export interface ReplayMessage {
  body: string;
  createdAt: Date;
  propertyId: string;
  reservationId: string | null;
}
export interface ReplayInput {
  timeZone: string;
  properties: readonly ReplayProperty[];
  reservations: readonly ReplayReservation[];
  cleanings: readonly ReplayCleaning[];
  messages: readonly ReplayMessage[];
}

export interface ReplayStats {
  version: 1;
  /** Taranan misafir mesajı. */
  messages: number;
  /** Kelime ağının konaklama değişikliği saydığı mesajlar (tür başına; bir mesaj birden çok türde olabilir). */
  stayRequests: Record<AvailabilityRequestKind | "any" | "multiKind", number>;
  /** YALNIZ erken giriş (başka tür yok) istekleri ve doğrulanmış akışın göreceği olgular. */
  earlyOnly: {
    total: number;
    withReservation: number;
    askedOnArrivalDay: number;
    askedBeforeArrivalDay: number;
    askedAfterArrivalDay: number;
    /** Varış günü sorulanlardan: aynı gün ayrılan önceki misafir vardı. */
    sameDayTurnover: number;
    /** Aynı gün devirlerden: o devrin (çıkış günü) temizlik görevi vardı. */
    cleaningTaskFound: number;
    /** Görevi olanlardan: misafir sorduğunda daire hazırdı (kural: hepsi kapalı + çıkıştan sonra ≥5 dk). */
    readyWhenAsked: number;
    /** Sorduğunda hazır değildi ama standart girişe kadar hazır oldu (temizlik sonrası yeniden değerlendirme payı). */
    readyLaterSameDay: number;
    /** Standart girişe kadar da hazır işaretlenmedi. */
    neverReadyByCheckIn: number;
  };
  /** Yalnız erken giriş sorularının yerel saat dağılımı (0–23). */
  askHourLocal: number[];
}

const KINDS: readonly AvailabilityRequestKind[] = ["early", "late", "extend", "date_change", "availability"];

function localHour(d: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(d);
  const n = Number(h);
  return Number.isInteger(n) && n >= 0 && n < 24 ? n : 0;
}

export function replayStats(input: ReplayInput): ReplayStats {
  const tz = input.timeZone;
  const propById = new Map(input.properties.map((p) => [p.id, p]));
  const resById = new Map(input.reservations.map((r) => [r.id, r]));
  const live = input.reservations.filter((r) => r.status !== "cancelled");
  const stats: ReplayStats = {
    version: 1,
    messages: input.messages.length,
    stayRequests: { any: 0, multiKind: 0, early: 0, late: 0, extend: 0, date_change: 0, availability: 0 },
    earlyOnly: {
      total: 0,
      withReservation: 0,
      askedOnArrivalDay: 0,
      askedBeforeArrivalDay: 0,
      askedAfterArrivalDay: 0,
      sameDayTurnover: 0,
      cleaningTaskFound: 0,
      readyWhenAsked: 0,
      readyLaterSameDay: 0,
      neverReadyByCheckIn: 0,
    },
    askHourLocal: Array.from({ length: 24 }, () => 0),
  };

  for (const m of input.messages) {
    const kinds = detectAvailabilityRequestKinds(m.body);
    if (kinds.length === 0) continue;
    stats.stayRequests.any++;
    if (kinds.length > 1) stats.stayRequests.multiKind++;
    for (const k of KINDS) if (kinds.includes(k)) stats.stayRequests[k]++;
    if (kinds.length !== 1 || kinds[0] !== "early") continue;

    const e = stats.earlyOnly;
    e.total++;
    stats.askHourLocal[localHour(m.createdAt, tz)]++;
    const own = m.reservationId ? resById.get(m.reservationId) : undefined;
    const prop = propById.get(m.propertyId);
    if (!own || !prop) continue;
    e.withReservation++;
    const arrivalKey = calendarDateOf(own.arrivalDate, tz).key;
    const askKey = calendarDateOf(m.createdAt, tz).key;
    if (askKey < arrivalKey) {
      e.askedBeforeArrivalDay++;
      continue;
    }
    if (askKey > arrivalKey) {
      e.askedAfterArrivalDay++;
      continue;
    }
    e.askedOnArrivalDay++;
    const previous = live
      .filter((r) => r.id !== own.id && r.propertyId === own.propertyId)
      .filter((r) => calendarDateOf(r.departureDate, tz).key === arrivalKey && calendarDateOf(r.arrivalDate, tz).key < arrivalKey)
      .map((r) => ({ r, checkout: laterTime(r.guestCheckoutTime, prop.checkOutTime) }))[0];
    if (!previous) continue;
    e.sameDayTurnover++;
    const tasks = input.cleanings.filter(
      (t) =>
        t.propertyId === own.propertyId &&
        (t.reservationId === previous.r.id || t.reservationId === null) &&
        t.dueAt !== null &&
        calendarDateOf(t.dueAt, tz).key === arrivalKey,
    );
    if (tasks.length === 0) continue;
    e.cleaningTaskFound++;
    const checkoutAt = wallClockMoment(arrivalKey, previous.checkout, tz);
    const standardAt = wallClockMoment(arrivalKey, prop.checkInTime, tz);
    const marks = tasks.map((t) => ({ status: t.status, doneAt: t.doneAt }));
    // Geçmişe bakış: görevin BUGÜNKÜ durumu "bitti" ise, "bitti" kaydının zamanı o ana göre değerlendirilir.
    if (readinessOf(marks, checkoutAt, m.createdAt) === "ready") e.readyWhenAsked++;
    else if (standardAt && readinessOf(marks, checkoutAt, standardAt) === "ready") e.readyLaterSameDay++;
    else e.neverReadyByCheckIn++;
  }
  return stats;
}
