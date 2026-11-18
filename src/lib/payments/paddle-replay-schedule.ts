// ---------------------------------------------------------------------------
// Paddle olayı yeniden işleme ÇİZELGESİ — saf, yaprak modül (hiçbir şey import etmez). Webhook işleyicisi (`api/webhooks/paddle/route.ts`)
// ilk vadeyi, yeniden işleme işi (`payments/paddle-replay.ts`) sonrakileri buradan yazar: iki yazıcı TEK kurala bağlı.
//
// Kural (S7, değişmedi): olayın yaşı eşikleri (15 dk, 1 sa, 2, 4 … 256 sa) geçtikçe birer kez — 14 günde en çok 10. Uzun bir aradan sonra
// geçilen birden çok eşik TEK denemeye iner. Vade satırda (`WebhookEvent.nextAttemptAt`, migration 98): son denemeden SONRA geçilecek ilk
// eşik. Eskiden aynı küme `createdAt` + ortak "son tur" anından türetiliyordu; eşdeğerlik birim testte eski kuralla kâhin olarak pinli.
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;

/** Olayın yaşı bu eşikleri geçtikçe birer kez yeniden işlenir (artan sıra; ilki "yarıda kaldı" süresiyle aynı). */
export const PADDLE_REPLAY_THRESHOLDS_MS: readonly number[] = [15 * 60_000, HOUR, 2 * HOUR, 4 * HOUR, 8 * HOUR, 16 * HOUR, 32 * HOUR, 64 * HOUR, 128 * HOUR, 256 * HOUR];

/**
 * Sıradaki yeniden işleme anı: `createdAt + t`, `t` = `after` anındaki yaştan BÜYÜK en küçük eşik (`after` o ana dek geçilen eşiklerin
 * denendiği / harcandığı an: son deneme, olayın alınışı ya da eski sürümün son turu). `after` yoksa ilk eşik (hiç denenmemiş olay).
 * Eşik kalmadıysa null — olay bir daha yeniden işlenmez (eski kuralın "son eşikten sonra yok"u).
 */
export function nextPaddleReplayAt(createdAt: Date, after: Date | null): Date | null {
  const created = createdAt.getTime();
  const ageAfter = after ? after.getTime() - created : Number.NEGATIVE_INFINITY;
  const t = PADDLE_REPLAY_THRESHOLDS_MS.find((x) => x > ageAfter);
  return t === undefined ? null : new Date(created + t);
}
