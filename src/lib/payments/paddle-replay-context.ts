import { AsyncLocalStorage } from "node:async_hooks";

// ---------------------------------------------------------------------------
// "Bu teslim, kendi sakladığımız olayın SÜREÇ İÇİ yeniden işlenmesidir" işareti (S7, Opus incelemesi 11-11). YAPRAK.
//
// Yeniden işleme saklı gövdeyi kendi webhook sırrımızla imzalar → işleyicinin imza kontrolünden HER ZAMAN geçer. İşleyici, imzası tutan
// her teslimde "webhook sırrı yanlış / eksik" alarm durumlarını temizler (gerçek bir Paddle teslimi yapılandırmanın sağlam olduğunu
// kanıtlar). Kendi imzamız bunu KANITLAMAZ: sır gerçekten yanlışken her yeniden işleme alarm durumunu silip alarmı yeniden
// tetikletirdi. İşaret süreç içindedir (istek başlığı değil) — dışarıdan verilemez.
// ---------------------------------------------------------------------------

const replayScope = new AsyncLocalStorage<true>();

export function runAsPaddleReplay<T>(fn: () => Promise<T>): Promise<T> {
  return replayScope.run(true, fn);
}

export function inPaddleReplay(): boolean {
  return replayScope.getStore() === true;
}
