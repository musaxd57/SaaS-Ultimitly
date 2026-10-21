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
//  · Bekleme bitince TEK deneme (kira): yine zaman aşımıysa kesici hemen yeniden açılır (sayaç sıfırlanmadı), cevap gelirse kapanır;
//    kira süresince öteki çağrılar beklemez, doğrudan model-yok yoluna gider.
//  · Geçici hata cevabı (408/429/5xx) kesiciyi KAPATMAZ: "önce hızlı 429, yeniden denemede takılma" deseni de birikir (Haiku 10-21).
//  · Yalnız ZAMAN AŞIMI sayılır: hızlı dönen hata (5xx, ağ reddi) bekletmez, onun çaresi tek yeniden denemedir.
//  · Tek hızlı yeniden deneme: geçici hata (408 · 429 hız sınırı · 5xx · zaman aşımı OLMAYAN ağ hatası) bir kez, kısa aralıkla
//    yeniden denenir. Kalıcı arıza (kota / anahtar / model) ve zaman aşımı yeniden DENENMEZ (biri düzelmez, öteki beklemeyi ikiye
//    katlardı).
// Durum bellektedir (veritabanı yok); her kopya kendi kesicisini tutar. Kesici kiracı başınadır; ortak kesici yalnız birden çok
// kiracının art arda takılmasında açılır (aşağıda).
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

/**
 * Kesici durumu. KİRACI BAŞINA ayrı tutulur (güvenlik incelemesi 10-21 P3): eskiden tek ortak sayaç vardı — bir işletmenin (ya da
 * misafirinin uzun cevap isteyen mesajlarının) art arda üç zaman aşımı, sunucudaki BÜTÜN işletmelerin cevap çağrısını 60 sn
 * durduruyordu. Şimdi:
 *  · kiracı kesicisi: o işletmenin art arda REPLY_BREAKER_THRESHOLD zaman aşımı → YALNIZ o işletme bekler;
 *  · ortak kesici: art arda zaman aşımı dizisi EN AZ İKİ işletmeden geliyorsa (gerçek sağlayıcı arızası böyle görünür) herkes bekler.
 * Herhangi bir işletmenin çağrısına sağlayıcı cevap verirse ortak dizi sıfırlanır (sağlayıcı ayakta); kiracı dizisi yalnız o
 * kiracının kendi cevabıyla sıfırlanır.
 */
interface BreakerState {
  consecutive: number;
  openUntil: number;
  /** Bekleme dolduktan sonraki TEK deneme kirası: kira süresince başka çağrı geçmez (eşzamanlı istekler hep birlikte beklemesin). */
  probeLeaseUntil: number;
}
const fresh = (): BreakerState => ({ consecutive: 0, openUntil: 0, probeLeaseUntil: 0 });
let shared = fresh();
/** Ortak dizideki zaman aşımlarının geldiği kiracılar. */
let sharedKeys = new Set<string>();
const tenants = new Map<string, BreakerState>();
let retryDelayOverride: number | null = null;
/** Tek deneme kirasının süresi: en uzun çağrı tavanı + pay (deneme takılırsa kira kendiliğinden düşer). */
const PROBE_LEASE_MS = 65_000;
/** Kiracısı bilinmeyen çağrı (deneme / demo yolu) kendi kovasındadır. */
const NO_TENANT = "_";
/** Ortak kesicinin açılması için gereken ayrı kiracı sayısı. */
export const REPLY_BREAKER_SHARED_MIN_TENANTS = 2;

const keyOf = (key: string | null | undefined) => (key && key.trim() ? key : NO_TENANT);

function allowed(state: BreakerState, now: number): boolean {
  if (state.openUntil === 0) return true;
  if (now < state.openUntil) return false;
  if (now < state.probeLeaseUntil) return false;
  state.probeLeaseUntil = now + PROBE_LEASE_MS;
  return true;
}

/** Eşiğe ulaştıysa (ya da deneme yine düştüyse) açar; `true` YALNIZ kapalıyken açıldığı anda. */
function trip(state: BreakerState, now: number): boolean {
  const wasClosed = state.openUntil === 0;
  state.openUntil = now + REPLY_BREAKER_COOLDOWN_MS;
  state.probeLeaseUntil = 0;
  return wasClosed;
}

/**
 * Çağrı yapılabilir mi? Önce ortak kesici, sonra kiracınınki. Açık kesicide bekleme süresince hayır; bekleme dolunca YALNIZ bir
 * çağrı geçer (deneme kirası) — sonucu kesiciyi kapatır (cevap geldi) ya da hemen yeniden açar (yine zaman aşımı).
 */
export function replyModelCallAllowed(key?: string | null, now = Date.now()): boolean {
  if (!allowed(shared, now)) return false;
  const t = tenants.get(keyOf(key));
  return t ? allowed(t, now) : true;
}

/**
 * Zaman aşımı (bağlantı ya da gövde okuma). `true` YALNIZ bir kesici (kiracı ya da ortak) kapalıyken AÇILDIĞI anda döner — açılış
 * tek kez raporlansın, açıkken düşen çağrılar yeniden rapor üretmez.
 */
export function noteReplyModelTimeout(key?: string | null, now = Date.now()): boolean {
  const k = keyOf(key);
  let t = tenants.get(k);
  if (!t) {
    t = fresh();
    tenants.set(k, t);
  }
  t.consecutive++;
  shared.consecutive++;
  sharedKeys.add(k);
  let opened = false;
  if (t.consecutive >= REPLY_BREAKER_THRESHOLD) opened = trip(t, now) || opened;
  if (shared.consecutive >= REPLY_BREAKER_THRESHOLD && sharedKeys.size >= REPLY_BREAKER_SHARED_MIN_TENANTS) {
    opened = trip(shared, now) || opened;
  }
  return opened;
}

/** Sağlayıcı cevap verdi (başarı ya da kalıcı / kesin bir ret — takılmadı). Geçici hata (408/429/5xx) bunu ÇAĞIRMAZ. */
export function noteReplyModelResponded(key?: string | null): void {
  shared = fresh();
  sharedKeys = new Set();
  tenants.delete(keyOf(key));
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
  shared = fresh();
  sharedKeys = new Set();
  tenants.clear();
  retryDelayOverride = retryDelayMs;
}
