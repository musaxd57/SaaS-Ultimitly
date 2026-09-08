import "server-only";

// INTELLIGENCE bounded context (V1) — event dinler, kendi state'ini üretir; PMS ona bağımlı değil.
// Çekirdek: canonical satırlar + IngestEvent. Sağlayıcı modülü import ETMEZ (mimari pin).
import { reportError } from "@/lib/report-error";
import { processIngestEvents } from "./consumer";
import { bootstrapMemoryFromKnowledgeBase, type BootstrapResult } from "./memory/bootstrap";
import { refreshPatternMemory } from "./memory/patterns";

export { processIngestEvents, __intelligenceHooks } from "./consumer";
export { bootstrapMemoryFromKnowledgeBase } from "./memory/bootstrap";
export type { BootstrapResult } from "./memory/bootstrap";
export { refreshPatternMemory, PATTERN_MIN_SIGNALS, PATTERN_WINDOW_DAYS } from "./memory/patterns";
export { getPropertyMemory } from "./memory/read";
export type { PropertyMemoryView } from "./memory/read";
export { purgeExpiredSignals } from "./retention";
export type { SignalDraft, SignalKind, SignalSource } from "./signals/derive";

export interface IntelligencePassResult {
  processed: number;
  signals: number;
  patternsUpserted: number;
  memory: BootstrapResult;
}

/**
 * Zamanlanmış geçişte org başına: KB hafızasını eşitle (silinen/pasif → retired), event'leri tüket,
 * örüntüleri yenile. Fırlatır — çağıran yakalar (PMS bloklanmaz). Sıra: hafıza → event → örüntü
 * (örüntü sinyallerden türer; bu geçişte üretilen sinyaller aynı geçişte sayılır).
 */
export async function runIntelligencePass(organizationId: string): Promise<IntelligencePassResult> {
  const memory = await bootstrapMemoryFromKnowledgeBase(organizationId);
  const p = await processIngestEvents({ organizationId });
  const m = await refreshPatternMemory(organizationId);
  return { processed: p.processed, signals: p.signals, patternsUpserted: m.upserted, memory };
}

/**
 * KB yazma rotaları için: yazdıktan hemen sonra mülk (ya da org) kapsamında hafızayı eşitle.
 * ASLA fırlatmaz — KB kaydı hafıza yüzünden başarısız olmaz; hata raporlanır, sonraki
 * zamanlanmış geçiş zaten aynı eşitlemeyi yapar.
 */
export async function refreshPropertyMemoryBestEffort(organizationId: string, propertyId?: string): Promise<void> {
  try {
    await bootstrapMemoryFromKnowledgeBase(organizationId, propertyId);
  } catch (err) {
    await reportError(`kb-memory org:${organizationId}`, err);
  }
}
