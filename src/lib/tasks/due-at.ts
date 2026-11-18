// ---------------------------------------------------------------------------
// GÖREV VADESİ — DUVAR SAATİ İŞLETME DİLİMİNDE (E5, Codex 11-17 / kurucu 11-18 "Görev saati"). YAPRAK modül (sunucu + test; veritabanı yok).
// Form (`datetime-local`) saat dilimi taşımayan "2026-11-20T15:00" gönderir. Eskiden şema onu `new Date(...)` ile SÜRECİN diliminde okuyordu:
// sunucu UTC iken İstanbul'da girilen 15:00 → 15:00Z (= 18:00 İstanbul). Artık: şema dilimsiz değeri dize olarak taşır (`{ wallClock }`),
// rota işletmenin diliminde çevirir. Dilim taşıyan değer (API istemcisinin ISO'su, `Z` / `±hh:mm`) bugünkü gibi mutlak andır.
// Var olan kayıtlar DEĞİŞMEZ (geriye dönük düzeltme yok: hangi satırın hangi süreç diliminde yazıldığı bilinemez).
// ---------------------------------------------------------------------------

import { zonelessWallClockToUtc } from "@/lib/timezone";
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
