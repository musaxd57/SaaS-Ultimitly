// ---------------------------------------------------------------------------
// GEÇMİŞ MİSAFİR MESAJLARININ TOPLU TARAMASI — SAF (09-24, kurucu: "admin hesabından önceden çektiğimiz her mesajla
// kontrol edebilir miyiz"). Etiketsiz; yalnız SAYI üretir — mesaj metni, ad, kimlik, tarih çıktıya GİRMEZ. Model
// ÇAĞRILMAZ: yalnız deterministik katman (kelime ağı) + veritabanı olguları. Sorular:
//  · Konaklama değişikliği istekleri ne sıklıkta (birleşim kuralının "insana" payının ALT SINIRI — kelime ağı yalnız
//    yedektir, kör bataryada izinlerin 19/60'ını görür; model katmanlarının oranı Set B + kredi ister).
//  · Yalnız erken giriş isteklerinden kaçı varış günü, aynı gün devirde geldi; o devirde temizlik görevi var mıydı;
//    misafir sorduğunda daire HAZIR mıydı, yoksa standart girişe kadar mı hazır oldu (temizlik sonrası yeniden
//    değerlendirmenin — `early-checkin/recheck.ts` — kaç isteği kurtaracağı; ÜST SINIR: aradaki host cevabı bakılmaz)?
// Hazırlık kuralı ürünle AYNI (`early-checkin/readiness.ts`); tarih kuralı ürünle AYNI (`calendarDateOf` takvim
// alanlarında, `dateKeyInTimeZone` anlarda); önceki misafir seçimi ürünle AYNI (`load.ts`: durum sınıfı, en GEÇ çıkış).
// 🚨 GEÇMİŞE BAKIŞ (inceleme 09-24, P2): görevlerin BUGÜNKÜ durumu kullanılmaz — soru anındaki durum yeniden kurulur
// (o anda yoksa sayılmaz; "bitti" kaydı o andan sonraysa açık sayılır). Aksi hâlde "açık görev varsa hazır değil" kuralı
// geçmişte atlanıp "sorulduğunda hazır" şişiyordu.
// ---------------------------------------------------------------------------

import { detectAvailabilityRequestKinds, type AvailabilityRequestKind } from "@/lib/ai/availability-claims";
import { calendarDateOf, statusClassOf } from "@/modules/availability/core";
import { dateKeyInTimeZone } from "@/lib/timezone";
import { hhmmToMinutes } from "@/lib/ai/semantic/stay-change";
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
  /** Görevin oluşturulma anı (soru anında var mıydı). */
  createdAt: Date;
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
  version: 2;
  /** Taranan misafir mesajı. */
  messages: number;
  /** Kelime ağının konaklama değişikliği saydığı mesajlar (tür başına; bir mesaj birden çok türde olabilir). */
  stayRequests: Record<AvailabilityRequestKind | "any" | "multiKind", number>;
  /** YALNIZ erken giriş (başka tür yok) istekleri ve doğrulanmış akışın göreceği olgular. */
  earlyOnly: {
    /** Yalnız erken giriş mesajı (takip mesajları dahil). */
    messages: number;
    /** Rezervasyona bağlı İSTEK sayısı: rezervasyon başına İLK yalnız-erken-giriş mesajı (↓ huni bunun üzerinden). */
    requests: number;
    askedOnArrivalDay: number;
    askedBeforeArrivalDay: number;
    askedAfterArrivalDay: number;
    /** Varış günü sorulanlardan: aynı gün ayrılan önceki misafir vardı. */
    sameDayTurnover: number;
    /** Aynı gün devirlerden: SORU ANINDA o devrin (çıkış günü) temizlik görevi vardı. */
    cleaningTaskFound: number;
    /** Görevi olanlardan: misafir sorduğunda daire hazırdı (kural: hepsi kapalı + çıkıştan sonra ≥5 dk). */
    readyWhenAsked: number;
    /** Sorduğunda hazır değildi ama standart girişe kadar hazır oldu (yeniden değerlendirmenin ÜST SINIR payı). */
    readyLaterSameDay: number;
    /** Standart girişe kadar da hazır işaretlenmedi. */
    neverReadyByCheckIn: number;
  };
  /** İsteklerin (rezervasyon başına ilk soru) yerel saat dağılımı (0–23). */
  askHourLocal: number[];
}

const KINDS: readonly AvailabilityRequestKind[] = ["early", "late", "extend", "date_change", "availability"];

function localHour(d: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(d);
  const n = Number(h);
  return Number.isInteger(n) && n >= 0 && n < 24 ? n : 0;
}

