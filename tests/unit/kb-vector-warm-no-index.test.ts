import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { warmKbVectors, __awaitSemanticWarm, __resetSemanticRetrieval, SEMANTIC_MAX_CHUNKS } from "@/lib/ai/embeddings/semantic-retrieval";
import { buildKbIndex, getOrBuildKbIndex, __resetKbIndexCache, __kbIndexCacheSize, INDEX_CACHE_MAX_ENTRIES } from "@/lib/ai/retrieval/index-cache";
import { embeddingTextFor } from "@/lib/ai/embeddings/context-text";
import { chunkItems } from "@/lib/ai/retrieval/chunker";
import { clearEmbeddingCache, EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings/provider";

// ---------------------------------------------------------------------------
// A7 #2 (inceleme ajanı 09-27): vektör ISITMASI yalnız parça metnini gömer, ama parçaları almak için TAM sözcüksel dizini
// (BM25 + n-gram + parça başına saat alanı okuması) kuruyordu. Ölçüldü (60 kalem × 20k): dizin 5,9 sn — 5 sn'si saat alanı
// okuması; yalnız parçalama 4,5 ms. Isıtma olay döngüsünde koştuğu için bu süre boyunca her kiracının isteği bekliyordu; üstelik
// kurulan dizin paylaşılan önbelleğe (64 girdi) yazılıp o an kullanılan başka bir kiracının dizinini tahliye edebiliyordu.
// Düzeltme: ısıtma yalnız parçalar (`chunkItems`) — kuyruğa giden metinler dizinin parçalarıyla BİREBİR aynı.
// ---------------------------------------------------------------------------

const embedded: string[] = [];
const vec = (i: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, d) => (d === i % EMBEDDING_DIMENSIONS ? 1 : 0.001));

const SENT = [
  "Giriş saati 15:00'ten itibarendir, anahtar kutusu kapının solundadır.",
  "Check-out is at 11:00; please leave the keys on the kitchen table.",
  "Otopark binanın arkasında, B2 katındadır ve ücretsizdir.",
  "Sessiz saatler 22:00 ile 08:00 arasıdır; lütfen komşulara saygı gösterin.",
  "The nearest pharmacy is 300 m away and open until 21:00 on weekdays.",
  "Havuz 09:00–19:00 arası açıktır, cankurtaran yoktur.",
];

function kb(n: number, chars: number, tag = "") {
  return Array.from({ length: n }, (_, i) => {
    let t = "";
    let k = i;
    while (t.length < chars) t += `${SENT[k++ % SENT.length]} `;
    return {
      id: `kb${tag}${i}`,
      category: i % 3 === 0 ? "checkin" : "general",
      title: `Bilgi ${tag}${i}`,
      content: `${t.slice(0, chars)} (${tag}${i})`,
      updatedAt: new Date(Date.UTC(2026, 8, 1)),
      supersededById: null as string | null,
    };
  });
}

beforeEach(() => {
  embedded.length = 0;
  __resetSemanticRetrieval();
  __resetKbIndexCache();
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

describe("vektör ısıtması sözcüksel dizini KURMAZ (A7 #2)", () => {
  it("🚨 ısıtma dizin önbelleğine yazmaz", async () => {
    const items = kb(35, 300);
    expect(warmKbVectors(items)).toBeGreaterThan(0);
    expect(__kbIndexCacheSize()).toBe(0);
    await __awaitSemanticWarm();
  });

  it("🚨 başka kiracının kullanımdaki dizinini tahliye etmez (önbellek tavanı kadar ısıtmadan sonra da aynı nesne)", async () => {
    const other = kb(31, 200, "o");
    const otherIndex = getOrBuildKbIndex(other);
    for (let t = 0; t < INDEX_CACHE_MAX_ENTRIES; t++) warmKbVectors(kb(31, 120, `t${t}_`));
    expect(getOrBuildKbIndex(other)).toBe(otherIndex);
    await __awaitSemanticWarm();
  });

  it("kuyruğa giden metinler dizinin parçalarıyla BİREBİR aynı (sürüm kuralı dahil: halefi kümede olan kalem gömülmez)", async () => {
    const items = kb(40, 1500);
    items[5].supersededById = items[6].id;
    const queued = warmKbVectors(items);
    await __awaitSemanticWarm();
    const kept = items.filter((_, i) => i !== 5);
    const expected = [...new Set(buildKbIndex(kept).chunks.map((c) => embeddingTextFor(c)))].sort();
    expect(queued).toBe(expected.length);
    expect([...new Set(embedded)].sort()).toEqual(expected);
    expect(embedded.some((t) => t.includes("(5)"))).toBe(false);
  });

  it("🚨 büyük bilgi tabanında ısıtma hızlı (60 × 8.000 karakter: eskiden ~2,3 sn senkron CPU)", async () => {
    const items = kb(60, 8000);
    const t0 = performance.now();
    const queued = warmKbVectors(items);
    const ms = performance.now() - t0;
    expect(queued).toBeGreaterThan(0);
    expect(ms).toBeLessThan(400);
    await __awaitSemanticWarm();
  });

  it("parça tavanını aşan bilgi tabanı yine ısıtılmaz (davranış aynı) ve bunu anlamak da hızlı (60 × 20.000: eskiden ~5,9 sn)", async () => {
    const items = kb(60, 20000);
    const t0 = performance.now();
    expect(warmKbVectors(items)).toBe(0);
    expect(performance.now() - t0).toBeLessThan(400);
    expect(chunkItems(items).length).toBeGreaterThan(SEMANTIC_MAX_CHUNKS); // gerçekten tavan dalı
    await __awaitSemanticWarm();
    expect(embedded).toEqual([]);
  });
});
