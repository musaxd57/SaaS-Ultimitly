import "server-only";

import { applyCompatModelParams, OPENAI_BASE_URL } from "@/lib/ai/openai-compat";
import { isReasoningModel } from "@/lib/ai/model-family";
import {
  classifyModelProviderFailure,
  noteModelProviderPersistentFailure,
  noteModelProviderSuccess,
} from "@/lib/ai/provider-health";

// ---------------------------------------------------------------------------
// ŞEMA-ZORLAMALI MODEL ÇAĞRISI — anlam katmanının tek ağ kapısı (09-24).
//
// OpenAI Structured Outputs (`response_format: json_schema`, `strict: true`): sağlayıcı çıktıyı
// şemaya ZORLAR (enum/boolean/zorunlu alan). Yine de her çağıran sonucu kodda ayrıca doğrular —
// sağlayıcı garantisi tek başına güvenlik kanıtı değildir.
//
// SÖZLEŞME:
//  · ASLA fırlatmaz; her arıza kapalı-küme bir koda iner (kanıta yazılabilir, metin taşımaz).
//  · Kalıcı sağlayıcı arızası (kota/anahtar/model) GEÇİŞ tabanlı alarma gider (`semantic` kanalı,
//    ayrı anahtar) — 2 dakikalık döngüde çağrı başına alarm = 09-23 seli. Geçici arıza sessizdir;
//    çağıran sonucu kanıta `failed` diye yazar (sessiz ölüm değil, ölçülebilir).
//  · Gövde 64 KB tavanla okunur (bozuk/kötü niyetli dev gövde belleği şişirmesin).
//  · Anahtar-sağlayıcı eşleşmesi `openai-compat` kuralıyla: istek yalnız OpenAI'ye gider.
// ---------------------------------------------------------------------------

export type StructuredCallError =
  | "http"
  | "timeout"
  | "network"
  | "too_large"
  | "truncated"
  | "refusal"
  | "parse";

export type StructuredCallResult =
  | { ok: true; data: unknown; ms: number }
  | { ok: false; error: StructuredCallError; ms: number };

export interface StructuredCallInput {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  schema: { name: string; strict: true; schema: object };
  timeoutMs: number;
  /** Reasoning OLMAYAN model için çıktı tavanı. */
  maxTokens: number;
  /** Reasoning modeli için tavan (gizli düşünme token'ları da bundan yenir). */
  maxCompletionTokens: number;
  /** Test enjeksiyonu; üretimde global `fetch`. */
  fetchImpl?: typeof fetch;
}

const RESPONSE_BYTE_CAP = 64 * 1024;

async function readBodyCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > RESPONSE_BYTE_CAP) {
      await reader.cancel().catch(() => {});
      throw Object.assign(new Error("response_too_large"), { code: "too_large" });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function callStructuredJson(input: StructuredCallInput): Promise<StructuredCallResult> {
  const started = Date.now();
  const ms = () => Date.now() - started;
  const payload: Record<string, unknown> = {
    model: input.model,
    response_format: { type: "json_schema", json_schema: input.schema },
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
  };
  applyCompatModelParams(payload, {
    model: input.model,
    baseUrl: OPENAI_BASE_URL,
    temperature: 0, // sınıflandırma/çıkarım: belirlenimci
    maxTokens: input.maxTokens,
    maxCompletionTokens: input.maxCompletionTokens,
  });
  let res: Response;
  try {
    res = await (input.fetchImpl ?? fetch)(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return { ok: false, error: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network", ms: ms() };
  }
  let body: string;
  try {
    body = await readBodyCapped(res);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const name = err instanceof Error ? err.name : "";
    return {
      ok: false,
      error: code === "too_large" ? "too_large" : name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
      ms: ms(),
    };
  }
  if (!res.ok) {
    const persistent = classifyModelProviderFailure(res.status, body);
    if (persistent) void noteModelProviderPersistentFailure(persistent, res.status, body, "semantic");
    return { ok: false, error: "http", ms: ms() };
  }
  noteModelProviderSuccess("semantic");
  let data: { choices?: { message?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown }[] };
  try {
    data = JSON.parse(body);
  } catch {
    return { ok: false, error: "parse", ms: ms() };
  }
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === "length") return { ok: false, error: "truncated", ms: ms() };
  if (typeof choice?.message?.refusal === "string" && choice.message.refusal.trim()) {
    return { ok: false, error: "refusal", ms: ms() };
  }
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim()) return { ok: false, error: "parse", ms: ms() };
  try {
    return { ok: true, data: JSON.parse(content), ms: ms() };
  } catch {
    return { ok: false, error: "parse", ms: ms() };
  }
}

/** Reasoning modeli mi — çağıranlar zaman aşımını buna göre seçer. */
export { isReasoningModel };
