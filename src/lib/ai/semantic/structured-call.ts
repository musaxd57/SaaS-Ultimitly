import "server-only";

import { applyCompatModelParams, OPENAI_BASE_URL } from "@/lib/ai/openai-compat";
import { isReasoningModel } from "@/lib/ai/model-family";
import { promptCacheFields } from "@/lib/ai/prompt-cache";
import { isRetryableReplyStatus, replyRetryDelayMs } from "@/lib/ai/model-breaker";
import {
  classifyModelProviderFailure,
  isUnsupportedRequestFailure,
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

/**
 * `transient`: GEÇİCİ arıza (408 · 429 hız sınırı · 5xx · istek GÖNDERİLİRKEN düşen, zaman aşımı OLMAYAN ağ hatası; kalıcı sınıflandırma —
 * kota / anahtar / model / istek — ÖNCE yapılır). Cevap gövdesi okunurken kopan bağlantı bilinçli olarak geçici SAYILMAZ: sağlayıcı cevabı
 * üretmiş (ve ücretlendirmiş) olabilir. Yalnız tek yeniden denemenin kararı içindir (`callStructuredJsonRetryingOnce`); `retryAfter`
 * sağlayıcının başlığı.
 */
export type StructuredCallResult =
  | { ok: true; data: unknown; ms: number }
  | { ok: false; error: StructuredCallError; ms: number; transient?: true; retryAfter?: string | null };

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
  /** Reasoning modeli için düşünme çabası (`AI_SEMANTIC_REASONING_EFFORT`); verilmezse gönderilmez. */
  reasoningEffort?: string;
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
  if (input.reasoningEffort && isReasoningModel(input.model)) payload.reasoning_effort = input.reasoningEffort;
  Object.assign(payload, promptCacheFields(`semantic:${input.schema.name}`, `${OPENAI_BASE_URL}/chat/completions`));
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
    return name === "TimeoutError" || name === "AbortError"
      ? { ok: false, error: "timeout", ms: ms() }
      : { ok: false, error: "network", ms: ms(), transient: true };
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
    const persistent =
      classifyModelProviderFailure(res.status, body) ?? (isUnsupportedRequestFailure(res.status, body) ? "request" : null);
    if (persistent) void noteModelProviderPersistentFailure(persistent, res.status, body, "semantic");
    return !persistent && isRetryableReplyStatus(res.status)
      ? { ok: false, error: "http", ms: ms(), transient: true, retryAfter: res.headers.get("retry-after") }
      : { ok: false, error: "http", ms: ms() };
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

export interface DecisionsCallInput {
  apiKey: string;
  model: string;
  /** Soruların okunacağı metin (sıralayıcıda sohbet sıralayıcısının kullanıcı metniyle BİREBİR aynı). */
  input: string;
  /** Evet / hayır soruları (`predicate`); `name` cevapta geri döner. */
  questions: readonly { name: string; instructions: string }[];
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export type DecisionsCallResult =
  | { ok: true; probabilities: Map<string, number>; ms: number }
  | { ok: false; error: StructuredCallError; ms: number };

/**
 * OPENAI DECISIONS API (`POST /v1/decisions`, kurucu 10-28: "mantıklı olan yere koyabiliriz … süreyi kısaltmak işimize yarar"): serbest metin
 * ÜRETMEZ, her evet / hayır sorusuna OLASILIK döner. Bugün tek çağıranı yeniden sıralayıcı (`KB_RERANK_ENGINE=decisions`, varsayılan KAPALI).
 * Sözleşme `callStructuredJson` ile AYNI: asla fırlatmaz, gövde 64 KB tavanlı, kalıcı sağlayıcı arızası `semantic` kanalının geçiş alarmına,
 * istek yalnız OpenAI'ye. Cevap KATI okunur: yalnız istenen adlar, yalnız [0, 1] aralığında sonlu sayı (sağlayıcının biçimi güvenlik kanıtı
 * değil); hiç geçerli cevap yoksa `parse`.
 */
export async function callDecisions(input: DecisionsCallInput): Promise<DecisionsCallResult> {
  const started = Date.now();
  const ms = () => Date.now() - started;
  const wanted = new Set(input.questions.map((q) => q.name));
  let res: Response;
  try {
    res = await (input.fetchImpl ?? fetch)(`${OPENAI_BASE_URL}/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify({
        model: input.model,
        input: input.input,
        questions: input.questions.map((q) => ({ type: "predicate", name: q.name, instructions: q.instructions })),
      }),
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
    const persistent =
      classifyModelProviderFailure(res.status, body) ?? (isUnsupportedRequestFailure(res.status, body) ? "request" : null);
    if (persistent) void noteModelProviderPersistentFailure(persistent, res.status, body, "semantic");
    return { ok: false, error: "http", ms: ms() };
  }
  noteModelProviderSuccess("semantic");
  let data: { answers?: unknown };
  try {
    data = JSON.parse(body);
  } catch {
    return { ok: false, error: "parse", ms: ms() };
  }
  if (!Array.isArray(data?.answers)) return { ok: false, error: "parse", ms: ms() };
  const probabilities = new Map<string, number>();
  for (const a of data.answers as unknown[]) {
    const name = (a as { name?: unknown })?.name;
    const p = (a as { probability?: unknown })?.probability;
    if (typeof name !== "string" || !wanted.has(name) || probabilities.has(name)) continue;
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) continue;
    probabilities.set(name, p);
  }
  return probabilities.size > 0 ? { ok: true, probabilities, ms: ms() } : { ok: false, error: "parse", ms: ms() };
}

/**
 * Tek yeniden denemenin süre bütçesi (kurucu 4.11 notu: "süreye falan baksın"). İkinci deneme ilk denemeden KALAN süreyle koşar
 * (tavan − geçen − bekleme) → toplam bekleme tek çağrının tavanını AŞMAZ (QR süre bütçesi `SEMANTIC_TIMEOUT_MAX_MS` hesabı değişmez).
 * Kalan süre tavanın yarısından azsa denenmez: hata yavaş geldiyse (sağlayıcı zorlanıyor) kısa ikinci deneme de büyük olasılıkla
 * yetişmez — "hızlı yeniden deneme" yalnız hızlı dönen hataya. `null` = deneme yok. Saf.
 */
export function structuredRetryBudgetMs(timeoutMs: number, elapsedMs: number, delayMs: number): number | null {
  const remaining = timeoutMs - elapsedMs - delayMs;
  return remaining >= timeoutMs / 2 ? remaining : null;
}

/**
 * TEK HIZLI YENİDEN DENEME (kurucu kararı 4.11, 10-28 — cevap modelinin 10-21 kuralı, `model-breaker.ts`): GEÇİCİ arıza bir kez, kısa
 * beklemeyle (`Retry-After` tavanlı) yeniden denenir. Zaman aşımı (bekleme ikiye katlanırdı), kalıcı arıza (kota / anahtar / model /
 * istek), kesik / bozuk / reddedilen cevap DENENMEZ. Süre `structuredRetryBudgetMs` ile sınırlı. Bugün yalnız parça okuyucusu kullanır
 * (öteki anlam katmanlarına bağlamak ayrı karar). `ms` iki denemenin toplamıdır. Asla fırlatmaz.
 */
export async function callStructuredJsonRetryingOnce(input: StructuredCallInput): Promise<StructuredCallResult> {
  const first = await callStructuredJson(input);
  if (first.ok || first.transient !== true) return first;
  const delayMs = replyRetryDelayMs(first.retryAfter ?? null);
  const budget = structuredRetryBudgetMs(input.timeoutMs, first.ms, delayMs);
  if (budget === null) return first;
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  const second = await callStructuredJson({ ...input, timeoutMs: budget });
  return { ...second, ms: first.ms + delayMs + second.ms };
}

/** Reasoning modeli mi — çağıranlar zaman aşımını buna göre seçer. */
export { isReasoningModel };
