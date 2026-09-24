// ---------------------------------------------------------------------------
// DOĞRULANMIŞ ERKEN GİRİŞ — SAF KARAR ÇEKİRDEĞİ (09-24, kurucu: "Sensitive request = BLOCK değil; özel
// doğrulama iş akışı. Her şey doğrulanmışsa early_checkin olması nedeniyle human review'a düşmemeli; eksik bilgi,
// çelişki, doğrulanamayan güvenlik ya da gerçekten host kararı gerekiyorsa insana.") Ağ yok, DB yok, model yok.
//
// Misafir: "Saat 12'de gelebilir miyiz?" → istek birleşimle tespit edilir (değişmedi) → bu çekirdek kontrolleri
// koşar. Her kontrol kapalı kümeden bir KOD üretir (host paneli + kanıt; metin/PII yok):
//   1. önceki misafirin çıkışı (aynı gün devir varsa saati, istenen saatten ÖNCE olmalı)
//   2. o gün çakışan başka rezervasyon (çift rezervasyon) YOK
//   3. daire HAZIR: önceki çıkıştan SONRA atılmış, en az 5 dk'lık, geri alınmamış "temizlik bitti" işareti
//      (tik; fotoğraf DEĞİL, zaman sunucudan). Aynı gün devir yoksa ek olarak dün gece KANITLA boş olmalı.
//   4. istenen saat, host'un izin verdiği en erken saatten önce değil (ve standart girişten gerçekten erken)
//   5. ücret: YALNIZ host'un kayıtlı kuralı okunur (yapay zekâ tutar uydurmaz, hesaplamaz, pazarlık etmez)
//   6. host kuralı: kapalı / taslak / otomatik — varsayılan KAPALI (kural yoksa bugünkü davranış: insan)
//   7-8. cevap bu verilerden KODDA kurulur (`reply.ts`) — model metni değil; kapı yalnız bu metni muaf tutar.
// Otomatik gönderim ek şartları: istenen saati İKİ bağımsız model (anlama katmanı + bekçi) aynı okumalı ve
// cevapsız mesajlarda başka bir istek olmamalı (tek konu). Aksi hâlde doğrulanmış TASLAK host'a gider.
// Bugün misafirin varış günü değilse hazırlık doğrulanamaz → host (ileriki gün için söz verilmez).
// ---------------------------------------------------------------------------

import { hhmmToMinutes, LATE_NIGHT_ARRIVAL_CUTOFF_MINUTES, normalizeHhmm } from "@/lib/ai/semantic/stay-change";

export const EARLY_CHECKIN_MODES = ["off", "draft", "auto"] as const;
export type EarlyCheckinMode = (typeof EARLY_CHECKIN_MODES)[number];

export const EARLY_CHECKIN_CURRENCIES = ["TRY", "EUR", "USD", "GBP"] as const;
export type EarlyCheckinCurrency = (typeof EARLY_CHECKIN_CURRENCIES)[number];

/** Host'un mülk başına kuralı. Ücret isteğe bağlı; yapay zekâ yalnız OKUR. */
export interface EarlyCheckinRule {
  mode: EarlyCheckinMode;
  /** İzin verilen en erken giriş saati ("HH:MM"). */
  earliest: string;
  fee: { amount: number; currency: EarlyCheckinCurrency } | null;
  /** Host'un kendi cümlesi (ör. ödeme adımı) — misafire olduğu gibi gider; ödeme yöntemi içeremez (kayıtta süzülür). */
  note: string | null;
}

/** "Hazır" işareti: önceki çıkıştan sonra atılmış temizlik tamamlandı kaydı. */
export type ReadinessStatus = "ready" | "not_ready" | "unknown";

export interface EarlyCheckinFacts {
  /** Mülkün standart giriş saati. */
  standardCheckIn: string | null;
  /** Misafirin kendi rezervasyonu; `null` = konuşma bir rezervasyona bağlı değil. */
  reservation: { status: string; arrivalKey: string } | null;
  /** Mülk takviminde bugün (YYYY-MM-DD, org saat dilimi). */
  todayKey: string;
  /** Varış günü AYRILAN önceki misafir (aynı gün devir); yoksa `null`. */
  previousSameDay: { checkoutTime: string | null } | null;
  /** Varış gecesini (kendi rezervasyonu ve aynı gün ayrılan dışında) işgal eden başka rezervasyon sayısı. */
  otherOverlaps: number;
  /** Son çıkıştan sonraki temizlik "bitti" işareti. */
  readiness: ReadinessStatus;
  /** Hazır değilse nedeni (yalnız host paneli; karar `readiness`ten verilir). */
  readinessNote?: "none" | "open" | "fresh" | "before_checkout" | "no_time";
  /** Aynı gün devir YOKSA: dün gece kanıtla (taze kaynaklarla) boş mu. */
  previousNightVerifiedVacant: boolean;
  /** İstenen giriş saati: kaynaklar ve anlaşma. */
  requested: { time: string | null; sources: number; conflict: boolean };
  /** Cevapsız mesajlarda erken giriş dışında istek/soru yok (anlama katmanı). */
  singleIntent: boolean;
}

