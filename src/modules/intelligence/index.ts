import "server-only";

// INTELLIGENCE bounded context (V1) — event dinler, kendi state'ini üretir; PMS ona bağımlı değil.
// Çekirdek: canonical satırlar + IngestEvent. Sağlayıcı modülü import ETMEZ (mimari pin).
import { processIngestEvents } from "./consumer";
import { refreshPatternMemory } from "./memory/patterns";

export { processIngestEvents, __intelligenceHooks } from "./consumer";
export { bootstrapMemoryFromKnowledgeBase } from "./memory/bootstrap";
export { refreshPatternMemory, PATTERN_MIN_SIGNALS, PATTERN_WINDOW_DAYS } from "./memory/patterns";
export { getPropertyMemory } from "./memory/read";
export { purgeExpiredSignals } from "./retention";
export type { SignalDraft, SignalKind, SignalSource } from "./signals/derive";

export interface IntelligencePassResult {
  processed: number;
  signals: number;
  patternsUpserted: number;
}

/** Zamanlanmış geçişte org başına: event'leri tüket, örüntüleri yenile. Fırlatır — çağıran yakalar. */
export async function runIntelligencePass(organizationId: string): Promise<IntelligencePassResult> {
  const p = await processIngestEvents({ organizationId });
  const m = await refreshPatternMemory(organizationId);
  return { processed: p.processed, signals: p.signals, patternsUpserted: m.upserted };
}
