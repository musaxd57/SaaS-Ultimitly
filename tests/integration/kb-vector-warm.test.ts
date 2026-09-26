import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { warmPropertyKbVectors, warmAllKbVectorsOnce, __resetBootWarm } from "@/lib/ai/embeddings/kb-warm";
import { __awaitSemanticWarm, __resetSemanticRetrieval, __semanticStoreSize } from "@/lib/ai/embeddings/semantic-retrieval";
import { clearEmbeddingCache, EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings/provider";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";

// ---------------------------------------------------------------------------
// #189 BİLGİ TABANI VEKTÖR ISITMASI — yazma anında ve açılışta. Yayından / yeniden başlatmadan sonra depo boştu ve her
// mülkün İLK misafir mesajı anlamsal aramasız (sözcüksel, "cold") kalıyordu; KB düzenlemesinden sonra da. Isıtma seçicinin
// göreceği metnin AYNISINI gömer (kanal: ham; QR: nötr hitapla doldurulmuş — yalnız yer tutuculu kalemde farklı).
// ---------------------------------------------------------------------------

const embedded: string[] = [];
const vec = (i: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, d) => (d === i % EMBEDDING_DIMENSIONS ? 1 : 0.001));

async function seedKb(propertyId: string, n: number, extra: { title: string; content: string }[] = [], tag = "") {
  for (let i = 0; i < n; i++) {
    await prisma.knowledgeBaseItem.create({
      // Metin içerik anahtarlıdır: iki mülkte AYNI metin tek vektördür (depo paylaşır) — testte ayrışsın diye etiket.
      data: { propertyId, category: "general", title: `Bilgi ${i}`, content: `Dairedeki ${i}. bilgi notu${tag}.`, isActive: true, source: "host_manual", reviewState: "approved" },
    });
  }
  for (const e of extra) {
    await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "general", title: e.title, content: e.content, isActive: true, source: "host_manual", reviewState: "approved" },
    });
  }
}

beforeEach(async () => {
  await resetDb();
  embedded.length = 0;
  __resetSemanticRetrieval();
  __resetKbIndexCache();
  __resetBootWarm();
  clearEmbeddingCache();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
  vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      if (!String(url).includes("/embeddings")) throw new Error(`beklenmeyen ağ çağrısı ${String(url)}`);
      const { input } = JSON.parse(init.body) as { input: string[] };
      embedded.push(...input);
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ data: input.map((_, index) => ({ index, embedding: vec(index) })) }) };
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

describe("warmPropertyKbVectors", () => {
  it("anahtar KAPALIYKEN hiçbir şey yapmaz (ağ yok)", async () => {
    vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "");
    const { propertyId } = await makeOrgWithProperty();
    await seedKb(propertyId, 35);
    expect(await warmPropertyKbVectors(propertyId)).toBe(0);
    await __awaitSemanticWarm();
    expect(embedded).toEqual([]);
  });

  it("🚨 acil durdurma (KB_RETRIEVAL_MODE=legacy) anlamsal anahtar AÇIKKEN de ısıtmayı kapatır (ağ yok)", async () => {
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    const { propertyId } = await makeOrgWithProperty();
    await seedKb(propertyId, 35);
    expect(await warmPropertyKbVectors(propertyId)).toBe(0);
    warmAllKbVectorsOnce();
    await new Promise((r) => setTimeout(r, 300));
    await __awaitSemanticWarm();
    expect(embedded).toEqual([]);
  });

  it("küçük KB (retrieval koşmayacak) ısıtılmaz", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await seedKb(propertyId, 10);
    expect(await warmPropertyKbVectors(propertyId)).toBe(0);
    await __awaitSemanticWarm();
    expect(embedded).toEqual([]);
  });

  it("🚨 büyük KB: tüm parçalar arka planda gömülür; ikinci çağrı yeniden ödemez", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await seedKb(propertyId, 35);
    expect(await warmPropertyKbVectors(propertyId)).toBe(35);
    await __awaitSemanticWarm();
    expect(__semanticStoreSize()).toBe(35);
    expect(embedded.some((t) => t.includes("Dairedeki 7. bilgi notu"))).toBe(true);
    expect(await warmPropertyKbVectors(propertyId)).toBe(0);
  });

  it("yer tutuculu kalem: kanal (HAM) ve QR (nötr hitapla doldurulmuş) biçimlerinin ikisi de ısıtılır", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await seedKb(propertyId, 34, [{ title: "Karşılama", content: "Merhaba {isim}, hoş geldiniz." }]);
    expect(await warmPropertyKbVectors(propertyId)).toBe(36);
    await __awaitSemanticWarm();
    expect(embedded.some((t) => t.includes("Merhaba {isim}"))).toBe(true);
    expect(embedded.some((t) => t.includes("Merhaba misafirimiz"))).toBe(true);
  });
});

describe("warmAllKbVectorsOnce", () => {
  it("süreç başına BİR KEZ: aktif KB'si olan tüm mülkler; ikinci çağrı no-op", { timeout: 30_000 }, async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    await seedKb(a.propertyId, 31, [], " (A)");
    await seedKb(b.propertyId, 32, [], " (B)");
    warmAllKbVectorsOnce();
    await vi.waitFor(
      async () => {
        await __awaitSemanticWarm();
        expect(__semanticStoreSize()).toBe(63);
      },
      { timeout: 15_000, interval: 100 },
    );
    // İkinci çağrı hiçbir şey yapmaz — depo boşaltılsa bile (yoksa her 2 dakikada tüm mülkler yeniden sorgulanır ve depo
    // tahliye edildiyse yeniden ödenir).
    __resetSemanticRetrieval();
    clearEmbeddingCache();
    const before = embedded.length;
    warmAllKbVectorsOnce();
    await new Promise((r) => setTimeout(r, 300));
    await __awaitSemanticWarm();
    expect(embedded.length).toBe(before);
    expect(__semanticStoreSize()).toBe(0);
  });
});
