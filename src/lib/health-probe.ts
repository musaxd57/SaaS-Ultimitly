// ---------------------------------------------------------------------------
// SAĞLIK PROBU — kısa ömürlü memoizasyon (denetim, 07-31).
//
// `/api/health` kimliksiz ve limitsizdi; istek başına 2 DB sorgusu üretiyordu.
// HIZ LİMİTİ KOYMAK BİLEREK REDDEDİLDİ, iki sebeple:
//   1. `rateLimit()` bir DB YAZMASIDIR — sel altında limitleyici, koruduğu
//      şeyden pahalı olurdu (2 ucuz okuma → 2 okuma + 1 yazma).
//   2. Railway'in healthcheck probu deploy anında bu yolu çağırıyor ve XFF
//      göndermiyor → paylaşımlı "unknown" kovasına düşerdi. Kova doluysa prob
//      429 alır, healthcheckTimeout aşılır ve DEPLOY CANLIYA ÇIKAMAZ.
//
// Memoizasyon ikisini de yaşatmadan çözer: örnek başına en fazla ~20 sorgu/dk.
// 3 saniyelik bayatlık, 300 sn'lik healthcheck timeout'u ve 15 dakikalık
// "sync stale" eşiği yanında görünmez.
//
// YALNIZ BAŞARILI okuma saklanır — bir arıza ASLA cache'lenmez, aksi hâlde
// geçici bir DB kesintisi 3 saniye boyunca sağlıklı görünmeye devam ederdi.
//
// Rota dosyasında değil BURADA duruyor: Next.js rota modüllerinden yalnız
// belirli isimler export edilebilir; test yardımcısı orada tip hatası verirdi.
// ---------------------------------------------------------------------------

export const PROBE_CACHE_MS = 3_000;

export interface ProbeSnapshot {
  at: number;
  /** Okuma ANINDAKİ yaş; okuyucu üstüne geçen süreyi ekler (donmuş yaş raporlanmasın). */
  lastSyncAgeAtRead: number | null;
  sync: "ok" | "stale" | "unknown";
}

let probeCache: ProbeSnapshot | null = null;

/** Tazeyse anlık görüntü, değilse null. */
export function readProbeCache(now = Date.now()): ProbeSnapshot | null {
  if (!probeCache) return null;
  return now - probeCache.at < PROBE_CACHE_MS ? probeCache : null;
}

export function writeProbeCache(snapshot: ProbeSnapshot): void {
  probeCache = snapshot;
}

/** Arıza yolunda çağrılır — bozuk durum asla saklanmaz. */
export function clearProbeCache(): void {
  probeCache = null;
}
