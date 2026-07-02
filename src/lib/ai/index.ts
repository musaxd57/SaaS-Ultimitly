import "server-only";
import { REPLY_SYSTEM_PROMPT, buildReplyUserPrompt } from "./prompts";
import { suggestReplyFallback, classifyFallback } from "./fallback";
import type { ClassifyResult, SuggestReplyInput, SuggestReplyResult } from "./types";
import type { Priority } from "@/lib/constants";
import { reportError } from "@/lib/report-error";

export type { SuggestReplyInput, SuggestReplyResult, ClassifyResult } from "./types";

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

/**
 * Reasoning (o1/o3/o4…) and GPT-5 family models only accept default sampling and
 * reject a custom `temperature`. Detect them so we can omit that param (and allow
 * a longer timeout), letting ANY model be dropped in via env without breaking.
 */
export function isReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5)/i.test(model.trim());
}

/** The model used for the main guest-reply generation. */
function replyModel(): string {
  return process.env.OPENAI_MODEL || "gpt-4.1";
}

async function callOpenAI(system: string, user: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const model = replyModel();
  const payload: Record<string, unknown> = {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  // Reasoning models only accept the default temperature; everything else gets
  // a low temperature for consistency.
  if (!isReasoningModel(model)) payload.temperature = 0.4;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
      // Reasoning models can be slower — allow a longer ceiling.
      signal: AbortSignal.timeout(isReasoningModel(model) ? 60000 : 20000),
    });
    if (!res.ok) {
      // Silent-degradation guard: every call here falls back to the deterministic
      // fallback on failure (by design — the guest always gets an answer), but a
      // persistent cause (bad/expired key, exhausted quota, deprecated model)
      // would otherwise degrade every reply with nobody noticing. Report, don't
      // throw — the fallback path below is unaffected.
      void reportError(`openai-reply ${res.status}`, new Error(await res.text().catch(() => res.statusText)));
      return null;
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    void reportError("openai-reply", err);
    return null;
  }
}

/**
 * Suggest a guest reply. Tries OpenAI when configured; otherwise (or on any
 * failure) uses the deterministic fallback so the feature always works.
 */
export async function suggestReply(input: SuggestReplyInput): Promise<SuggestReplyResult> {
  const raw = await callOpenAI(REPLY_SYSTEM_PROMPT, buildReplyUserPrompt(input));
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed.reply === "string" && parsed.reply.trim()) {
        const priorityRaw = String(parsed.priority ?? "standard");
        const priority: Priority = (["urgent", "standard", "low"] as const).includes(
          priorityRaw as Priority,
        )
          ? (priorityRaw as Priority)
          : "standard";
        const riskLevelRaw = String(parsed.riskLevel ?? "none");
        const riskLevel = (["none", "low", "medium", "high"] as const).includes(
          riskLevelRaw as "none" | "low" | "medium" | "high",
        )
          ? (riskLevelRaw as "none" | "low" | "medium" | "high")
          : "none";
        return {
          intent: String(parsed.intent ?? "general"),
          confidence: clamp01(Number(parsed.confidence)),
          reply: parsed.reply.trim(),
          risk: typeof parsed.risk === "string" && parsed.risk.trim() ? parsed.risk : null,
          priority,
          source: "openai",
          actionSuggestion:
            typeof parsed.actionSuggestion === "string" && parsed.actionSuggestion.trim()
              ? parsed.actionSuggestion.trim()
              : null,
          riskLevel,
          detectedLanguage:
            typeof parsed.detectedLanguage === "string" && parsed.detectedLanguage.trim()
              ? parsed.detectedLanguage.trim()
              : "en", // policy: English by default when unknown
          statedCheckoutTime:
            typeof parsed.statedCheckoutTime === "string" &&
            /^\d{1,2}:\d{2}$/.test(parsed.statedCheckoutTime.trim())
              ? parsed.statedCheckoutTime.trim()
              : null,
        };
      }
    } catch {
      // fall through to deterministic fallback
    }
  }
  return suggestReplyFallback(input);
}

/**
 * Distil a short "style guide" from the host's own past replies, so future AI
 * drafts can mirror their voice and typical decisions. Internal summarisation —
 * uses a cheap model. Returns null if OpenAI isn't configured, on any failure,
 * or when there isn't enough signal. Never throws.
 */
export async function summarizeHostStyle(sampleReplies: string[]): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const samples = sampleReplies.map((s) => s.trim()).filter(Boolean).slice(0, 40);
  if (samples.length < 5) return null; // too little signal to generalise safely

  const system =
    "Sen bir editör asistanısın. Bir kısa dönem kiralama ev sahibinin geçmiş misafir " +
    "cevaplarını okuyup, gelecekteki AI taslakları için bir REHBER çıkaracaksın. İKİ bölüm yaz:\n" +
    "1) TARZ: selamlama/kapanış alışkanlığı, samimiyet düzeyi, cümle uzunluğu, emoji kullanımı.\n" +
    "2) SIK SORULAN SORULAR: ev sahibinin tekrar eden, GİZLİ OLMAYAN sorulara (ör. otopark, " +
    "valiz/bagaj bırakma, ulaşım/yol tarifi, geç çıkış/erken giriş yaklaşımı, çevre önerileri) " +
    "verdiği tipik cevapları kısaca özetle — yalnızca tutarlı, tekrar eden cevapları.\n" +
    "KESİNLİKLE DIŞARIDA BIRAK: Wi-Fi şifresi, kapı/giriş kodu, tam ev adresi, fiyat ve iade " +
    "rakamları (bunlar gizli/değişkendir, rehbere ASLA koyma). En fazla 220 kelime, madde madde.";
  const user = `Ev sahibinin geçmiş cevapları:\n\n${samples.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;

  const model = process.env.OPENAI_STYLE_MODEL || process.env.OPENAI_MODEL || "gpt-4.1";
  const payload: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (!isReasoningModel(model)) payload.temperature = 0.2;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(isReasoningModel(model) ? 60000 : 20000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? text.trim().slice(0, 1800) : null;
  } catch {
    return null;
  }
}

/**
 * Classify an inbound message (intent / priority / complaint flag).
 * Uses the deterministic classifier for speed and predictability.
 */
export async function classifyMessage(message: string): Promise<ClassifyResult> {
  return classifyFallback(message);
}
