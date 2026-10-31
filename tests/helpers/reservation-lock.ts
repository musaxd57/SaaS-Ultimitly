import { prisma } from "./db";
import { __reservationTaskHooks } from "@/lib/automation";

// ---------------------------------------------------------------------------
// REZERVASYON GÖREV KİLİDİ (ad alanı 44) test yardımcıları — eşzamanlılık testleri zamanlamaya değil kilidin kendisine bağlansın.
// ---------------------------------------------------------------------------

/** YALNIZ bu rezervasyonun görev kilidinde (ad alanı 44 + hashtext(id)) bekleyen istek sayısı — başka testin / işin kilidi sayılmaz
 *  (ChatGPT 10-15: eski sayaç veritabanındaki BÜTÜN bekleyen danışma kilitlerini sayıyordu). İki tamsayılı danışma kilidinde PostgreSQL
 *  ilk anahtarı `classid`, ikincisini işaretsiz 32 bit olarak `objid`, `objsubid = 2` tutar. */
export async function waitingOnReservationLock(reservationId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM pg_locks
    WHERE locktype = 'advisory' AND NOT granted AND objsubid = 2 AND classid = 44
      AND objid::bigint = (hashtext(${reservationId})::bigint & 4294967295)`;
  return Number(rows[0].n);
}

/** VERİLEN rezervasyon için İLK `createReservationTasks` çağrısını kilitli bölgede durdurur: rezervasyon kilit altında "onaylı"
 *  okunmuş, görevler HENÜZ yazılmamış (kilit tutuluyor). Başka rezervasyonların ve sonraki çağrılar beklemeden geçer (senkron başka
 *  rezervasyonlar için de çağırır — Haiku 10-15). Test sonunda `__reservationTaskHooks.afterExistingRead = null` yapılmalı. */
export function pauseFirstCreator(reservationId: string): { atHook: Promise<void>; release: () => void } {
  let reached: () => void = () => {};
  const atHook = new Promise<void>((r) => (reached = r));
  let go: () => void = () => {};
  const resume = new Promise<void>((r) => (go = r));
  let first = true;
  __reservationTaskHooks.afterExistingRead = async (id) => {
    if (!first || id !== reservationId) return;
    first = false;
    reached();
    await resume;
  };
  return { atHook, release: () => go() };
}

/** VERİLEN rezervasyonun İLK iptal temizliğini kilit altında "iptal" okuduktan sonra, silmeden ÖNCE durdurur (yeniden açma yarışı —
 *  Opus 10-15 O1). Test sonunda `__reservationTaskHooks.afterCleanupLockedRead = null` yapılmalı. */
export function pauseFirstCleanup(reservationId: string): { atHook: Promise<void>; release: () => void } {
  let reached: () => void = () => {};
  const atHook = new Promise<void>((r) => (reached = r));
  let go: () => void = () => {};
  const resume = new Promise<void>((r) => (go = r));
  let first = true;
  __reservationTaskHooks.afterCleanupLockedRead = async (id) => {
    if (!first || id !== reservationId) return;
    first = false;
    reached();
    await resume;
  };
  return { atHook, release: () => go() };
}

/** Açan işlem kancaya varana kadar bekler; kancadan ÖNCE biterse / düşerse asılı kalmaz, açık hata verir (Haiku 10-15). */
export async function untilPaused(pause: { atHook: Promise<void> }, creating: Promise<unknown>): Promise<void> {
  await Promise.race([
    pause.atHook,
    creating.then(
      (v) => Promise.reject(new Error(`açan işlem kancaya varmadan bitti (sonuç ${String(v)})`)),
      (e: unknown) => Promise.reject(e),
    ),
  ]);
}

/** `running` bitene ya da bu rezervasyonun kilidinde bekleyen biri görünene kadar yoklar. "waiting": temizlik kilidi bekliyor (doğru
 *  protokol); "done": iş kilidi beklemeden bitti (kilitsiz kısa yol ya da eksik temizlik çağrısı). */
export async function settleOrWait(reservationId: string, running: Promise<unknown>, timeoutMs = 15_000): Promise<"waiting" | "done"> {
  let finished = false;
  running.then(
    () => (finished = true),
    () => (finished = true),
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (finished) return "done";
    if ((await waitingOnReservationLock(reservationId)) >= 1) return "waiting";
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("ne bitti ne kilitte bekledi (zaman aşımı)");
}
