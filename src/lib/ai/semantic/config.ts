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

export function semanticTimeoutMs(model: string): number {
  const n = Number(process.env.AI_SEMANTIC_TIMEOUT_MS);
  if (Number.isFinite(n) && n >= 500 && n <= 60_000) return Math.trunc(n);
  return isReasoningModel(model) ? 12_000 : 6_000;
}
