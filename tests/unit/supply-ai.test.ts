import { describe, it, expect, afterEach, vi } from "vitest";
import { supplyAiConfigured, generateSupplySummary } from "@/lib/supply-ai";
import type { PrepPlan } from "@/lib/supply";

const basePlan: PrepPlan = {
  days: 7,
  start: new Date("2026-07-10T00:00:00Z"),
  end: new Date("2026-07-17T00:00:00Z"),
  totalArrivals: 3,
  linen: [{ key: "carsaf_takimi", label: "Çarşaf takımı", unit: "takım", kind: "linen", qty: 6 }],
  consumables: [{ key: "cop_poseti", label: "Çöp poşeti", unit: "adet", kind: "consumable", qty: 6 }],
  perProperty: [],
  missingProfile: [],
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