/** Görevin `at` anındaki hâli: o anda yoksa `null`; "bitti" kaydı `at`ten sonraysa o anda AÇIKTI. */
function taskAt(t: ReplayCleaning, at: Date): { status: string; doneAt: Date | null } | null {
  if (t.createdAt > at) return null;
  const doneByThen = t.status === "done" && t.doneAt !== null && t.doneAt <= at;
  return doneByThen ? { status: "done", doneAt: t.doneAt } : { status: "open", doneAt: null };
}

export function replayStats(input: ReplayInput): ReplayStats {
  const tz = input.timeZone;
  const propById = new Map(input.properties.map((p) => [p.id, p]));
  const resById = new Map(input.reservations.map((r) => [r.id, r]));
  const live = input.reservations.filter((r) => statusClassOf(r.status) !== "ignored");
  const stats: ReplayStats = {
    version: 2,
    messages: input.messages.length,
    stayRequests: { any: 0, multiKind: 0, early: 0, late: 0, extend: 0, date_change: 0, availability: 0 },
    earlyOnly: {
      messages: 0,
      requests: 0,
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

  // Rezervasyon başına İLK soru: takip mesajları ("?", "any update?") isteği yeniden saymasın.
  const firstAsk = new Map<string, ReplayMessage>();
  for (const m of input.messages) {
    const kinds = detectAvailabilityRequestKinds(m.body);
    if (kinds.length === 0) continue;
    stats.stayRequests.any++;
    if (kinds.length > 1) stats.stayRequests.multiKind++;
    for (const k of KINDS) if (kinds.includes(k)) stats.stayRequests[k]++;
    if (kinds.length !== 1 || kinds[0] !== "early") continue;
    stats.earlyOnly.messages++;
    const own = m.reservationId ? resById.get(m.reservationId) : undefined;
    // Ürünle aynı: rezervasyon konuşmanın MÜLKÜNE ait olmalı.
    if (!own || own.propertyId !== m.propertyId || !propById.has(m.propertyId)) continue;
    const prev = firstAsk.get(own.id);
    if (!prev || m.createdAt < prev.createdAt) firstAsk.set(own.id, m);
  }

  const e = stats.earlyOnly;
  for (const [ownId, m] of firstAsk) {
    const own = resById.get(ownId) as ReplayReservation;
    const prop = propById.get(m.propertyId) as ReplayProperty;
    e.requests++;
    stats.askHourLocal[localHour(m.createdAt, tz)]++;
    const arrivalKey = calendarDateOf(own.arrivalDate, tz).key;
    const askKey = dateKeyInTimeZone(m.createdAt, tz);
    if (askKey < arrivalKey) {
      e.askedBeforeArrivalDay++;
      continue;
    }
    if (askKey > arrivalKey) {
      e.askedAfterArrivalDay++;
      continue;
    }
    e.askedOnArrivalDay++;
    // Ürünle aynı (`load.ts`): durum sınıfı "ignored" olmayan, varış günü ayrılan; birden çoksa en GEÇ çıkan.
    const previous = live
      .filter((r) => r.id !== own.id && r.propertyId === own.propertyId)
      .filter((r) => calendarDateOf(r.departureDate, tz).key === arrivalKey && calendarDateOf(r.arrivalDate, tz).key < arrivalKey)
      .map((r) => ({ r, checkout: laterTime(r.guestCheckoutTime, prop.checkOutTime) }))
      .sort((p, q) => (hhmmToMinutes(q.checkout) ?? 0) - (hhmmToMinutes(p.checkout) ?? 0))[0];
    if (!previous) continue;
    e.sameDayTurnover++;
    const turnoverTasks = input.cleanings.filter(
      (t) =>
        t.propertyId === own.propertyId &&
        (t.reservationId === previous.r.id || t.reservationId === null) &&
        t.dueAt !== null &&
        calendarDateOf(t.dueAt, tz).key === arrivalKey,
    );
    const checkoutAt = wallClockMoment(arrivalKey, previous.checkout, tz);
    const standardAt = wallClockMoment(arrivalKey, prop.checkInTime, tz);
    const marksAt = (at: Date) => turnoverTasks.map((t) => taskAt(t, at)).filter((x): x is { status: string; doneAt: Date | null } => x !== null);
    const atAsk = marksAt(m.createdAt);
    if (atAsk.length === 0) continue;
    e.cleaningTaskFound++;
    if (readinessOf(atAsk, checkoutAt, m.createdAt) === "ready") e.readyWhenAsked++;
    else if (standardAt && standardAt > m.createdAt && readinessOf(marksAt(standardAt), checkoutAt, standardAt) === "ready") e.readyLaterSameDay++;
    else e.neverReadyByCheckIn++;
  }
  return stats;
}
