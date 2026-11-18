import { PADDLE_REPLAY_THRESHOLDS_MS } from "@/lib/payments/paddle-replay-schedule";

// ---------------------------------------------------------------------------
// KÂHİN — vade satıra taşınmadan önceki (11-18 öncesi) yeniden işleme kuralı, AYNEN (`payments/paddle-replay.ts`teki eski
// `paddleReplayDue`). Üretimde artık kullanılmıyor: vade `WebhookEvent.nextAttemptAt`ta (`paddle-replay-schedule.ts`). Testler yeni satır
// bazlı çizelgenin bu kuralla AYNI "bu turda denenir" kümesini verdiğini bununla ölçer. Kural değişirse bu dosya DEĞİŞMEZ — eşdeğerlik
// testi kırmızıya döner ve değişikliğin bilinçli olduğu orada yazılır.
// ---------------------------------------------------------------------------

/**
 * Bu olay bu turda yeniden işlenmeli mi: yaşı, son turdan bu yana bir eşiği geçti mi. Son tur bilinmiyorsa (ilk tur) ilk eşiği geçmiş
 * her olay bir kez işlenir. Uzun bir aradan sonra geçilen birden çok eşik TEK işlemeye iner.
 */
export function paddleReplayDue(createdAt: Date, lastPassAt: Date | null, now: Date): boolean {
  const ageNow = now.getTime() - createdAt.getTime();
  const ageLast = lastPassAt ? lastPassAt.getTime() - createdAt.getTime() : Number.NEGATIVE_INFINITY;
  return PADDLE_REPLAY_THRESHOLDS_MS.some((t) => ageLast < t && t <= ageNow);
}

/** Tohumlu, belirlenimci sayı üreteci (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
