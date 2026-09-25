/**
 * Reasoning (o1/o3/o4…) and GPT-5+ family models (gpt-5.x, gpt-6-luna/sol/astra …) only
 * accept the default sampling settings (a custom `temperature` is rejected) and
 * take their output ceiling as `max_completion_tokens`, which must also cover the
 * hidden reasoning tokens. Every caller that builds an OpenAI-compatible request
 * body needs the same answer, so it lives in one place.
 *
 * Deliberately a LEAF module: no imports, no `server-only`. Callers get the
 * predicate without pulling in the whole `@/lib/ai` surface — and without being
 * silently broken by a test that mocks `@/lib/ai` (an undefined predicate would
 * throw mid-request and look like an upstream failure).
 */
export function isReasoningModel(model: string): boolean {
  // gpt-5 ve SONRASI (gpt-6-luna/sol/astra, 09-25 canlı sonda: temperature 0.4 ve max_tokens reddedilir). Eski kural
  // yalnız gpt-5'i tanıyordu; gpt-6'ya geçiş her çağrıyı 400 ile düşürürdü. gpt-4.x / 3.5 klasik kalır.
  return /^(o\d|gpt-(?:[5-9]|\d{2,})(?!\d))/i.test(model.trim());
}

/**
 * Last-resort model when no `OPENAI_*_MODEL` env is set. Production sets
 * `OPENAI_MODEL=gpt-5.1`, so this default is normally unused — it matters on the
 * day the env var goes missing. It used to say `gpt-4.1`, which is NOT a reasoning
 * model: losing the env would have silently changed the request shape (temperature
 * back on, `max_tokens` instead of `max_completion_tokens`) and quietly
 * de-calibrated a gate whose prompts and golden set were tuned on gpt-5.1.
 * Keep this in the same family as what production runs.
 */
export const DEFAULT_OPENAI_MODEL = "gpt-5.1";

const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high"] as const;

/**
 * Cevap modeli için düşünme çabası (`OPENAI_REASONING_EFFORT`, 09-25 model kıyası). Kapalı küme; boş/tanınmayan →
 * `undefined` = gövdeye GİRMEZ (modelin varsayılanı — bugünkü canlı davranış). Yalnız reasoning modelinde gönderilir
 * (çağıran `isReasoningModel` ile birlikte kullanır). gpt-6-luna varsayılanda düşünür, gpt-5.1 düşünmez: kıyas ve
 * gecikme/maliyet ayarı bu anahtarla ölçülür.
 */
export function replyReasoningEffort(): (typeof REASONING_EFFORTS)[number] | undefined {
  const v = process.env.OPENAI_REASONING_EFFORT?.trim();
  return (REASONING_EFFORTS as readonly string[]).includes(v ?? "") ? (v as (typeof REASONING_EFFORTS)[number]) : undefined;
}
