import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// #186 YENİDEN SIRALAYICI — SICAK YOL TAVANI. Üretim yolu (`prepareRerankScores`) misafirin cevabını bekletir:
// ölçümde p50 0,86 sn / p95 1,32 sn; tavan 2,5 sn, aşılırsa bugünkü sıra. Ölçüm yolu (`llmRerank` doğrudan) anlam
// katmanının normal zaman aşımını kullanır. Ağ kapısı taklit edilir: gerçekten istenen zaman aşımı okunur.
// ---------------------------------------------------------------------------

const calls: { timeoutMs: number; user: string }[] = [];
vi.mock("@/lib/ai/semantic/structured-call", () => ({
  callStructuredJson: vi.fn(async (input: { timeoutMs: number; user: string }) => {
    calls.push({ timeoutMs: input.timeoutMs, user: input.user });
    return { ok: true, data: { answers: ["C2"], related: [] }, ms: 7 };
  }),
}));

import { prepareRerankScores, llmRerank, RERANK_HOT_PATH_DEADLINE_MS } from "@/lib/ai/semantic/rerank";
import { semanticTimeoutMs, semanticModel } from "@/lib/ai/semantic/config";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";

const T0 = Date.UTC(2026, 0, 1);
const items = [
  { id: "a", category: "general", title: "Wi-Fi", content: "Ağ adı Lale-5G.", updatedAt: new Date(T0) },
  { id: "b", category: "general", title: "Otopark", content: "Binanın önünde ücretsiz otopark var.", updatedAt: new Date(T0 - 1000) },
];

beforeEach(() => {
  calls.length = 0;
  __resetKbIndexCache();
  vi.stubEnv("OPENAI_API_KEY", "sk-test-rerank-0000000000000000");
  vi.stubEnv("AI_SEMANTIC_API_KEY", "");
  vi.stubEnv("AI_SEMANTIC_MODEL", "");
  vi.stubEnv("OPENAI_MODEL", "gpt-5.1");
  vi.stubEnv("AI_SEMANTIC_TIMEOUT_MS", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("üretim yolu — sıcak yol tavanı", () => {
  it("tavan 2,5 sn: anlam katmanının zaman aşımı daha uzunsa kısılır", async () => {
    expect(RERANK_HOT_PATH_DEADLINE_MS).toBe(2_500);
    expect(semanticTimeoutMs(semanticModel())).toBeGreaterThan(RERANK_HOT_PATH_DEADLINE_MS);
    const out = await prepareRerankScores({ items, guestMessage: "Otopark var mı?", candidates: [[{ key: "a#0" }, { key: "b#0" }]] });
    expect(out.status).toBe("ok");
    expect(calls.map((c) => c.timeoutMs)).toEqual([RERANK_HOT_PATH_DEADLINE_MS]);
  });

  it("anlam katmanının zaman aşımı tavandan KISAYSA o geçerli (tavan yalnız kısar)", async () => {
    vi.stubEnv("AI_SEMANTIC_TIMEOUT_MS", "1000");
    await prepareRerankScores({ items, guestMessage: "Otopark var mı?", candidates: [[{ key: "a#0" }, { key: "b#0" }]] });
    expect(calls.map((c) => c.timeoutMs)).toEqual([1000]);
  });

  it("puanlar parça anahtarına döner (C2 → ikinci aday)", async () => {
    const out = await prepareRerankScores({ items, guestMessage: "Otopark var mı?", candidates: [[{ key: "a#0" }, { key: "b#0" }]] });
    expect(out.status === "ok" && [...out.scores]).toEqual([["b#0", 3]]);
  });

  it("sıralanacak aday yoksa (tek aday / dizinde olmayan anahtar) ağa ÇIKMAZ", async () => {
    expect((await prepareRerankScores({ items, guestMessage: "Otopark var mı?", candidates: [[{ key: "b#0" }]] })).status).toBe("skipped");
    expect((await prepareRerankScores({ items, guestMessage: "Otopark var mı?", candidates: [[{ key: "zz#0" }, { key: "b#0" }]] })).status).toBe(
      "skipped",
    );
    expect(calls).toEqual([]);
  });
});

describe("ölçüm yolu — `llmRerank` doğrudan", () => {
  it("tavan verilmezse anlam katmanının normal zaman aşımı", async () => {
    await llmRerank("Otopark var mı?", [
      { key: "a#0", title: "Wi-Fi", text: "x" },
      { key: "b#0", title: "Otopark", text: "y" },
    ]);
    expect(calls.map((c) => c.timeoutMs)).toEqual([semanticTimeoutMs(semanticModel())]);
  });
});
