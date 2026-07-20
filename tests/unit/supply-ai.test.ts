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

  it("is disabled without an API key", () => {
    vi.stubEnv("SUPPLY_AI_API_KEY", "");
    expect(supplyAiConfigured()).toBe(false);
  });

  it("is enabled once a key is set", () => {
    vi.stubEnv("SUPPLY_AI_API_KEY", "sk-test");
    expect(supplyAiConfigured()).toBe(true);
  });

  it("does not call the network when unconfigured", async () => {
    vi.stubEnv("SUPPLY_AI_API_KEY", "");
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

  it("defaults to akashML's GLM-5.2 slug when SUPPLY_AI_MODEL is unset", async () => {
    vi.stubEnv("SUPPLY_AI_API_KEY", "sk-test");
    vi.stubEnv("SUPPLY_AI_MODEL", "");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await generateSupplySummary(basePlan);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.model).toBe("zai-org/GLM-5.2");
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

  it("disables thinking and strips any inline <think> block from content", async () => {
    vi.stubEnv("SUPPLY_AI_API_KEY", "sk-test");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "<think>let me reason in English</think>Çöp poşeti al." }, finish_reason: "stop" }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await generateSupplySummary(basePlan)).toEqual({ ok: true, text: "Çöp poşeti al." });
    // thinking disabled in the request (GLM/Qwen toggle)
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
    vi.stubEnv("SUPPLY_AI_MODEL", "zai-org/GLM-5.2");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("model not found", { status: 404 })));
    const out = await generateSupplySummary(basePlan);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toContain("HTTP 404");
      expect(out.reason).toContain("zai-org/GLM-5.2");
    }
  });
});
