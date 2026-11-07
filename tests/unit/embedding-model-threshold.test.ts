import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })) }));
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { semanticThresholdFor, SEMANTIC_COSINE_THRESHOLD } from "@/lib/ai/retrieval/semantic";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { __resetSemanticRetrieval, __awaitSemanticWarm } from "@/lib/ai/embeddings/semantic-retrieval";
import { clearEmbeddingCache, embedTexts, embeddingRequestExtras, EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings/provider";
import { neutralPadding } from "../helpers/kb-padding";

// ---------------------------------------------------------------------------
// #189 GÖMME MODELİNE GÖRE EŞİK ve İSTEK GÖVDESİ. Kosinüs dağılımı modele özgüdür: `text-embedding-3-large` (1536'ya
// kısaltılmış) için ölçülen eşik 0,25, diğer modeller bugünkü 0,4. Varsayılan model DEĞİŞMEDİ (env ile açılır).
// Davranışsal: aynı kosinüs (0,30) small ile aday DEĞİL, large ile aday — eşik gerçekten modelden okunuyor.
// ---------------------------------------------------------------------------

const T0 = Date.UTC(2026, 0, 1);
const HEATING = {
  id: "kb_heating",
  category: "general",
  title: "Isıtma",
  content: "Kombi koridordaki dolabın içindedir; termostat salonda, 22 dereceye ayarlıdır.",
  updatedAt: new Date(T0 - 365 * 86_400_000),
};
const PARAPHRASE = "Gece çok üşüdük, evi ılık yapabilir miyiz?";
const QUERY_TEXTS = new Set([PARAPHRASE, "gece cok usuduk", "evi ilik yapabilir miyiz"]);
const items = [...neutralPadding(35, T0), HEATING];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}
/** Isıtma parçası e0; sorgular e0 ile TAM 0,30 kosinüste (kalan kütle kullanılmayan boyutta); diğer parçalar ayrık. */
function vecFor(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  if (text.includes("Kombi koridordaki")) v[0] = 1;
  else if (QUERY_TEXTS.has(text)) {
    v[0] = 0.3;
    v[EMBEDDING_DIMENSIONS - 1] = Math.sqrt(1 - 0.09);
  } else v[100 + (hash(text) % 1400)] = 1;
  return v;
}

const bodies: Record<string, unknown>[] = [];
beforeEach(() => {
  __resetSemanticRetrieval();
  __resetKbIndexCache();
  clearEmbeddingCache();
  bodies.length = 0;
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
  vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { input: string[] } & Record<string, unknown>;
      bodies.push(body);
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ data: body.input.map((t, index) => ({ index, embedding: vecFor(t) })) }) };
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("eşik modele göre", () => {
  it("large 0,25; small ve eski aile bugünkü eşik", () => {
    expect(semanticThresholdFor("text-embedding-3-large")).toBe(0.25);
    expect(semanticThresholdFor("text-embedding-3-small")).toBe(SEMANTIC_COSINE_THRESHOLD);
    expect(semanticThresholdFor("text-embedding-ada-002")).toBe(SEMANTIC_COSINE_THRESHOLD);
    expect(SEMANTIC_COSINE_THRESHOLD).toBe(0.4);
  });

  async function decide(model: string | undefined) {
    if (model) vi.stubEnv("OPENAI_EMBEDDING_MODEL", model);
    const first = await retrieveKbForPrompt({ items, guestMessage: PARAPHRASE });
    expect(first.evidence).toMatchObject({ sem: "cold" });
    await __awaitSemanticWarm();
    return retrieveKbForPrompt({ items, guestMessage: PARAPHRASE });
  }

  it("KONTROL — varsayılan model (small): kosinüs 0,30 eşiğin ALTINDA, cevap kalemi aday değil", async () => {
    const r = await decide(undefined);
    expect(r.evidence).toMatchObject({ sem: "ok" });
    expect(r.items.map((i) => i.id)).not.toContain(HEATING.id);
  });

  it("🚨 large: aynı kosinüs 0,25 eşiğini geçer → cevap kalemi seçilir", async () => {
    const r = await decide("text-embedding-3-large");
    expect(r.evidence).toMatchObject({ sem: "ok" });
    expect(r.items[0].id).toBe(HEATING.id);
  });
});

describe("istek gövdesi", () => {
  it("text-embedding-3 ailesi `dimensions: 1536` taşır (large kısaltılır; small'ın doğal boyutu zaten 1536)", async () => {
    expect(embeddingRequestExtras("text-embedding-3-large")).toEqual({ dimensions: EMBEDDING_DIMENSIONS });
    expect(embeddingRequestExtras("text-embedding-3-small")).toEqual({ dimensions: EMBEDDING_DIMENSIONS });
    vi.stubEnv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-large");
    expect(await embedTexts(["deneme"])).not.toBeNull();
    expect(bodies[0]).toMatchObject({ model: "text-embedding-3-large", dimensions: EMBEDDING_DIMENSIONS });
  });

  it("eski aileye (ada-002) parametre GİTMEZ (sağlayıcı reddeder)", async () => {
    expect(embeddingRequestExtras("text-embedding-ada-002")).toEqual({});
    vi.stubEnv("OPENAI_EMBEDDING_MODEL", "text-embedding-ada-002");
    expect(await embedTexts(["deneme"])).not.toBeNull();
    expect(bodies[0]).not.toHaveProperty("dimensions");
  });
});
