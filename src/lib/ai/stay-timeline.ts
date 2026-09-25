// ---------------------------------------------------------------------------
// ZAMAN VE KONAKLAMA EVRESİ — KODDA, ORG SAAT DİLİMİNDE (kurucu gereksinimi: "currentLocalDate + org timezone koddan";
// Konuşma Anlama Durumu v1'in ilk dilimi, 09-25). Saf; DB/ağ yok.
//
// 🚨 ÖLÇÜLEN KUSUR (09-25, ajan + kod): istemin "Zaman bağlamı" satırı SUNUCU saatini ham tarih damgalarıyla kıyaslıyordu.
// Rezervasyonların çoğu YALNIZ TARİH (00:00Z) saklanır → İstanbul'da çıkış sabahı 03:00'ten itibaren model "Konaklama
// tamamlandı (check-out gerçekleşti)" okuyordu (misafir hâlâ dairede, çıkış 11:00'de); varıştan önceki akşam da saat farkı
// yuvarlanıp "Girişe 0 gün kaldı" çıkıyordu. Hiçbir model bugünün tarihini/gününü bilmiyordu → "yarın erken girebilir
// miyiz?" gibi göreli ifadeler tahminle çözülüyordu.
// Kural: günler `calendarDateOf` ile (tek tarih kuralı — tam 00:00Z/12:00Z = yalnız tarih, aksi an → mülk dilimi),
// "bugün" org diliminde; gün farkı TAKVİM günüdür (saat farkı yuvarlaması DEĞİL).
// ---------------------------------------------------------------------------

import { addNights, calendarDateOf, nightsBetween, todayKey, type NightKey } from "@/modules/availability/core";
import { minutesOfDayInTimeZone } from "@/lib/timezone";

export type StayStage =
  | "no_reservation"
  | "pre_arrival"
  | "arrival_tomorrow"
  | "arrival_today"
  | "in_stay"
  | "departure_tomorrow"
  | "departure_today"
  | "post_stay";

export interface StayTimeline {
  /** Org diliminde bugün / yarın (YYYY-MM-DD). */
  today: NightKey;
  tomorrow: NightKey;
  /** Yerel duvar saati "HH:MM"; biçimlendirme başarısızsa null (tahmin yok). */
  hhmm: string | null;
  timeZone: string;
  stage: StayStage;
  arrival: NightKey | null;
  departure: NightKey | null;
  /** Takvim günü farkı (bugünden); rezervasyon yoksa null. */
  daysToArrival: number | null;
  daysToDeparture: number | null;
  /** Rezervasyon iptal edilmiş (tarihler geçerli bir konaklama DEĞİL). */
  cancelled: boolean;
}

export interface StayTimelineInput {
  now: Date;
  timeZone: string;
  reservation: { status: string; arrivalDate: Date | string; departureDate: Date | string } | null | undefined;
}

function asDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

function hhmmOf(minutes: number | null): string | null {
  if (minutes === null) return null;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function stayTimeline(input: StayTimelineInput): StayTimeline {
  const today = todayKey(input.now, input.timeZone);
  const base = {
    today,
    tomorrow: addNights(today, 1),
    hhmm: hhmmOf(minutesOfDayInTimeZone(input.timeZone, input.now)),
    timeZone: input.timeZone,
  };
  const r = input.reservation;
  if (!r) {
    return { ...base, stage: "no_reservation", arrival: null, departure: null, daysToArrival: null, daysToDeparture: null, cancelled: false };
  }
  const arrival = calendarDateOf(asDate(r.arrivalDate), input.timeZone).key;
  const departure = calendarDateOf(asDate(r.departureDate), input.timeZone).key;
  const daysToArrival = nightsBetween(today, arrival);
  const daysToDeparture = nightsBetween(today, departure);
  let stage: StayStage;
  if (today > departure) stage = "post_stay";
  else if (today === departure) stage = "departure_today";
  else if (today > arrival) stage = daysToDeparture === 1 ? "departure_tomorrow" : "in_stay";
  else if (today === arrival) stage = "arrival_today";
  else stage = daysToArrival === 1 ? "arrival_tomorrow" : "pre_arrival";
  return { ...base, stage, arrival, departure, daysToArrival, daysToDeparture, cancelled: r.status === "cancelled" };
}

const WEEKDAYS_TR = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

/** "2026-09-26" → "26.09.2026 Cuma" (takvim günü; saat dilimi dönüşümü YOK — anahtar zaten o gündür). */
export function formatDayTr(key: NightKey): string {
  const [y, m, d] = key.split("-").map(Number);
  const weekday = WEEKDAYS_TR[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y} ${weekday}`;
}

/** İstemin saat satırı: bugünün tarihi + günü + yerel saat + yarın. */
export function clockLine(t: StayTimeline): string {
  const time = t.hhmm ? `, saat ${t.hhmm}` : "";
  return `Bugün: ${formatDayTr(t.today)}${time} (${t.timeZone}) · Yarın: ${formatDayTr(t.tomorrow)}`;
}

/** İstemin "Zaman bağlamı" satırı (takvim günü kuralıyla; eskisi sunucu saatiyle yanlış günü söylüyordu). */
export function timelineLine(t: StayTimeline, standard: { checkInTime: string; checkOutTime: string }): string {
  if (t.stage === "no_reservation" || t.arrival === null || t.departure === null) return "(rezervasyon yok)";
  const a = formatDayTr(t.arrival);
  const d = formatDayTr(t.departure);
  const days = (n: number | null) => `${n} gün sonra`;
  const cancelled = t.cancelled ? "Rezervasyon İPTAL edilmiş — bu tarihler geçerli bir konaklama değildir. " : "";
  switch (t.stage) {
    case "pre_arrival":
      return `${cancelled}Giriş henüz yapılmadı: giriş ${a} (${days(t.daysToArrival)}).`;
    case "arrival_tomorrow":
      return `${cancelled}Giriş YARIN: ${a} (standart giriş saati ${standard.checkInTime}).`;
    case "arrival_today":
      return `${cancelled}Giriş BUGÜN: ${a} (standart giriş saati ${standard.checkInTime}).`;
    case "in_stay":
      return `${cancelled}Misafir şu an konaklamakta. Çıkış ${d} (${days(t.daysToDeparture)}).`;
    case "departure_tomorrow":
      return `${cancelled}Misafir şu an konaklamakta. Çıkış YARIN: ${d} (standart çıkış saati ${standard.checkOutTime}).`;
    case "departure_today":
      return `${cancelled}Çıkış günü BUGÜN: ${d} (standart çıkış saati ${standard.checkOutTime}).`;
    case "post_stay":
      return `${cancelled}Konaklama tamamlandı (çıkış tarihi ${d} geçti).`;
    default:
      return "(rezervasyon yok)";
  }
}