export const EARLY_CHECKIN_CHECKS = [
  "rule_off",
  "no_reservation",
  "reservation_not_confirmed",
  "not_arrival_day",
  "time_unknown",
  "time_conflict",
  "before_window",
  "overlap",
  "previous_checkout_unknown",
  "previous_still_in",
  "not_ready",
  "ready_unknown",
  "previous_night_unverified",
  "multi_intent",
  "single_source_time",
] as const;
export type EarlyCheckinCheck = (typeof EARLY_CHECKIN_CHECKS)[number];

export type EarlyCheckinStatus = "approvable" | "needs_host" | "not_early";

export interface EarlyCheckinDecision {
  status: EarlyCheckinStatus;
  /** Başarısız kontroller (kapalı küme; sıra sabit). */
  failed: EarlyCheckinCheck[];
  /** Onaylanabilir saat ("HH:MM"); yalnız `approvable` iken dolu. */
  approvedTime: string | null;
  fee: EarlyCheckinRule["fee"];
  /** Otomatik gönderim: onaylanabilir + kural otomatik + iki model aynı saati okudu + tek konu. */
  autoSend: boolean;
}

/** Varış günü için "dün gece"yi değil, varış GÜNÜNÜ esas alan karar. Saf; aynı girdiye aynı çıktı. */
export function decideEarlyCheckin(facts: EarlyCheckinFacts, rule: EarlyCheckinRule | null): EarlyCheckinDecision {
  const failed: EarlyCheckinCheck[] = [];
  const fee = rule?.fee ?? null;
  const requestedMin = hhmmToMinutes(normalizeHhmm(facts.requested.time));
  const standardMin = hhmmToMinutes(normalizeHhmm(facts.standardCheckIn));

  // İstenen saat standart girişten erken değilse — ya da gece yarısından sonraki GEÇ varışsa ("gece 1:30 gibi
  // varırız", tek kaynak `isEarlierThanCheckIn` ile aynı eşik) — bu bir erken giriş isteği DEĞİLDİR (akış uygulanmaz).
  if (
    requestedMin !== null &&
    !facts.requested.conflict &&
    (requestedMin < LATE_NIGHT_ARRIVAL_CUTOFF_MINUTES || (standardMin !== null && requestedMin >= standardMin))
  ) {
    return { status: "not_early", failed: [], approvedTime: null, fee, autoSend: false };
  }

  if (!rule || rule.mode === "off") failed.push("rule_off");
  if (!facts.reservation) failed.push("no_reservation");
  else {
    if (facts.reservation.status !== "confirmed") failed.push("reservation_not_confirmed");
    if (facts.reservation.arrivalKey !== facts.todayKey) failed.push("not_arrival_day");
  }
  if (facts.requested.conflict) failed.push("time_conflict");
  else if (requestedMin === null) failed.push("time_unknown");
  const earliestMin = hhmmToMinutes(normalizeHhmm(rule?.earliest ?? null));
  if (requestedMin !== null && earliestMin !== null && requestedMin < earliestMin) failed.push("before_window");
  if (facts.otherOverlaps > 0) failed.push("overlap");

  if (facts.previousSameDay) {
    const outMin = hhmmToMinutes(normalizeHhmm(facts.previousSameDay.checkoutTime));
    if (outMin === null) failed.push("previous_checkout_unknown");
    else if (requestedMin !== null && outMin > requestedMin) failed.push("previous_still_in");
  } else if (!facts.previousNightVerifiedVacant) {
    failed.push("previous_night_unverified");
  }
  if (facts.readiness === "not_ready") failed.push("not_ready");
  else if (facts.readiness === "unknown") failed.push("ready_unknown");

  const approvable = failed.length === 0;
  // Otomatik gönderim ek şartları — onaylanabilir olsa da bunlar yoksa TASLAK (host tek tıkla gönderir).
  const autoFailed: EarlyCheckinCheck[] = [];
  if (approvable) {
    if (facts.requested.sources < 2) autoFailed.push("single_source_time");
    if (!facts.singleIntent) autoFailed.push("multi_intent");
  }
  return {
    status: approvable ? "approvable" : "needs_host",
    failed: [...failed, ...autoFailed],
    approvedTime: approvable ? normalizeHhmm(facts.requested.time) : null,
    fee,
    autoSend: approvable && rule?.mode === "auto" && autoFailed.length === 0,
  };
}

/**
 * İstenen saat: bağımsız modellerin okumaları (anlama katmanı, bekçi). Biri yoksa yalnız diğeri; ikisi FARKLIYSA
 * çelişki (tahmin yok). Kaynak sayısı otomatik gönderim şartıdır (iki model aynı saati okumalı).
 */
export function agreeRequestedTime(readings: readonly (string | null | undefined)[]): EarlyCheckinFacts["requested"] {
  const times = readings.map((t) => normalizeHhmm(t)).filter((t): t is string => t !== null);
  if (times.length === 0) return { time: null, sources: 0, conflict: false };
  const distinct = new Set(times);
  if (distinct.size > 1) return { time: null, sources: times.length, conflict: true };
  return { time: times[0], sources: times.length, conflict: false };
}
