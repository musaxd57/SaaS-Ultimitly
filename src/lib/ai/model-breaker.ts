// ---------------------------------------------------------------------------
// CEVAP MODELİ DEVRE KESİCİSİ + TEK HIZLI YENİDEN DENEME (kurucu 10-21: "bekleme uzamasın", "model düşmesin").
//
// Ölçüm (`docs/olcum/LUNA-GECIS-2026-10-10.md`): cevap çağrısı p50 1,9 sn / p95 3,2 sn (5.1). Zaman tavanı yalnız sağlayıcı
// CEVAP VERMEDİĞİNDE dolar. Eskiden her konuşma tavanı (reasoning 60 sn) ayrı ayrı bekliyordu: sağlayıcı takıldığında otomatik
// cevap döngüsü işletme başına 25 konuşmayı sırayla bekler (25 × 60 sn), QR'daki misafir de her mesajda bir dakika beklerdi.
//
// Kural (süreç başına, yalnız cevap çağrısı):
//  · Art arda REPLY_BREAKER_THRESHOLD zaman aşımı → REPLY_BREAKER_COOLDOWN_MS boyunca çağrı yapılmaz, sonuç bugünkü model-yok
//    yoludur (kanal: `ai_unavailable`, damgalanmaz, sonraki turda yeniden denenir; QR: ev sahibine kalır). Misafire giden hiçbir
//    şey değişmez — model cevabı yokken zaten hiçbir şey OTOMATİK gitmiyordu.
//  · Bekleme bitince tek deneme: yine zaman aşımıysa kesici hemen yeniden açılır (sayaç sıfırlanmadı), cevap gelirse kapanır.
//  · Yalnız ZAMAN AŞIMI sayılır: hızlı dönen hata (5xx, ağ reddi) bekletmez, onun çaresi tek yeniden denemedir.
//  · Tek hızlı yeniden deneme: geçici hata (408 · 429 hız sınırı · 5xx · zaman aşımı OLMAYAN ağ hatası) bir kez, kısa aralıkla
//    yeniden denenir. Kalıcı arıza (kota / anahtar / model) ve zaman aşımı yeniden DENENMEZ (biri düzelmez, öteki beklemeyi ikiye
//    katlardı).
// Durum bellektedir (veritabanı yok); her kopya kendi kesicisini tutar.
// ---------------------------------------------------------------------------

export const REPLY_BREAKER_THRESHOLD = 3;
export const REPLY_BREAKER_COOLDOWN_MS = 60_000;
/** Yeniden denemeden önceki bekleme; sağlayıcının `Retry-After` başlığı bu tavana kadar dinlenir. */
export const REPLY_RETRY_DELAY_MS = 1_000;
export const REPLY_RETRY_AFTER_CAP_MS = 3_000;

/**
 * Cevap çağrısının zaman tavanı. Eskiden reasoning modelinde 60 sn idi; ölçülen en yavaş yapılandırma (Luna `medium`) p95 9,7 sn,
 * canlı 5.1 p95 3,2 sn → 30 sn hâlâ en yavaşın üç katı. Yalnız `high` düşünme çabası ayarlanırsa eski 60 sn kalır.
 * Reasoning olmayan model değişmedi (20 sn).
 */
export function replyTimeoutMs(reasoning: boolean, effort: string | null): number {
  if (!reasoning) return 20_000;
  return effort === "high" ? 60_000 : 30_000;
}

let consecutiveTimeouts = 0;
let openUntil = 0;
let retryDelayOverride: number | null = null;

/** Çağrı yapılabilir mi? Kesici açıkken `false` (bekleme süresi dolana kadar). */
export function replyModelCallAllowed(now = Date.now()): boolean {
  return now >= openUntil;
}

/** Zaman aşımı: sayaç artar; eşiğe ulaştıysa (ya da tek deneme yine düştüyse) kesici açılır. Açıldıysa `true`. */
export function noteReplyModelTimeout(now = Date.now()): boolean {
  consecutiveTimeouts++;
  if (consecutiveTimeouts < REPLY_BREAKER_THRESHOLD) return false;
  openUntil = now + REPLY_BREAKER_COOLDOWN_MS;
  return true;
}

/** Sağlayıcı cevap verdi (HTTP durumu ne olursa olsun takılmadı): kesici kapanır. */
export function noteReplyModelResponded(): void {
  consecutiveTimeouts = 0;
  openUntil = 0;
}

/** Zaman aşımı mı? `AbortSignal.timeout` → `TimeoutError`; eski çalışma zamanları `AbortError` verebilir. */
export function isTimeoutError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : (err as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/** Geçici HTTP durumu (yeniden denemeye değer). Kalıcı sınıflandırma (`classifyModelProviderFailure`) ÖNCE yapılır. */
export function isRetryableReplyStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

/** Yeniden deneme beklemesi: `Retry-After` (saniye) tavana kadar, yoksa sabit kısa bekleme. */
export function replyRetryDelayMs(retryAfter: string | null): number {
  if (retryDelayOverride !== null) return retryDelayOverride;
  const s = retryAfter === null ? NaN : Number(retryAfter.trim());
  if (Number.isFinite(s) && s >= 0) return Math.min(Math.round(s * 1000), REPLY_RETRY_AFTER_CAP_MS);
  return REPLY_RETRY_DELAY_MS;
}

/** TEST KANCASI: kesiciyi sıfırla; isteğe bağlı yeniden deneme beklemesi (testler 1 sn beklemesin). */
export function __resetReplyModelBreakerForTests(retryDelayMs: number | null = null): void {
  consecutiveTimeouts = 0;
  openUntil = 0;
  retryDelayOverride = retryDelayMs;
}
