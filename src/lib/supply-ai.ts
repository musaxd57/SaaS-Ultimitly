import "server-only";

import type { PrepPlan } from "@/lib/supply";

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
 * Generate a short natural-language summary of the prep plan. Returns null when
 * not configured or on any error/timeout (the caller shows the deterministic list
 * regardless — this is purely additive polish). Never throws.
 */
export async function generateSupplySummary(plan: PrepPlan): Promise<string | null> {
  const key = process.env.SUPPLY_AI_API_KEY?.trim();
  if (!key) return null;
  if (plan.linen.length === 0 && plan.consumables.length === 0) return null;

  const base = (process.env.SUPPLY_AI_BASE_URL?.trim() || "https://api.akashml.com/v1").replace(/\/$/, "");
  const model = process.env.SUPPLY_AI_MODEL?.trim() || "zai-org/GLM-5.2";

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: planToText(plan) },
        ],
        temperature: 0.4,
        max_tokens: 220,
      }),
      // akashML/GLM can take a few seconds; generous but bounded so a hung
      // upstream can't wedge the request.
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}
