import { describe, it, expect, afterEach, vi } from "vitest";
import { supplyAiConfigured, generateSupplySummary } from "@/lib/supply-ai";
import type { PrepPlan } from "@/lib/supply";

const basePlan: PrepPlan = {
  days: 7,
  start: new Date("2026-07-10T00:00:00Z"),
  end: new Date("2026-07-17T00:00:00Z"),
  totalArrivals: 3,
  linen: [{ key: "carsaf_takimi", label: "Çarşaf takımı", unit: "takım", kind: "linen", need: 6, onHand: 0, toBuy: 6 }],
  consumables: [{ key: "cop_poseti", label: "Çöp poşeti", unit: "adet", kind: "consumable", need: 6, onHand: 0, toBuy: 6 }],
  perProperty: [],
  missingProfile: [],
  hasStock: false,
};

describe("supply-ai", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is disabled without any usable key", () => {
    vi.stubEnv("SUPPLY_AI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(supplyAiConfigured()).toBe(false);
  });

  it("is enabled once a key is set", () => {
    vi.stubEnv("SUPPLY_AI_API_KEY", "sk-test");
    expect(supplyAiConfigured()).toBe(true);
  });

  it("does not call the network when unconfigured", async () => {
    vi.stubEnv("SUPPLY_AI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await generateSupplySummary(basePlan)).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("HTTPS-pin (P2): an insecure base URL is REFUSED with no network call (no key sent)", async () => {
    vi.stubEnv("SUPPLY_AI_API_KEY", "sk-test");
    // Non-localhost http → refused in every environment (secure-url.ts). The key
    // must never ride plaintext, so the fetch is skipped entirely.
    vi.stubEnv("SUPPLY_AI_BASE_URL", "http://api.akashml.com/v1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await generateSupplySummary(basePlan)).toEqual({ ok: false, reason: "insecure_base_url" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call the network for an empty plan even when configured", async () => {
    vi.stubEnv("SUPPLY_AI_API_KEY", "sk-test");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const empty = { ...basePlan, linen: [], consumables: [] };
    expect(await generateSupplySummary(empty)).toEqual({ ok: false, reason: "empty_plan" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("SUPPLY_AI_MODEL bos ise Luna'ya duser (Akash/GLM varsayilani kaldirildi)", async () => {
    vi.stubEnv("SUPPLY_AI_API_KEY", "sk-test");
    vi.stubEnv("SUPPLY_AI_MODEL", "");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await generateSupplySummary(basePlan);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.model).toBe("gpt-5.6-luna");
  });

  it("sends ONLY aggregate numbers (no guest PII) and extracts the reply", async () => {
    vi.stubEnv("SUPPLY_AI_API_KEY", "sk-test");
    vi.stubEnv("SUPPLY_AI_BASE_URL", "https://api.akashml.com/v1");
    vi.stubEnv("SUPPLY_AI_MODEL", "zai-org/GLM-5.2");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "Bu hafta çöp poşeti alman iyi olur." } }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await generateSupplySummary(basePlan);
    expect(out).toEqual({ ok: true, text: "Bu hafta çöp poşeti alman iyi olur." });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.akashml.com/v1/chat/completions");
    const body = String((init as RequestInit).body);
    // Only aggregate numbers/items — never a guest identifier.
    expect(body).toContain("Çöp poşeti");
    expect(body).toContain("giriş");
    expect(body).not.toMatch(/guest|misafir adı|@|\+90/i);
  });

  it("ucuncu taraf (vLLM) endpointinde thinking kapatilir + inline <think> blogu temizlenir", async () => {
    vi.stubEnv("SUPPLY_AI_API_KEY", "sk-test");
    vi.stubEnv("SUPPLY_AI_BASE_URL", "https://api.akashml.com/v1");
    vi.stubEnv("SUPPLY_AI_MODEL", "zai-org/GLM-5.2");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "<think>let me reason in English</think>Çöp poşeti al." }, finish_reason: "stop" }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await generateSupplySummary(basePlan)).toEqual({ ok: true, text: "Çöp poşeti al." });
    // thinking disabled in the request (GLM/Qwen toggle) — yalniz ucuncu tarafta
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("reports finish_reason when a 200 yields no usable text (token exhaustion)", async () => {
    vi.stubEnv("SUPPLY_AI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "length" }] }), { status: 200 }),
      ),
    );
    const out = await generateSupplySummary(basePlan);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("finish=length");
  });

  it("returns a redacted reason on a non-OK upstream response (diagnosable)", async () => {
    vi.stubEnv("SUPPLY_AI_API_KEY", "sk-test");
    vi.stubEnv("SUPPLY_AI_MODEL", "gpt-5.6-yok-boyle");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("model not found", { status: 404 })));
    const out = await generateSupplySummary(basePlan);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toContain("HTTP 404");
      expect(out.reason).toContain("gpt-5.6-yok-boyle");
    }
  });

  // -------------------------------------------------------------------------
  // Model 2026-07-31'de Akash/GLM'den OpenAI Luna'ya cevrildi. Asagidakiler o
  // gecisin uc yapisal tuzagini pinliyor.
  // -------------------------------------------------------------------------

  it("REASONING GOVDESI: gpt-5 ailesine temperature/max_tokens/chat_template_kwargs GONDERILMEZ", async () => {
    // Uculu birden 400 dondururdu; ustelik max_tokens=600 reasoning modelinde
    // gizli dusunme token'lari yuzunden BOS yanit uretirdi.
    vi.stubEnv("SUPPLY_AI_API_KEY", "sk-test");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await generateSupplySummary(basePlan);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("chat_template_kwargs");
    expect(body.max_completion_tokens).toBeGreaterThanOrEqual(1000);
  });

  it("ANAHTAR-SAGLAYICI ESLESMESI: OPENAI_API_KEY yalniz OpenAI endpointinde devreye girer", async () => {
    vi.stubEnv("SUPPLY_AI_API_KEY", ""); // ozel anahtar yok
    vi.stubEnv("OPENAI_API_KEY", "sk-ana-hesap");
    expect(supplyAiConfigured()).toBe(true);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await generateSupplySummary(basePlan);
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-ana-hesap");

    // Ucuncu taraf endpoint: ana hesabin anahtari ORAYA ASLA gitmez.
    vi.stubEnv("SUPPLY_AI_BASE_URL", "https://api.akashml.com/v1");
    const thirdParty = vi.fn();
    vi.stubGlobal("fetch", thirdParty);
    expect(supplyAiConfigured()).toBe(false);
    expect(await generateSupplySummary(basePlan)).toEqual({ ok: false, reason: "not_configured" });
    expect(thirdParty).not.toHaveBeenCalled();
  });

  it("MODEL/ENDPOINT UYUMSUZLUGU aga cikmadan yakalanir (env yarim guncellenirse)", async () => {
    // Endpoint OpenAI'ye cevrildi ama SUPPLY_AI_MODEL eski satici slugunda kaldi:
    // her tiklamada 404 harcamak yerine adi konmus tek bir hata.
    vi.stubEnv("SUPPLY_AI_API_KEY", "sk-test");
    vi.stubEnv("SUPPLY_AI_MODEL", "zai-org/GLM-5.2");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await generateSupplySummary(basePlan);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("model_endpoint_mismatch");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
