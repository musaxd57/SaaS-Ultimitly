import "server-only";

import type { PrepPlan } from "@/lib/supply";
import { reportError, redactSensitive } from "@/lib/report-error";
import { isSecureExternalUrl } from "@/lib/secure-url";
import {
  applyCompatModelParams,
  compatModelMatchesEndpoint,
  resolveCompatBaseUrl,
  resolveCompatKey,
} from "@/lib/ai/openai-compat";

// Optional, cosmetic AI summary for the prep/shopping plan ("bu hafta çöp poşeti
// al" tarzı). OpenAI-COMPATIBLE (any /v1/chat/completions):
//   SUPPLY_AI_API_KEY   — opsiyonel; yoksa endpoint OpenAI iken OPENAI_API_KEY
//                         (anahtar-sağlayıcı eşleşmesi: ai/openai-compat.ts)
//   SUPPLY_AI_BASE_URL  — default https://api.openai.com/v1
//   SUPPLY_AI_MODEL     — default gpt-5.6-luna
// 2026-07-31'e kadar bu özellik Akash/GLM'e gidiyordu. Artık yanıt üretiminin
// ZATEN kullandığı sağlayıcıya gidiyor → Akash veri işleyen olmaktan çıktı
// (gizlilik metnindeki alt-işleyen listesi bir kalem sadeleşti).
// PRIVACY: only aggregate NUMBERS + property names + counts are sent — never a
// guest name/email/phone (the PrepPlan carries no guest PII to begin with).

const DEFAULT_SUPPLY_MODEL = "gpt-5.6-luna";

function supplyBaseUrl(): string {
  return resolveCompatBaseUrl(process.env.SUPPLY_AI_BASE_URL);
}

function supplyKey(): string | undefined {
  return resolveCompatKey(process.env.SUPPLY_AI_API_KEY, supplyBaseUrl());
}

export function supplyAiConfigured(): boolean {
  return Boolean(supplyKey());
}

export type SupplySummaryResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/** Compact, PII-free data block describing the plan for the model. Uses the NET
 * amount to buy/prepare (after on-hand stock). */
function planToText(plan: PrepPlan): string {
  const lines: string[] = [];
  lines.push(`Aralık: önümüzdeki ${plan.days} gün. Toplam giriş (turnover): ${plan.totalArrivals}.`);
  const buy = plan.consumables.filter((i) => i.toBuy > 0);
  const prep = plan.linen.filter((i) => i.toBuy > 0);
  if (buy.length > 0) {
    lines.push("Alınacaklar (sarf): " + buy.map((i) => `${i.label} ${i.toBuy} ${i.unit}`).join(", ") + ".");
  }
  if (prep.length > 0) {
    lines.push("Hazırlanacak (çamaşır): " + prep.map((i) => `${i.label} ${i.toBuy} ${i.unit}`).join(", ") + ".");
  }
  if (plan.missingProfile.length > 0) {
    lines.push(`Malzeme profili tanımsız daire sayısı: ${plan.missingProfile.length}.`);
  }
  return lines.join("\n");
}

/** Whether there is anything to actually buy/prepare (net of stock). */
export function planHasBuyables(plan: PrepPlan): boolean {
  return [...plan.linen, ...plan.consumables].some((i) => i.toBuy > 0);
}

const SYSTEM_PROMPT =
  "Sen kısa dönem kiralama işletmecisine yardımcı, pratik bir asistansın. Sana verilen " +
  "hazırlık/alışveriş verisinden Türkçe, sade ama DOLU (3-4 cümle) bir özet yaz. " +
  "HER kalemin ADEDİNİ ve birimini MUTLAKA yaz (ör. '3 adet çöp poşeti, 3 adet şampuan, " +
  "3 rulo tuvalet kağıdı'). SADECE verilen rakamları kullan, yeni sayı/kalem UYDURMA, hiçbir " +
  "kalemi atlama. Önce alınacak sarf malzemelerini adetleriyle listele (en kritikleri başta), " +
  "sonra hazırlanacak çamaşır/tekstili adetleriyle söyle. Madde işareti veya başlık kullanma, " +
  "akıcı düz cümlelerle yaz. Kişisel veri yoktur, ekleme.";

/**
 * Generate a short natural-language summary of the prep plan via an OpenAI-
 * compatible endpoint. Returns a discriminated result so the caller can surface a
 * (redacted) failure reason for debugging — a wrong model id / key / URL is the
 * usual cause. Never throws.
 */
export async function generateSupplySummary(plan: PrepPlan): Promise<SupplySummaryResult> {
  const base = supplyBaseUrl();
  const key = supplyKey();
  if (!key) return { ok: false, reason: "not_configured" };
  if (!planHasBuyables(plan)) return { ok: false, reason: "empty_plan" };

  // HTTPS-pin (P2): never send the Bearer API key to an insecure endpoint. Fail
  // BEFORE the network call — production requires https, dev/test allows only
  // localhost http (secure-url.ts). The URL is not logged (it can carry a token).
  if (!isSecureExternalUrl(base)) {
    void reportError("supply-ai", new Error("SUPPLY_AI_BASE_URL is not an https endpoint — refused (no key sent)"));
    return { ok: false, reason: "insecure_base_url" };
  }
  const model = process.env.SUPPLY_AI_MODEL?.trim() || DEFAULT_SUPPLY_MODEL;
  // Env yarım güncellendiyse (endpoint OpenAI'ye çevrildi ama SUPPLY_AI_MODEL eski
  // satıcı slug'ında kaldı) her tıklamada 404 yerine adı konmuş bir hata dön.
  if (!compatModelMatchesEndpoint(model, base)) {
    return { ok: false, reason: `model_endpoint_mismatch (model=${model})` };
  }
  const url = `${base}/chat/completions`;

  try {
    const payload = applyCompatModelParams(
      {
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: planToText(plan) },
        ],
      },
      {
        model,
        baseUrl: base,
        temperature: 0.4, // özet metni: biraz akıcılık
        maxTokens: 600,
        // Reasoning modelinde bu tavan gizli düşünme token'larını DA kapsar;
        // 600 bırakılsaydı yanıt boş dönerdi (finish=length).
        maxCompletionTokens: 2000,
      },
    );

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      // A reasoning model can take a few seconds; generous but bounded so a hung
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
