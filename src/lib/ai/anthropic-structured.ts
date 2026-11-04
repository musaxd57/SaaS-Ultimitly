import "server-only";

import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type { StructuredCallResult } from "@/lib/ai/semantic/structured-call";

// ---------------------------------------------------------------------------
// ŞEMA-ZORLAMALI ANTHROPIC ÇAĞRISI (kurucu 11-04: "Haikuya geçelim karar metni yazıcısında"). Ölçülen biçimin BİREBİR karşılığı (istek 8–9,
// `tests/eval/anthropic-reply-shim.ts`): düşünme kapalı · `output_config.effort` · `output_config.format` json_schema · sistem istemi
// önbellekli. Sonuç `callStructuredJson` ile AYNI kapalı küme (çağıran sağlayıcıdan habersiz). ASLA fırlatmaz.
// Anahtar `ANTHROPIC_API_KEY` (kalite denetçisiyle aynı); misafir metni bu yola GİRMEZ (yalnız karar kaydı + iç kontrol listesi).
// ---------------------------------------------------------------------------

export const ANTHROPIC_EFFORTS = ["low", "medium", "high"] as const;
export type AnthropicEffort = (typeof ANTHROPIC_EFFORTS)[number];

export function isAnthropicModel(model: string): boolean {
  return /^claude-/.test(model);
}

export function anthropicApiKey(): string | null {
  const k = process.env.ANTHROPIC_API_KEY?.trim();
  return k ? k : null;
}

export interface AnthropicStructuredInput {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  schema: object;
  timeoutMs: number;
  maxTokens: number;
  effort: AnthropicEffort;
  /** Test enjeksiyonu; üretimde global `fetch`. */
  fetchImpl?: typeof fetch;
}

export async function callAnthropicStructuredJson(input: AnthropicStructuredInput): Promise<StructuredCallResult> {
  const started = Date.now();
  const ms = () => Date.now() - started;
  try {
    const client = new Anthropic({
      apiKey: input.apiKey,
      timeout: input.timeoutMs,
      maxRetries: 0,
      ...(input.fetchImpl ? { fetch: input.fetchImpl } : {}),
    });
    const res = await client.messages.create({
      model: input.model,
      max_tokens: input.maxTokens,
      system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: input.user }],
      thinking: { type: "disabled" },
      output_config: { effort: input.effort, format: { type: "json_schema", schema: input.schema as Record<string, unknown> } },
    });
    if (res.stop_reason === "refusal") return { ok: false, error: "refusal", ms: ms() };
    if (res.stop_reason === "max_tokens") return { ok: false, error: "truncated", ms: ms() };
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    try {
      return { ok: true, data: JSON.parse(text) as unknown, ms: ms() };
    } catch {
      return { ok: false, error: "parse", ms: ms() };
    }
  } catch (err) {
    if (err instanceof APIError) {
      const status = err.status ?? 0;
      if (status === 0) return { ok: false, error: /timeout/i.test(err.message) ? "timeout" : "network", ms: ms() };
      return { ok: false, error: "http", ms: ms(), ...(status === 408 || status === 429 || status >= 500 ? { transient: true as const } : {}) };
    }
    return { ok: false, error: "network", ms: ms() };
  }
}
