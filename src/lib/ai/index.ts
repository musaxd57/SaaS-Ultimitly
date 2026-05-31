import "server-only";
import { REPLY_SYSTEM_PROMPT, buildReplyUserPrompt } from "./prompts";
import { suggestReplyFallback, classifyFallback } from "./fallback";
import type { ClassifyResult, SuggestReplyInput, SuggestReplyResult } from "./types";
import type { Priority } from "@/lib/constants";

export type { SuggestReplyInput, SuggestReplyResult, ClassifyResult } from "./types";

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

async function callOpenAI(system: string, user: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      // Avoid hanging requests blocking the UI.
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? null;
  } catch {
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
              : "tr",
        };
      }
    } catch {
      // fall through to deterministic fallback
    }
  }
  return suggestReplyFallback(input);
}

/**
 * Classify an inbound message (intent / priority / complaint flag).
 * Uses the deterministic classifier for speed and predictability.
 */
export async function classifyMessage(message: string): Promise<ClassifyResult> {
  return classifyFallback(message);
}
