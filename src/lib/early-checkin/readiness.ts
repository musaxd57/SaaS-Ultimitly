// ---------------------------------------------------------------------------
// DOĞRULANMIŞ ERKEN GİRİŞ — SAF HAZIRLIK KURALLARI (09-24). DB yok: olgu yükleyici (`load.ts`) ve geçmiş mesaj
// taraması (`lib/eval-real/replay-stats.ts`) AYNI kuralı kullanır — "hazır" iki yerde farklı tanımlanamasın.
//  · Önceki misafirin çıkışı: mülkün varsayılanı ile misafirin BİLDİRDİĞİ saatten hangisi daha GEÇSE (temkin; misafir
//    beyanı YALNIZ sıkılaştırır — kanıt modeli G1/G2, `docs/ERKEN-GIRIS-KANIT-MODELI-2026-09-24.md`).
//  · Hazır (G5): BU devrin temizlik görevlerinin HEPSİ kapalı + bir "bitti" kaydı (sunucu zamanı) çıkış ANINDAN sonra,
//    en az 5 dk önce.
//  · Çıkıştan ÖNCE bitmiş temizlik (kurucu senaryo 2: "misafir 11 dedi, temizlikçi 08:45'te hazır dedi"): yalnız host
//    RIZASIYLA ve operasyonel kanıtla sayılır — işaret ayrılan konaklamaya BAĞLI görevde, devir gününde, AYNI kullanıcının
//    aynı gün daha önceki "başladım" kaydıyla (≥15 dk) (G4 → G5). O zaman önceki misafirin gittiği de doğrulanmış olur.
//    Misafirin "çıktık" demesi bunun yerine GEÇMEZ (yalnız bilgi).
// ---------------------------------------------------------------------------

import { zonedWallClockToUtc } from "@/lib/timezone";
import { hhmmToMinutes, normalizeHhmm } from "@/lib/ai/semantic/stay-change";
import type { ReadinessStatus } from "./core";

/** "Bitti" işareti bundan yeniyse sayılmaz (yanlışlıkla dokunma geri alınabilsin). */
export const READY_SETTLE_MS = 5 * 60_000;
/** Çıkıştan önceki hazır işareti için "başladım" ile "hazır" arası en az süre (gerçek bir temizlik; yanlış dokunma değil). */
export const MIN_START_TO_READY_MS = 15 * 60_000;

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

/**
 * Bir temizlik görevinin hazırlık için okunan hâli. `doneAt` = görevi "bitti" yapan EN SON durum kaydının zamanı
 * (yükleyici yalnız KİMLİKLİ kullanıcı kaydını verir; sistem kaydı sayılmaz). Diğer alanlar isteğe bağlıdır ve yoksa
 * "kanıtlanmadı" demektir (geçmiş mesaj taraması eski davranışı korur).
 */
export interface ReadinessMark {
  status: string;
  doneAt: Date | null;
  /** Aynı görevde, "bitti"den önce, AYNI kullanıcının EN SON "başladım" kaydı. */
  startedAt?: Date | null;
  /** Görev ayrılan konaklamaya BAĞLI mı (bağsız görev çıkıştan önceki işaretle hazır saydıramaz). */
  linked?: boolean;
}

export interface ReadinessOptions {
  /** Devir gününün başlangıcı (mülk diliminde 00:00) — çıkıştan önceki işaret yalnız o günden sayılabilir. */
  dayStart?: Date | null;
  /** Host rızası (`EarlyCheckinRule.readyBeforeCheckout`): çıkıştan önceki kanıtlı işaret sayılır. */
  allowBeforeCheckout?: boolean;
}

const settledAt = (t: ReadinessMark, now: Date) =>
  t.status === "done" && t.doneAt !== null && now.getTime() - t.doneAt.getTime() >= READY_SETTLE_MS;

/** Çıkıştan ÖNCE atılmış işaretin operasyonel kanıtı (G4 → G5); host rızası yoksa asla. */
function provenBeforeCheckout(t: ReadinessMark, opts: ReadinessOptions): boolean {
  if (!opts.allowBeforeCheckout || !opts.dayStart || !t.linked || !t.doneAt || !t.startedAt) return false;
  return (
    t.doneAt >= opts.dayStart &&
    t.startedAt >= opts.dayStart &&
    t.doneAt.getTime() - t.startedAt.getTime() >= MIN_START_TO_READY_MS
  );
}

/** Bu işaret hazır saydırır mı (oturmuş + çıkıştan sonra ya da kanıtlı erken). */
function qualifies(t: ReadinessMark, checkoutAt: Date, now: Date, opts: ReadinessOptions): "after" | "early" | null {
  if (!settledAt(t, now)) return null;
  if ((t.doneAt as Date) >= checkoutAt) return "after";
  return provenBeforeCheckout(t, opts) ? "early" : null;
}

/**
 * Saf hazırlık hükmü + nedeni. Küme = BU devrin temizlik görevleri (yükleyici çıkış gününe bağlı olanları verir).
 * 🚨 İnceleme 09-24 (P1): kümede AÇIK görev varsa hazır DEĞİL. Hazır = hiçbir görev açık değil + en az bir işaret
 * (çıkıştan SONRA ya da host rızasıyla kanıtlı ERKEN) ve oturmuş (≥5 dk). `departureConfirmed` = hazırlık kanıtlı erken
 * işarete dayanıyor → önceki misafirin gittiği operasyonel olarak doğrulandı (çekirdek `previous_still_in` sormaz).
 */
export function readinessDetailOf(
  tasks: readonly ReadinessMark[],
  checkoutAt: Date | null,
  now: Date,
  opts: ReadinessOptions = {},
): { status: ReadinessStatus; note: ReadinessNote; departureConfirmed: boolean } {
  if (tasks.length === 0 || !checkoutAt) return { status: "unknown", note: "none", departureConfirmed: false };
  if (tasks.some((t) => t.status !== "done")) return { status: "not_ready", note: "open", departureConfirmed: false };
  const kinds = tasks.map((t) => qualifies(t, checkoutAt, now, opts));
  if (kinds.includes("after")) return { status: "ready", note: "none", departureConfirmed: false };
  if (kinds.includes("early")) return { status: "ready", note: "none", departureConfirmed: true };
  if (tasks.every((t) => t.doneAt === null)) return { status: "unknown", note: "no_time", departureConfirmed: false };
  if (tasks.some((t) => t.doneAt !== null && (t.doneAt >= checkoutAt || provenBeforeCheckout(t, opts)))) {
    return { status: "not_ready", note: "fresh", departureConfirmed: false };
  }
  return { status: "not_ready", note: "before_checkout", departureConfirmed: false };
}

export function readinessOf(tasks: readonly ReadinessMark[], checkoutAt: Date | null, now: Date, opts: ReadinessOptions = {}): ReadinessStatus {
  return readinessDetailOf(tasks, checkoutAt, now, opts).status;
}

/** Hazır hükmünü veren EN YENİ "bitti" işaretinin zamanı (`readinessOf` ile aynı şart); hazır değilse `null`. */
export function readyAtOf(tasks: readonly ReadinessMark[], checkoutAt: Date | null, now: Date, opts: ReadinessOptions = {}): Date | null {
  if (!checkoutAt || readinessOf(tasks, checkoutAt, now, opts) !== "ready") return null;
  let latest: Date | null = null;
  for (const t of tasks) {
    if (!qualifies(t, checkoutAt, now, opts)) continue;
    if (!latest || (t.doneAt as Date) > latest) latest = t.doneAt;
  }
  return latest;
}
