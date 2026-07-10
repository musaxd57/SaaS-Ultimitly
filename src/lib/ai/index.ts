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

// The 14 intents the prompt defines. The auto-send gate works with an intent
// BLOCKLIST, so a novel/unknown intent string from the model would sail past
// it — clamp unknowns to "general" AND cap their confidence below the 0.75
// auto-send floor, so an off-taxonomy answer can never be sent unreviewed.
/** The closed riskType label set (WHY risky). A LABEL only — the send decision
 * stays in code; the gate may tighten on these but never loosen. Unknown model
 * output clamps to null so a novel label can never carry meaning downstream. */
export const RISK_TYPES = new Set([
  "complaint", "money_refund", "cancellation", "human_request", "review_threat",
  "platform_policy", "safety_emergency", "discrimination", "rule_violation",
  "access_security", "prompt_injection",
]);

/**
 * Evidence claims are VERIFIED against the actual request context — the model
 * can only cite a kb category / property field / reservation / history that
 * really existed in its input. Unverifiable claims are silently dropped, so
 * the UI never presents an invented source as fact.
 */
function verifyUsedSources(list: string[], input: SuggestReplyInput): string[] {
  const kbCats = new Set(input.knowledgeBase.map((k) => k.category));
  return list.filter((src) => {
    if (src.startsWith("kb:")) return kbCats.has(src.slice(3));
    if (src === "property:address") return Boolean(input.property.address);
    if (src.startsWith("property:")) {
      // Whitelist the REAL property fields — a blanket `true` let the model inject
      // a fabricated source (e.g. "property:door_code") that then showed as a
      // "used context" chip, contradicting the invented-source-dropped guarantee.
      const field = src.slice("property:".length);
      return field === "checkInTime" || field === "checkOutTime" || field === "name" || field === "city";
    }
    if (src.startsWith("reservation:")) return input.reservation != null;
    if (src === "history") return Boolean(input.history && input.history.length > 0) || Boolean(input.styleProfile);
    return false; // unknown shape → drop
  });
}

/** Max evidence entries / entry length — the model must never flood the DB/UI. */
function sanitizeStringList(raw: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .slice(0, maxItems)
    .map((x) => x.trim().slice(0, maxLen));
}

const KNOWN_INTENTS = new Set([
  "complaint", "refund", "early_checkin", "late_checkout", "early_departure",
  "human_request", "checkin", "checkout", "wifi", "parking", "location",
  "cleaning", "amenity", "general",
]);

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

/** Normalize a model-returned language value to a short code (2–3 letters), else
 *  "und" (BCP-47 "undetermined") so garbage can't ride through as a real language. */
function normalizeLang(v: unknown): string {
  if (typeof v !== "string") return "und";
  const primary = v.trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(primary) ? primary : "und";
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
  // Bound the output — a runaway generation would blow up cost/latency and bloat
  // the DB/UI/log surfaces it lands on. A reply + its small JSON envelope is short;
  // reasoning models use max_completion_tokens (must also cover hidden reasoning).
  if (isReasoningModel(model)) payload.max_completion_tokens = 2000;
  else payload.max_tokens = 900;
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
    const choice = data?.choices?.[0];
    // Truncated output (hit max_completion_tokens): the JSON is almost certainly
    // incomplete and any "reply" is cut off. Treat it as a failure → the caller
    // uses the deterministic fallback (source="fallback") and the auto-send gate
    // (which requires source==="openai") never ships a truncated reply.
    if (choice?.finish_reason === "length") {
      void reportError("openai-reply truncated", new Error("finish_reason=length"));
      return null;
    }
    return choice?.message?.content ?? null;
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
          // A PRESENT-but-unrecognized value ("High", "critical", "severe") must
          // fail CLOSED — coercing it to "none" silently passed the auto-send
          // riskLevel gate. "high" makes the gate hold it for a human (the intent
          // path fails closed the same way). Absent → "none" via the ?? above.
          : "high";
        const intentRaw = String(parsed.intent ?? "general");
        const intentKnown = KNOWN_INTENTS.has(intentRaw);
        return {
          intent: intentKnown ? intentRaw : "general",
          confidence: intentKnown
            ? clamp01(Number(parsed.confidence))
            : Math.min(clamp01(Number(parsed.confidence)), 0.5),
          // Cap every free-text field the model returns — an over-long value would
          // bloat the DB row / inbox UI / logs it lands on (no max_tokens guarantee
          // per-field). A real guest reply is well under 2000 chars.
          reply: parsed.reply.trim().slice(0, 2000),
          risk: typeof parsed.risk === "string" && parsed.risk.trim() ? parsed.risk.slice(0, 300) : null,
          priority,
          source: "openai",
          actionSuggestion:
            typeof parsed.actionSuggestion === "string" && parsed.actionSuggestion.trim()
              ? parsed.actionSuggestion.trim().slice(0, 300)
              : null,
          riskLevel,
          // Clamp to a normalized short language code (2–3 letters). Anything else
          // (a sentence, garbage) → "en" default, so the field can't be bloated or
          // carry model prose.
          detectedLanguage: normalizeLang(parsed.detectedLanguage),
          riskType:
            typeof parsed.riskType === "string" && RISK_TYPES.has(parsed.riskType)
              ? parsed.riskType
              : null,
          usedSources: verifyUsedSources(sanitizeStringList(parsed.usedSources, 8, 60), input),
          missingInfo: sanitizeStringList(parsed.missingInfo, 5, 80),
          statedCheckoutTime:
            typeof parsed.statedCheckoutTime === "string" &&
            /^([01]?\d|2[0-3]):[0-5]\d$/.test(parsed.statedCheckoutTime.trim())
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
