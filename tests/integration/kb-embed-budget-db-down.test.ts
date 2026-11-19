import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { reportError } from "@/lib/report-error";
import { warmPropertyKbVectors } from "@/lib/ai/embeddings/kb-warm";
import { __awaitSemanticWarm, __exhaustWarmBudgetForTests, __resetSemanticRetrieval } from "@/lib/ai/embeddings/semantic-retrieval";
import { clearEmbeddingCache, EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings/provider";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";

// ---------------------------------------------------------------------------
// EMB tur 2 — D1 FAIL-SOFT (AYRI DOSYA: Prisma temsilcisine kurulan casus sonraki testlere sızar). Kovalar açıkken bütçe işleminde DB
// arızası olursa ısıtma bugünkü süreç içi sayaca düşer: ısıtma durmaz, sayaç tablosuna satır yazılmaz; süreç içi sayaç doluysa reddeder.
// ---------------------------------------------------------------------------

const embedded: string[] = [];

async function seed(propertyId: string, n: number) {
  for (let i = 0; i < n; i++) {
    await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "general", title: `Bilgi ${i}`, content: `Dairedeki ${i}. bilgi notu.`, isActive: true, source: "host_manual", reviewState: "approved" },
    });
  }
}

beforeEach(async () => {
  await resetDb();
  __resetSemanticRetrieval();
  __resetKbIndexCache();
  clearEmbeddingCache();
  embedded.length = 0;
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
  vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
  vi.stubEnv("KB_VECTOR_STORE_ENABLED", "");
  vi.stubEnv("KB_EMBED_ORG_BUDGET_ENABLED", "1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const { input } = JSON.parse(init.body) as { input: string[] };
      embedded.push(...input);
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ data: input.map((_, index) => ({ index, embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, (_, d) => (d === index ? 1 : 0.001)) })) }),
      };
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("D1 kova okumasında DB arızası", () => {
  it("bütçe işlemi düşerse ısıtma süreç içi sayaçla sürer (gömülür), sayaç tablosuna satır yazılmaz, arıza bildirilir", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await seed(propertyId, 35);
    vi.mocked(reportError).mockClear();
    // Yalnız casus geri alınır (`restoreAllMocks` rapor taklidinin çağrı kaydını da silerdi).
    const tx = vi.spyOn(prisma, "$transaction").mockRejectedValue(new Error("db down"));
    await warmPropertyKbVectors(propertyId);
    await __awaitSemanticWarm();
    tx.mockRestore();
    expect(embedded.filter((t) => t.startsWith("general")).length).toBe(35);
    expect(vi.mocked(reportError)).toHaveBeenCalledWith("kb-embed-budget", expect.any(Error));
    expect(await prisma.rateLimitCounter.count()).toBe(0);
  });

  it("yedek süreç içi sayaç doluysa yedek de reddeder (yedek sınırsız değildir)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await seed(propertyId, 35);
    const tx = vi.spyOn(prisma, "$transaction").mockRejectedValue(new Error("db down"));
    __exhaustWarmBudgetForTests();
    await warmPropertyKbVectors(propertyId);
    await __awaitSemanticWarm();
    const dbAttempts = tx.mock.calls.length;
    tx.mockRestore();
    expect(dbAttempts).toBeGreaterThan(0); // kova denendi, düştü, yedeğe geçildi
    expect(embedded).toEqual([]);
  });
});
