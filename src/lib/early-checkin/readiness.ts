// ---------------------------------------------------------------------------
// DOĞRULANMIŞ ERKEN GİRİŞ — SAF HAZIRLIK KURALLARI (09-24). DB yok: olgu yükleyici (`load.ts`) ve geçmiş mesaj
// taraması (`lib/eval-real/replay-stats.ts`) AYNI kuralı kullanır — "hazır" iki yerde farklı tanımlanamasın.
//  · Önceki misafirin çıkışı: mülkün varsayılanı ile misafirin BİLDİRDİĞİ saatten hangisi daha GEÇSE (temkin).
//  · Hazır: temizlik görevi "bitti" ve bunu yazan KAYDIN sunucu zamanı çıkış ANINDAN sonra, en az 5 dk önce.
// ---------------------------------------------------------------------------

import { zonedWallClockToUtc } from "@/lib/timezone";
import { hhmmToMinutes, normalizeHhmm } from "@/lib/ai/semantic/stay-change";
import type { ReadinessStatus } from "./core";

/** "Bitti" işareti bundan yeniyse sayılmaz (yanlışlıkla dokunma geri alınabilsin). */
export const READY_SETTLE_MS = 5 * 60_000;

/** İki saatten GEÇ olanı (biri geçersizse diğeri). */
export function laterTime(a: string | null | undefined, b: string | null | undefined): string | null {
  const x = normalizeHhmm(a);
  const y = normalizeHhmm(b);
  if (!x) return y;
  if (!y) return x;
  return (hhmmToMinutes(x) ?? 0) >= (hhmmToMinutes(y) ?? 0) ? x : y;
}

/** Takvim günü + duvar saati → an (org saat dilimi). Saat geçersizse `null`. */
export function wallClockMoment(dayKey: string, hhmm: string | null, timeZone: string): Date | null {
  const t = normalizeHhmm(hhmm);
  if (!t) return null;
  const [y, m, d] = dayKey.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  return zonedWallClockToUtc(y, m, d, h, mi, 0, timeZone);
}

/** Hazır değilse NEDEN (host paneli sade dille söyler; karar yalnız `readinessOf`). */
export type ReadinessNote = "none" | "open" | "fresh" | "before_checkout" | "no_time";

type Mark = { status: string; doneAt: Date | null };

const settledAfter = (t: Mark, checkoutAt: Date, now: Date) =>
  t.status === "done" && t.doneAt !== null && t.doneAt >= checkoutAt && now.getTime() - t.doneAt.getTime() >= READY_SETTLE_MS;

/**
 * Saf hazırlık hükmü + nedeni. Küme = BU devrin temizlik görevleri (yükleyici çıkış gününe bağlı olanları verir).
 * 🚨 İnceleme 09-24 (P1): kümede AÇIK görev varsa hazır DEĞİL — eskiden herhangi bir "bitti" kaydı yetiyordu; konaklama
 * sırasında açılmış başka bir temizlik görevi çıkıştan sonra kapatılınca daire, çıkış temizliği yapılmadan "hazır"
 * sayılıyordu. Hazır = hiçbir görev açık değil + en az bir işaret çıkıştan SONRA ve oturmuş (≥5 dk). `doneAt` =
 * görevi "bitti" yapan en son kaydın sunucu zamanı (yoksa `null`: zaman doğrulanamaz).
 */
export function readinessDetailOf(tasks: readonly Mark[], checkoutAt: Date | null, now: Date): { status: ReadinessStatus; note: ReadinessNote } {
  if (tasks.length === 0 || !checkoutAt) return { status: "unknown", note: "none" };
  if (tasks.some((t) => t.status !== "done")) return { status: "not_ready", note: "open" };
  if (tasks.some((t) => settledAfter(t, checkoutAt, now))) return { status: "ready", note: "none" };
  if (tasks.every((t) => t.doneAt === null)) return { status: "unknown", note: "no_time" };
  if (tasks.some((t) => t.doneAt !== null && t.doneAt >= checkoutAt)) return { status: "not_ready", note: "fresh" };
  return { status: "not_ready", note: "before_checkout" };
}

export function readinessOf(tasks: readonly Mark[], checkoutAt: Date | null, now: Date): ReadinessStatus {
  return readinessDetailOf(tasks, checkoutAt, now).status;
}

/** Hazır hükmünü veren EN YENİ "bitti" işaretinin zamanı (`readinessOf` ile aynı şart); hazır değilse `null`. */
export function readyAtOf(tasks: readonly Mark[], checkoutAt: Date | null, now: Date): Date | null {
  if (!checkoutAt || readinessOf(tasks, checkoutAt, now) !== "ready") return null;
  let latest: Date | null = null;
  for (const t of tasks) {
    if (!settledAfter(t, checkoutAt, now)) continue;
    if (!latest || (t.doneAt as Date) > latest) latest = t.doneAt;
  }
  return latest;
}
