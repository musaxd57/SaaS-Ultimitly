import "server-only";

import { OPENAI_BASE_URL, resolveCompatKey } from "@/lib/ai/openai-compat";
import { DEFAULT_OPENAI_MODEL, isReasoningModel } from "@/lib/ai/model-family";

// ---------------------------------------------------------------------------
// ANLAM KATMANI YAPILANDIRMASI — tek kaynak (bekçi + anlama/sorgu yeniden yazma).
//
//  · AI_SEMANTIC_API_KEY — yoksa OPENAI_API_KEY (anahtar-sağlayıcı eşleşmesi `openai-compat`
//    kuralıyla: istek yalnız OpenAI'ye gider, ana hesabın anahtarı üçüncü tarafa taşınmaz).
//  · AI_SEMANTIC_MODEL — yoksa OPENAI_MODEL, o da yoksa kod içi varsayılan. Küçük/hızlı bir model
//    seçmek maliyet + gecikme kararıdır (kurucu); eval'siz değiştirilmez.
//  · AI_SEMANTIC_TIMEOUT_MS — 500..60000; yoksa reasoning 12 sn / klasik 6 sn.
// ---------------------------------------------------------------------------

export function semanticApiKey(): string | undefined {
  return resolveCompatKey(process.env.AI_SEMANTIC_API_KEY, OPENAI_BASE_URL);
}

export function semanticModel(): string {
  return process.env.AI_SEMANTIC_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

/**
 * Reasoning modeli için düşünme çabası. Yalnız kapalı küme; boş/tanınmayan → gönderilmez (modelin
 * varsayılanı). gpt-5 ailesinin varsayılanı "medium" olabilir → anlam katmanı için "low" önerilir
 * (inceleme 09-24; ölçmeden varsayılan yapılmadı).
 */
export function semanticReasoningEffort(): string | undefined {
  const v = process.env.AI_SEMANTIC_REASONING_EFFORT?.trim();
  return v && ["none", "minimal", "low", "medium", "high"].includes(v) ? v : undefined;
}

/**
 * Tavan 20 sn (ikinci inceleme 09-24): QR yolunda anlama + cevap (≤60 sn) + bekçi ardışık koşabilir; tavan
 * 60 sn iken en kötü durum `qr-in:` talebinin 120 sn TTL'ini aşıp misafirin yeniden denemesini İKİNCİ kez
 * işletebiliyordu. 20 sn ile en kötü durum ~100 sn.
 */
export const SEMANTIC_TIMEOUT_MAX_MS = 20_000;

export function semanticTimeoutMs(model: string): number {
  const n = Number(process.env.AI_SEMANTIC_TIMEOUT_MS);
  if (Number.isFinite(n) && n >= 500) return Math.min(Math.trunc(n), SEMANTIC_TIMEOUT_MAX_MS);
  return isReasoningModel(model) ? 12_000 : 6_000;
}
