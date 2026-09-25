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
  /**
   * Onaylı değil (beklemede / tanınmayan durum): tarihler PLANDIR; "misafir şu an konaklamakta" DENMEZ (inceleme 09-25).
   * Onaylı ya da tamamlanmış konaklama `false`.
   */
  unconfirmed: boolean;
}

/** Evre anlatımı yalnız bu durumlarda (tanınmayan durum onaylı SAYILMAZ). */
const STAYING_STATUSES: ReadonlySet<string> = new Set(["confirmed", "completed"]);

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
  const none: StayTimeline = {
    ...base,
    stage: "no_reservation",
    arrival: null,
    departure: null,
    daysToArrival: null,
    daysToDeparture: null,
    cancelled: false,
    unconfirmed: false,
  };
  if (!r) return none;
  const arrivalAt = asDate(r.arrivalDate);
  const departureAt = asDate(r.departureDate);
  // Geçersiz tarih istemi ÇÖKERTMEZ (inceleme 09-25: `toISOString` RangeError fırlatıyordu ve istem `suggestReply`nin
  // try bloğunun DIŞINDA kuruluyor) → zaman bağlamı "rezervasyon yok" gibi yazılır, tahmin yok.
  if (Number.isNaN(arrivalAt.getTime()) || Number.isNaN(departureAt.getTime())) return none;
  const arrival = calendarDateOf(arrivalAt, input.timeZone).key;
  const departure = calendarDateOf(departureAt, input.timeZone).key;
  const daysToArrival = nightsBetween(today, arrival);
  const daysToDeparture = nightsBetween(today, departure);
  let stage: StayStage;
  if (today > departure) stage = "post_stay";
  else if (today === departure) stage = "departure_today";
  else if (today > arrival) stage = daysToDeparture === 1 ? "departure_tomorrow" : "in_stay";
  else if (today === arrival) stage = "arrival_today";
  else stage = daysToArrival === 1 ? "arrival_tomorrow" : "pre_arrival";
  const cancelled = r.status === "cancelled";
  return {
    ...base,
    stage,
    arrival,
    departure,
    daysToArrival,
    daysToDeparture,
    cancelled,
    unconfirmed: !cancelled && !STAYING_STATUSES.has(r.status),
  };
}

const WEEKDAYS_TR = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

