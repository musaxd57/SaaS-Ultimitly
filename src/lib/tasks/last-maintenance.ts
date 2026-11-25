// ---------------------------------------------------------------------------
// "SON BAKIM İŞİ" (plan madde 9, kurucu 11-25): aynı dairede yeni bir bakım işi açıkken ev sahibi o dairenin en son KAPANMIŞ bakım işini
// tek satırda görür — "Bu dairede son bakım işi: 17 Mayıs — 'reset yapıldı' (Ahmet)". Sayım / cihaz eşleştirmesi YOK (cihaz kaydı yok).
// Tasarım: docs/TASARIM-2026-11-25-son-bakim-isi-notu.md
//
//  · Bakım = `type = maintenance` (temizlik, çıkış kontrolü vb. sayılmaz). Kapanmış = `status = done`.
//  · Kapanış anı + kişi = görevin EN SON `status = done` güncelleme satırı; satır yoksa (eski kayıt) görevin `updatedAt`'i, kişi yok.
//  · Not = kapanış satırının notu; boşsa işin en son SERBEST notu (durumsuz satır). Durumlu satırın notu ("Yapılamıyor" gerekçesi)
//    "ne yapıldı" değildir.
//  · Toplu: daire başına en yeni tek kayıt, TEK sorguda (`DISTINCT ON`) — N+1 yok, sınırlı okuma + bellekte süzme yok. İşletme kapsamlı.
//  · Not serbest metindir → YALNIZ yönetici görünümüne gider (çağıran `card-data.ts`).
// ---------------------------------------------------------------------------

// Bu dosya SAF (yaprak; kart verisi `card-data.ts` içe aktarır). Toplu okuma `last-maintenance-query.ts`te.

import { todayKey } from "@/modules/availability/core";

export interface LastMaintenance {
  closedAt: Date;
  note: string | null;
  by: string | null;
}

export const LAST_MAINTENANCE_NOTE_MAX = 80;

export function oneLine(s: string | null): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** "Bu dairede son bakım işi: 17 Mayıs — 'reset yapıldı' (Ahmet)". Gün işletme diliminde; başka yılsa yıllı. Saf. */
export function lastMaintenanceLine(m: LastMaintenance, timeZone: string, now: Date): string {
  const sameYear = todayKey(m.closedAt, timeZone).slice(0, 4) === todayKey(now, timeZone).slice(0, 4);
  const day = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }), timeZone }).format(m.closedAt);
  const raw = oneLine(m.note);
  const note = raw.length > LAST_MAINTENANCE_NOTE_MAX ? `${raw.slice(0, LAST_MAINTENANCE_NOTE_MAX - 1)}…` : raw;
  return `Bu dairede son bakım işi: ${day}${note ? ` — '${note}'` : ""}${m.by ? ` (${m.by})` : ""}`;
}
