import "server-only";

import type { PrepPlan } from "@/lib/supply";
import { reportError, redactSensitive } from "@/lib/report-error";

// Optional, cosmetic AI summary for the prep/shopping plan ("bu hafta çöp poşeti
// al" tarzı). OpenAI-COMPATIBLE (works with akashML / any /v1/chat/completions):
//   SUPPLY_AI_API_KEY   — required to enable (unset → feature hidden/no-op)
//   SUPPLY_AI_BASE_URL  — default https://api.akashml.com/v1
//   SUPPLY_AI_MODEL     — default zai-org/GLM-5.2 (akashML's GLM-5.2 slug)
// PRIVACY: only aggregate NUMBERS + property names + counts are sent — never a
// guest name/email/phone (the PrepPlan carries no guest PII to begin with).

export function supplyAiConfigured(): boolean {
  return Boolean(process.env.SUPPLY_AI_API_KEY?.trim());
}

export type SupplySummaryResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/** Compact, PII-free data block describing the plan for the model. */
function planToText(plan: PrepPlan): string {
  const lines: string[] = [];
  lines.push(`Aralık: önümüzdeki ${plan.days} gün. Toplam giriş (turnover): ${plan.totalArrivals}.`);
  if (plan.consumables.length > 0) {
    lines.push(
      "Alınacaklar (sarf): " +
        plan.consumables.map((i) => `${i.label} ${i.qty} ${i.unit}`).join(", ") +
        ".",
    );
  }
  if (plan.linen.length > 0) {
    lines.push(
      "Hazırlanacak (çamaşır): " +
        plan.linen.map((i) => `${i.label} ${i.qty} ${i.unit}`).join(", ") +
        ".",
    );
  }
  if (plan.missingProfile.length > 0) {
    lines.push(`Malzeme profili tanımsız daire sayısı: ${plan.missingProfile.length}.`);
  }
  return lines.join("\n");
}

const SYSTEM_PROMPT =
  "Sen kısa dönem kiralama işletmecisine yardımcı, pratik bir asistansın. Sana verilen " +
  "hazırlık/alışveriş verisinden Türkçe, KISA (en fazla 2-3 cümle), samimi ama sade bir özet " +
  "yaz. SADECE verilen rakamları kullan, yeni sayı/kalem UYDURMA. Öncelikli alınacakları vurgula " +
  "(ör. 'bu hafta çöp poşeti ve şampuan almanız iyi olur'). Madde işareti veya başlık kullanma, " +
  "düz cümle yaz. Kişisel veri yoktur, ekleme.";

/**
 * Generate a short natural-language summary of the prep plan via an OpenAI-
 * compatible endpoint. Returns a discriminated result so the caller can surface a
 * (redacted) failure reason for debugging — a wrong model id / key / URL is the
 * usual cause. Never throws.
 */
export async function generateSupplySummary(plan: PrepPlan): Promise<SupplySummaryResult> {
  const key = process.env.SUPPLY_AI_API_KEY?.trim();
  if (!key) return { ok: false, reason: "not_configured" };
  if (plan.linen.length === 0 && plan.consumables.length === 0) return { ok: false, reason: "empty_plan" };

  const base = (process.env.SUPPLY_AI_BASE_URL?.trim() || "https://api.akashml.com/v1").replace(/\/$/, "");
  const model = process.env.SUPPLY_AI_MODEL?.trim() || "zai-org/GLM-5.2";
  const url = `${base}/chat/completions`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: planToText(plan) },
        ],
        temperature: 0.4,
        max_tokens: 600,
        // GLM-5.2 is a REASONING model — left on, it returns its (English, verbose)
        // chain-of-thought instead of a clean answer. Disable "thinking" so it emits
        // a direct 2-3 sentence answer in `content`. This is the GLM/Qwen toggle on
        // vLLM/SGLang backends (akashML). If an endpoint ignores it, the <think>
        // strip + content-only parsing below still keep the visible text clean.
        chat_template_kwargs: { enable_thinking: false },
      }),
      // akashML/GLM can take a few seconds; generous but bounded so a hung
      // upstream can't wedge the request.
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const bodySnippet = redactSensitive((await res.text().catch(() => "")).slice(0, 300));
      const reason = `HTTP ${res.status} (model=${model}) ${bodySnippet}`.trim();
      void reportError("supply-ai", new Error(reason));
      return { ok: false, reason };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
    };
    const choice = data?.choices?.[0];
    // Only the visible answer — NEVER the reasoning/thinking (verbose + English).
    // Defensively strip any inline <think>…</think> a reasoning model may emit.
    const text = (choice?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    if (!text) {
      return { ok: false, reason: `boş yanıt (model=${model}, finish=${choice?.finish_reason ?? "?"})` };
    }
    return { ok: true, text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void reportError("supply-ai", e);
    return { ok: false, reason: redactSensitive(`bağlantı hatası: ${msg}`) };
  }
}