/** "2026-09-26" → "26.09.2026 Cuma" (takvim günü; saat dilimi dönüşümü YOK — anahtar zaten o gündür). */
export function formatDayTr(key: NightKey): string {
  const [y, m, d] = key.split("-").map(Number);
  const weekday = WEEKDAYS_TR[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y} ${weekday}`;
}

/** Gece yarısından sonraki bu saate kadar misafirin "yarın"ı çoğu zaman BUGÜNÜ (uyanınca başlayacak günü) kasteder. */
const SMALL_HOURS_END = "05:00";

/** İstemin saat satırı: bugünün tarihi + günü + yerel saat + yarın. */
export function clockLine(t: StayTimeline): string {
  const time = t.hhmm ? `, saat ${t.hhmm}` : "";
  // İnceleme 09-25 (P3): 00:00–04:59 arası "yarın" takvimde ertesi güne çözülüyordu; konuşan misafir çoğu zaman uyanınca
  // başlayacak günü (takvimde BUGÜN) kasteder. Karar değil yorum ipucu: kesin sonuç gerektiren konuda tek soru.
  const smallHours =
    t.hhmm !== null && t.hhmm < SMALL_HOURS_END
      ? ` · Gece yarısı yeni geçti: misafirin "yarın" demesi çoğu zaman BUGÜNÜ (${formatDayTr(t.today)}) kasteder; kesin sonuç gerektiren konuda tek kısa soruyla doğrula.`
      : "";
  return `Bugün: ${formatDayTr(t.today)}${time} (${t.timeZone}) · Yarın: ${formatDayTr(t.tomorrow)}${smallHours}`;
}

const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dayEn(key: NightKey): string {
  const [y, m, d] = key.split("-").map(Number);
  return `${key} (${WEEKDAYS_EN[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

/**
 * ANLAMA KATMANININ TARİH SATIRI (Konuşma Anlama Durumu, 09-25; katmanın istemi İngilizce). "Yarın 11'de" gibi göreli
 * ifadelerin konaklamadaki yeri (varış günü mü, çıkış günü mü, başka gün mü) ancak bugünü ve rezervasyonun GÜNLERİNİ
 * bilerek okunur. YALNIZ GÜN hassasiyeti — dakika yazılmaz: satır anlama katmanının önbellek anahtarına girer ve gün
 * içinde sabit kalmalı (gece yarısından sonraki ipucu yalnız 05:00'te bir kez değişir).
 * `bookingKnown` false: çağıran rezervasyonu bilmiyor (QR — rezervasyon ayrıntısı bilinçli verilmez) → rezervasyon
 * hakkında HİÇBİR şey söylenmez ("rezervasyon yok" DEMEK yanlış olurdu).
 */
export function understandingDateLine(t: StayTimeline, bookingKnown: boolean): string {
  const smallHours =
    t.hhmm !== null && t.hhmm < SMALL_HOURS_END
      ? ` It is shortly after midnight: a guest's "tomorrow" usually means today (${t.today}).`
      : "";
  const today = `Today (property time zone): ${dayEn(t.today)}; tomorrow: ${dayEn(t.tomorrow)}.${smallHours}`;
  if (!bookingKnown) return today;
  if (t.arrival === null || t.departure === null) return `${today} No booking is linked to this conversation.`;
  const tag = t.cancelled ? " (CANCELLED — not a valid stay)" : t.unconfirmed ? " (not confirmed yet)" : "";
  return `${today} Guest's booking${tag}: check-in day ${dayEn(t.arrival)}, check-out day ${dayEn(t.departure)}.`;
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * İstemin "Zaman bağlamı" satırı (takvim günü kuralıyla; eskisi sunucu saatiyle yanlış günü söylüyordu).
 * `standard`ın bir alanı `null` ise o standart saat YAZILMAZ (bilgi tabanıyla çelişen saat — P4-b bloğu "kesin saat
 * söyleme" derken bu satır saati tekrar etmesin; inceleme 09-25).
 */
export function timelineLine(t: StayTimeline, standard: { checkInTime: string | null; checkOutTime: string | null }): string {
  if (t.stage === "no_reservation" || t.arrival === null || t.departure === null) return "(rezervasyon yok)";
  const a = formatDayTr(t.arrival);
  const d = formatDayTr(t.departure);
  // İnceleme 09-25 (P3): iptal / onaysız rezervasyonda evre anlatılmaz ("şu an konaklamakta" ile "iptal" yan yana
  // çelişiyordu; bitince "konaklama tamamlandı" hiç olmamış bir konaklama için yazılıyordu).
  if (t.cancelled) return `Rezervasyon İPTAL edilmiş — bu tarihler geçerli bir konaklama değildir (planlanan giriş ${a}, çıkış ${d}).`;
  if (t.unconfirmed) return `Rezervasyon henüz ONAYLANMADI: planlanan giriş ${a}, çıkış ${d}. Onaylı bir konaklama gibi anlatma.`;
  const days = (n: number | null) => `${n} gün sonra`;
  // Bugünün standart saati: geçtiyse söylenir (çıkış günü öğleden sonra "11:00'e kadar çıkabilirsiniz" denmesin).
  const std = (label: "giriş" | "çıkış", hhmm: string | null, today: boolean) => {
    if (!hhmm || !HHMM_RE.test(hhmm)) return "";
    const passed = today && t.hhmm !== null && t.hhmm >= hhmm;
    return ` (standart ${label} saati ${hhmm}${passed ? " — bugün bu saat GEÇTİ" : ""})`;
  };
  switch (t.stage) {
    case "pre_arrival":
      return `Giriş henüz yapılmadı: giriş ${a} (${days(t.daysToArrival)}).`;
    case "arrival_tomorrow":
      return `Giriş YARIN: ${a}${std("giriş", standard.checkInTime, false)}.`;
    case "arrival_today":
      return `Giriş BUGÜN: ${a}${std("giriş", standard.checkInTime, true)}.`;
    case "in_stay":
      return `Misafir şu an konaklamakta. Çıkış ${d} (${days(t.daysToDeparture)}).`;
    case "departure_tomorrow":
      return `Misafir şu an konaklamakta. Çıkış YARIN: ${d}${std("çıkış", standard.checkOutTime, false)}.`;
    case "departure_today":
      return `Çıkış günü BUGÜN: ${d}${std("çıkış", standard.checkOutTime, true)}.`;
    case "post_stay":
      return `Konaklama tamamlandı (çıkış tarihi ${d} geçti).`;
    default:
      return "(rezervasyon yok)";
  }
}
