// ---------------------------------------------------------------------------
// GÖREV VADESİ — DUVAR SAATİ İŞLETME DİLİMİNDE (E5, Codex 11-17 / kurucu 11-18 "Görev saati"). YAPRAK modül (sunucu + test; veritabanı yok).
// Form (`datetime-local`) saat dilimi taşımayan "2026-11-20T15:00" gönderir. Eskiden şema onu `new Date(...)` ile SÜRECİN diliminde okuyordu:
// sunucu UTC iken İstanbul'da girilen 15:00 → 15:00Z (= 18:00 İstanbul). Artık: şema dilimsiz değeri dize olarak taşır (`{ wallClock }`),
// rota işletmenin diliminde çevirir. Dilim taşıyan değer (API istemcisinin ISO'su, `Z` / `±hh:mm`) bugünkü gibi mutlak andır.
// Var olan kayıtlar DEĞİŞMEZ (geriye dönük düzeltme yok: hangi satırın hangi süreç diliminde yazıldığı bilinemez).
// ---------------------------------------------------------------------------

import { dateKeyInTimeZone, zonelessWallClockToUtc } from "@/lib/timezone";
import { calendarDateOf } from "@/modules/availability/core";

/** Şemanın vade çıktısı: mutlak an ya da işletme diliminde okunacak dilimsiz duvar saati. */
export type TaskDueInput = Date | { wallClock: string };

/**
 * Vadeyi saklanacak ana çevirir. Dilimsiz duvar saati `timeZone`'da okunur; takvimde olmayan değer → `null` (şema zaten eler).
 *
 * 🚨 ÇAPA ÇAKIŞMASI: tek tarih kuralı (`calendarDateOf`) tam UTC 00:00 / 12:00 değerini "saatsiz takvim günü" sayar (yaşam döngüsü görevleri
 * rezervasyon tarihini böyle taşır). İstanbul'da (UTC+3) formda girilen 15:00 ve 03:00 tam bu anlara düşer → kart / panel / e-posta saati
 * HİÇ göstermezdi (girilen 15:00 kaybolurdu). Duvar saati her zaman bir SAATTİR: çapaya düşen sonuç 1 ms ileri alınır — gösterilen saat ve gün
 * aynı kalır (biçimlendirme milisaniye göstermez), değer "an" olarak okunur. Dilim taşıyan API değerine dokunulmaz (bugünkü gibi).
 */
export function resolveTaskDueAt(v: TaskDueInput, timeZone: string): Date | null {
  if (v instanceof Date) return v;
  const at = zonelessWallClockToUtc(v.wallClock, timeZone);
  if (!at) return null;
  return calendarDateOf(at, timeZone).anchor === "instant" ? at : new Date(at.getTime() + 1);
}

/** Vade işletme dilimini istiyor mu (rota dilimi yalnız gerektiğinde okur). */
export function needsOrgTimeZone(v: TaskDueInput | undefined): v is { wallClock: string } {
  return v !== undefined && !(v instanceof Date);
}

// ---------------------------------------------------------------------------
// VADE HASSASİYETİ AÇIK ALANDA (`Task.dueAtPrecision`, migration 98 — Codex 11-17 / kurucu 11-18). Eskiden "saatsiz gün" ile "belirli saat"
// yalnız DEĞERİN kendisinden çıkarılıyordu (tam UTC 00:00 / 12:00 = gün — `calendarDateOf`). Artık her yazım hassasiyeti sütuna da yazar
// (`taskDueWrite` — TEK yazım kaynağı), okuyucular `taskDueReading`den okur (sütun doluysa SÜTUN, boşsa eski kural).
// Görünen davranış DEĞİŞMEZ: değeri BİLİNEN bir kaynaktan gelmeyen her yazımın hassasiyeti eski kuralın o değer için verdiği sonuçtur
// (yaşam döngüsü görevi rezervasyon tarihini taşır — tarih çapadaysa "day", gerçek ansa "minute"; dilim taşıyan API değeri, sözün görevi,
// mesajdan açılan görev de böyle). Yalnız formun dilimsiz duvar saati AÇIKÇA "minute"dır (1 ms kaydırma onu zaten an yapıyor → eski
// kuralla aynı sonuç). Böylece yeni bir kayıtta sütun ile eski kural hiçbir zaman çelişmez; çelişki ancak ileride kaydırma kaldırılınca doğar
// ve o zaman sütun kazanır.
// ---------------------------------------------------------------------------

