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

/**
 * KATMAN BAZINDA MODEL (kurucu 10-01: "her katmanı ayrı doğrulayalım"): anlama katmanı, konaklama bekçisi ve yeniden sıralayıcı
 * kendi ortam değişkeniyle ayrı modele / düşünme çabasına alınabilir; tanımsızsa bugünkü ortak ayara (`AI_SEMANTIC_*`) düşer —
 * hepsi boşken davranış BİREBİR eski. Erken giriş akışının "iki bağımsız model" şartı da (anlama + bekçi) böylece gerçekten iki
 * farklı modelle karşılanabilir.
 */
export type SemanticLayer = "understanding" | "guard" | "rerank";
export const SEMANTIC_LAYER_MODEL_ENV: Readonly<Record<SemanticLayer, string>> = {
  understanding: "AI_UNDERSTANDING_MODEL",
  guard: "AI_STAY_GUARD_MODEL",
  rerank: "KB_RERANK_MODEL",
};
export const SEMANTIC_LAYER_EFFORT_ENV: Readonly<Record<SemanticLayer, string>> = {
  understanding: "AI_UNDERSTANDING_REASONING_EFFORT",
  guard: "AI_STAY_GUARD_REASONING_EFFORT",
  rerank: "KB_RERANK_REASONING_EFFORT",
};

export function semanticModel(layer?: SemanticLayer): string {
  const own = layer ? process.env[SEMANTIC_LAYER_MODEL_ENV[layer]]?.trim() : undefined;
  return own || process.env.AI_SEMANTIC_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

/**
 * Reasoning modeli için düşünme çabası. Yalnız kapalı küme; boş/tanınmayan → gönderilmez (modelin
 * varsayılanı). gpt-5 ailesinin varsayılanı "medium" olabilir → anlam katmanı için "low" önerilir
 * (inceleme 09-24; ölçmeden varsayılan yapılmadı).
 */
export function semanticReasoningEffort(layer?: SemanticLayer): string | undefined {
  const own = layer ? process.env[SEMANTIC_LAYER_EFFORT_ENV[layer]]?.trim() : undefined;
  const v = own || process.env.AI_SEMANTIC_REASONING_EFFORT?.trim();
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

/**
 * YENİDEN SIRALAYICI MOTORU (kurucu 10-28: Decisions API "mantıklı olan yere koyabiliriz … süreyi kısaltmak işimize yarar"). Varsayılan
 * `chat` = bugünkü sohbet sıralayıcısı (`KB_RERANK_MODEL`) BİREBİR. `KB_RERANK_ENGINE=decisions` → OpenAI Decisions API (aday başına evet /
 * hayır olasılığı; ölçüm `docs/arastirma-2026-10-28/decisions-api.md`: p50 0,41 sn / p95 0,86 sn, sohbetin 1,09 / 1,63'üne karşı; kalite tek
 * koşuda sohbetin oynama aralığının alt ucunda — açmak tekrar + kör ölçüm sonrası kurucu kararı). Tanınmayan değer = `chat`.
 */
export type RerankEngine = "chat" | "decisions";
export function rerankEngine(): RerankEngine {
  return process.env.KB_RERANK_ENGINE?.trim().toLowerCase() === "decisions" ? "decisions" : "chat";
}
/** Decisions motorunun modeli (`KB_RERANK_DECISIONS_MODEL`); API bugün yalnız bu modelde. */
export const DEFAULT_DECISIONS_MODEL = "gpt-6-luna";
export function rerankDecisionsModel(): string {
  return process.env.KB_RERANK_DECISIONS_MODEL?.trim() || DEFAULT_DECISIONS_MODEL;
}
