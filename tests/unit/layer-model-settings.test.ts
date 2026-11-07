import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

vi.mock("@/lib/ai/provider-health", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/provider-health")>()),
  noteModelProviderPersistentFailure: vi.fn(async () => {}),
  noteModelProviderSuccess: vi.fn(),
}));
vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));

import { SEMANTIC_LAYER_EFFORT_ENV, SEMANTIC_LAYER_MODEL_ENV, semanticModel, semanticReasoningEffort } from "@/lib/ai/semantic/config";
import { understandGuestMessages, __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { translate, __resetTranslateCache } from "@/lib/ai/translate";
import { summarizeHostStyle } from "@/lib/ai";
import { layerReasoningEffort } from "@/lib/ai/model-family";

// ---------------------------------------------------------------------------
// KATMAN BAZINDA MODEL / DÜŞÜNME AYARI (10-01, kurucu: "her katmanı ayrı doğrulayalım"). Boşken bugünkü ayar BİREBİR (ortak
// `AI_SEMANTIC_*` → `OPENAI_MODEL` → varsayılan; çeviri / üslupta düşünme alanı GÖNDERİLMEZ). Katman değişkeni yalnız kendi katmanını
// değiştirir.
// ---------------------------------------------------------------------------

const MODEL_ENVS = [...Object.values(SEMANTIC_LAYER_MODEL_ENV), ...Object.values(SEMANTIC_LAYER_EFFORT_ENV), "AI_SEMANTIC_MODEL", "AI_SEMANTIC_REASONING_EFFORT", "OPENAI_MODEL"];

beforeEach(() => {
  for (const k of MODEL_ENVS) vi.stubEnv(k, "");
  __resetUnderstandingCache();
  __resetTranslateCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("anlam katmanları — model / çaba çözümü", () => {
  it("🚨 katman değişkenleri boşken üç katman da bugünkü ortak ayarı kullanır (birebir)", () => {
    vi.stubEnv("AI_SEMANTIC_MODEL", "gpt-5.1");
    vi.stubEnv("AI_SEMANTIC_REASONING_EFFORT", "low");
    for (const l of ["understanding", "guard", "rerank"] as const) {
      expect(semanticModel(l)).toBe(semanticModel());
      expect(semanticModel(l)).toBe("gpt-5.1");
      expect(semanticReasoningEffort(l)).toBe("low");
    }
    vi.stubEnv("AI_SEMANTIC_MODEL", "");
    vi.stubEnv("OPENAI_MODEL", "gpt-6-luna");
    expect(semanticModel("guard")).toBe("gpt-6-luna");
  });

  it("katman değişkeni YALNIZ kendi katmanını değiştirir; tanınmayan çaba gönderilmez", () => {
    vi.stubEnv("AI_SEMANTIC_MODEL", "gpt-5.1");
    vi.stubEnv("AI_UNDERSTANDING_MODEL", "gpt-6-luna");
    vi.stubEnv("AI_UNDERSTANDING_REASONING_EFFORT", "none");
    vi.stubEnv("KB_RERANK_MODEL", "gpt-6-luna");
    expect(semanticModel("understanding")).toBe("gpt-6-luna");
    expect(semanticReasoningEffort("understanding")).toBe("none");
    expect(semanticModel("guard")).toBe("gpt-5.1");
    expect(semanticModel("rerank")).toBe("gpt-6-luna");
    expect(semanticModel()).toBe("gpt-5.1");
    vi.stubEnv("AI_STAY_GUARD_REASONING_EFFORT", "turbo");
    expect(semanticReasoningEffort("guard")).toBeUndefined();
  });

  it("anlama katmanı çağrısı kendi modeliyle gider", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("AI_SEMANTIC_MODEL", "gpt-5.1");
    vi.stubEnv("AI_UNDERSTANDING_MODEL", "gpt-6-luna");
    vi.stubEnv("AI_UNDERSTANDING_REASONING_EFFORT", "none");
    const f = vi.fn(async (_u: string, _i?: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  language: "tr",
                  requests: [{ intent: "wifi", query_tr: "wifi", query_original: "wifi" }],
                  stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    await understandGuestMessages({ guestMessage: "Wi-Fi şifresi nedir?", fetchImpl: f as unknown as typeof fetch });
    const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.model).toBe("gpt-6-luna");
    expect(body.reasoning_effort).toBe("none");
  });
});

describe("çeviri ve üslup — düşünme çabası", () => {
  const captureFetch = (content: string) => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: { body: string }) => {
        bodies.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), { status: 200 });
      }),
    );
    return bodies;
  };

  it("🚨 çeviri: ayar boşken reasoning modelinde de alan GİTMEZ (bugünkü davranış); 'none' reasoning modelinde gider, klasikte gitmez", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    vi.stubEnv("OPENAI_TRANSLATE_MODEL", "gpt-6-luna");
    let bodies = captureFetch("Hello");
    await translate("Merhaba", "en", "tr");
    expect(bodies[0]).not.toHaveProperty("reasoning_effort");
    __resetTranslateCache();
    vi.stubEnv("OPENAI_TRANSLATE_REASONING_EFFORT", "none");
    bodies = captureFetch("Hello");
    await translate("Merhaba", "en", "tr");
    expect(bodies[0].reasoning_effort).toBe("none");
    __resetTranslateCache();
    vi.stubEnv("OPENAI_TRANSLATE_MODEL", "gpt-4.1");
    bodies = captureFetch("Hello");
    await translate("Merhaba", "en", "tr");
    expect(bodies[0]).not.toHaveProperty("reasoning_effort");
  });

  it("üslup özeti: aynı kural (`OPENAI_STYLE_REASONING_EFFORT`)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    vi.stubEnv("OPENAI_STYLE_MODEL", "gpt-6-luna");
    const samples = ["Merhaba!", "Hoş geldiniz.", "İyi günler.", "Tabii ki.", "Görüşmek üzere."];
    let bodies = captureFetch("- Kısa yazar");
    await summarizeHostStyle(samples);
    expect(bodies[0]).not.toHaveProperty("reasoning_effort");
    vi.stubEnv("OPENAI_STYLE_REASONING_EFFORT", "none");
    bodies = captureFetch("- Kısa yazar");
    await summarizeHostStyle(samples);
    expect(bodies[0].reasoning_effort).toBe("none");
  });

  it("kapalı küme: tanınmayan değer gönderilmez", () => {
    expect(layerReasoningEffort("none")).toBe("none");
    expect(layerReasoningEffort(" high ")).toBe("high");
    expect(layerReasoningEffort("turbo")).toBeUndefined();
    expect(layerReasoningEffort(undefined)).toBeUndefined();
  });
});