/** Kapalı küme: "day" = saatsiz takvim günü · "minute" = belirli saat. */
export type TaskDuePrecision = "day" | "minute";

/** Eski kuralın (sütun yokken) bu değer için verdiği hassasiyet: çapa (tam 00:00Z / 12:00Z) → "day", başka her an → "minute". */
export function legacyTaskDuePrecision(dueAt: Date): TaskDuePrecision {
  // Çapa kararı dilimden bağımsızdır (yalnız UTC saat / dakika / saniye / milisaniye okunur); dilim yalnız gün anahtarı için gerekir.
  return calendarDateOf(dueAt, "UTC").anchor === "instant" ? "minute" : "day";
}

/**
 * YAZIM: görev satırına giden vade alanları — `dueAt` ile `dueAtPrecision` HER ZAMAN birlikte yazılır. `precision` yalnız hassasiyeti
 * KAYNAĞINDAN bilen çağıran verir (formun duvar saati); verilmezse eski kuralın o değer için sonucu. Vade yoksa ikisi de null.
 */
export function taskDueWrite(dueAt: Date, precision?: TaskDuePrecision): { dueAt: Date; dueAtPrecision: TaskDuePrecision };
export function taskDueWrite(dueAt: Date | null, precision?: TaskDuePrecision): { dueAt: Date | null; dueAtPrecision: TaskDuePrecision | null };
export function taskDueWrite(dueAt: Date | null, precision?: TaskDuePrecision): { dueAt: Date | null; dueAtPrecision: TaskDuePrecision | null } {
  if (!dueAt) return { dueAt: null, dueAtPrecision: null };
  return { dueAt, dueAtPrecision: precision ?? legacyTaskDuePrecision(dueAt) };
}

/**
 * Rota girdisi → saklanacak vade alanları (`resolveTaskDueAt` + hassasiyet). Dilimsiz duvar saati her zaman bir SAATTİR ("minute");
 * dilim taşıyan değer (API istemcisi) bugünkü kuraldan geçer (ör. "2026-11-20" → 00:00Z → "day"). Takvimde olmayan duvar saati → null.
 */
export function resolveTaskDue(v: TaskDueInput, timeZone: string): { dueAt: Date; dueAtPrecision: TaskDuePrecision } | null {
  const at = resolveTaskDueAt(v, timeZone);
  if (!at) return null;
  return taskDueWrite(at, v instanceof Date ? undefined : "minute");
}

/**
 * OKUMA (tek kaynak): vadenin işletme günündeki takvim günü ve SAATİ anlamlı mı. Sütun "minute" → gerçek an (gün işletme diliminde,
 * saat gösterilir) · "day" → saatsiz gün (tek tarih kuralının günü, saat gösterilmez) · boş / tanınmayan (bu alandan önceki kayıt) →
 * eski kural (`calendarDateOf`: çapa saatsiz gün, başka her an saatli).
 */
export function taskDueReading(dueAt: Date, precision: string | null | undefined, timeZone: string): { key: string; timed: boolean } {
  if (precision === "minute") return { key: dateKeyInTimeZone(dueAt, timeZone), timed: true };
  const { key, anchor } = calendarDateOf(dueAt, timeZone);
  if (precision === "day") return { key, timed: false };
  return { key, timed: anchor === "instant" };
}
