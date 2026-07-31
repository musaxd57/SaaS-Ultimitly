/**
 * Reasoning (o1/o3/o4…) and GPT-5 family models — Luna/Terra included — only
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
  return /^(o\d|gpt-5)/i.test(model.trim());
}
