import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { warmPropertyKbVectors, warmAllKbVectorsOnce, __resetBootWarm } from "@/lib/ai/embeddings/kb-warm";
import {
  __awaitSemanticWarm,
  __exhaustWarmBudgetForTests,
  __resetSemanticRetrieval,
  __semanticStoreSize,
  __setChunkVectorCacheMaxForTests,
  prepareSemanticScores,
} from "@/lib/ai/embeddings/semantic-retrieval";
import { clearEmbeddingCache, EMBEDDING_DIMENSIONS, embeddingModel } from "@/lib/ai/embeddings/provider";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { __setVectorStoreReadForTests, decodeVector, encodeVector, inputHashOf, persistChunkVectors } from "@/lib/ai/embeddings/vector-store";
import { afterKbItemsChanged } from "@/lib/kb/after-change";

// ---------------------------------------------------------------------------
// KALICI GÖMME DEPOSU (migration 87 `KbChunkVector`, anahtar `KB_VECTOR_STORE_ENABLED`; kurucu 10-23 / 10-28). Yeniden başlatmadan sonra
// bilgi tabanı vektörleri bellekte yoktu → o dairenin ilk misafir sorusu anlamsal aramasız ("cold") kalıyor, her şey yeniden ödeniyordu.
// Sözleşme (`vector-store.ts` başlığı): anahtar kapalıyken veritabanına dokunulmaz · metin saklanmaz · okuma kalem kimliğiyle (kiracı
// yalıtımı) ve zaman sınırlı · bozuk satır silinir, YARIM HARİTA YOK · sorgu vektörü yazılmaz · değişen / silinen kalemin satırı gider.
// ---------------------------------------------------------------------------

const embedded: string[] = [];
const vec = (i: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, d) => (d === i % EMBEDDING_DIMENSIONS ? 1 : 0.001));

async function seedKb(propertyId: string, n: number, tag = "") {
  for (let i = 0; i < n; i++) {
    await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "general", title: `Bilgi ${i}`, content: `Dairedeki ${i}. bilgi notu${tag}.`, isActive: true, source: "host_manual", reviewState: "approved" },
    });
  }
}

const kbOf = async (propertyId: string) => (await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true })).items;
const prepare = async (propertyId: string, guestMessage = "Dairedeki 3. bilgi notu nedir?") =>
  prepareSemanticScores({ items: await kbOf(propertyId), guestMessage });
// Gömülen PARÇA metinleri `kategori · başlık` önekiyle başlar (`embeddingTextFor`); sorgu metinleri başlamaz.
const chunkTextsEmbedded = () => embedded.filter((t) => t.startsWith("general"));

/** "Yeniden başlatma": süreç belleği (vektör deposu + gömme önbelleği + dizin) sıfır; veritabanı yerinde. */
function restart() {
  __resetSemanticRetrieval();
  __resetKbIndexCache();
  __resetBootWarm();
  clearEmbeddingCache();
  embedded.length = 0;
}

beforeEach(async () => {
  await resetDb();
  restart();
  __setVectorStoreReadForTests(null);
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
  vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
  vi.stubEnv("KB_VECTOR_STORE_ENABLED", "1");
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
  __setVectorStoreReadForTests(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("kalıcı gömme deposu — anahtar", () => {
  it("🚨 anahtar KAPALIYKEN veritabanına dokunmaz: ısıtma satır yazmaz, yeniden başlatmadan sonra depodaki satır okunmaz (karar cold)", async () => {
    vi.stubEnv("KB_VECTOR_STORE_ENABLED", "");
    const { propertyId } = await makeOrgWithProperty();
    await seedKb(propertyId, 35);
    await warmPropertyKbVectors(propertyId);
    await __awaitSemanticWarm();
    expect(await prisma.kbChunkVector.count()).toBe(0);
    // Depoyu doldur (anahtar açıkken, temiz bellekle): sonra anahtar kapalıyken bu satırlar okunmamalı.
    vi.stubEnv("KB_VECTOR_STORE_ENABLED", "1");
    restart();
    await warmPropertyKbVectors(propertyId);
    await __awaitSemanticWarm();
    expect(await prisma.kbChunkVector.count()).toBeGreaterThan(0);
    vi.stubEnv("KB_VECTOR_STORE_ENABLED", "");
    restart();
    expect((await prepare(propertyId)).status).toBe("cold");
  });

  it("anahtar yalnız tam \"1\" ile açılır (\"true\" kapalı sayılır)", async () => {
    vi.stubEnv("KB_VECTOR_STORE_ENABLED", "true");
    const { propertyId } = await makeOrgWithProperty();
    await seedKb(propertyId, 35);
    await warmPropertyKbVectors(propertyId);
    await __awaitSemanticWarm();
    expect(await prisma.kbChunkVector.count()).toBe(0);
  });
});

describe("kalıcı gömme deposu — yazma / okuma", () => {
  it("🚨 ısıtma depoya yazar; YENİDEN BAŞLATMADAN sonra ilk karar 'ok' ve hiçbir parça yeniden gömülmez; vektör bit bit aynı", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await seedKb(propertyId, 35);
    await warmPropertyKbVectors(propertyId);
    await __awaitSemanticWarm();
    const firstEmbedded = chunkTextsEmbedded().length;
    expect(firstEmbedded).toBeGreaterThan(30);
    expect(await prisma.kbChunkVector.count()).toBe(firstEmbedded);
    const fromMemory = await prepare(propertyId); // bellekten (yeniden başlatma öncesi)
    expect(fromMemory.status).toBe("ok");

    restart();
    const fromStore = await prepare(propertyId);
    expect(fromStore.status).toBe("ok");
    expect(chunkTextsEmbedded()).toEqual([]); // yalnız sorgu gömüldü
    expect(embedded.length).toBeGreaterThan(0);
    // Bit bit aynı: depodan okunan vektörlerle seçiciye giden puanlar bellekteki vektörlerle birebir aynı.
    expect(fromStore.bySubquery).toEqual(fromMemory.bySubquery);

    const rows = await prisma.kbChunkVector.findMany({ select: { kind: true, recipe: true, dims: true, vector: true, model: true, ord: true } });
    for (const r of rows) {
      expect([r.kind, r.recipe, r.dims, r.model, r.ord]).toEqual(["chunk", "c1", EMBEDDING_DIMENSIONS, embeddingModel(), 0]);
      expect(decodeVector(r)).not.toBeNull();
    }
  });

  it("🚨 açılış ısıtması (yeniden başlatma sonrası) depoyu okur, parçaları YENİDEN ÖDEMEZ", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await seedKb(propertyId, 35);
    await warmPropertyKbVectors(propertyId);
    await __awaitSemanticWarm();
    const rowsBefore = await prisma.kbChunkVector.count();
    restart();
    await warmPropertyKbVectors(propertyId);
    await __awaitSemanticWarm();
    expect(chunkTextsEmbedded()).toEqual([]);
    expect(await prisma.kbChunkVector.count()).toBe(rowsBefore);
    expect((await prepare(propertyId)).status).toBe("ok");
  });

  it("🚨 sorgu vektörü tabloya YAZILMAZ (yalnız ısıtılan parçalar)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await seedKb(propertyId, 35);
    await warmPropertyKbVectors(propertyId);
    await __awaitSemanticWarm();
    const before = await prisma.kbChunkVector.findMany({ select: { inputHash: true } });
    await prepare(propertyId, "Kombi nasıl açılır, sıcak su yok mu?");
    await __awaitSemanticWarm();
    const after = await prisma.kbChunkVector.findMany({ select: { inputHash: true } });
    expect(after.length).toBe(before.length);
    expect(after.some((r) => r.inputHash === inputHashOf("Kombi nasıl açılır, sıcak su yok mu?"))).toBe(false);
  });

  it("🚨 başka işletmenin satırı OKUNMAZ: aynı metin B'de ısıtılmış olsa da A'nın kalemleri için depo boştur → A cold", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    await seedKb(a.propertyId, 35);
    await seedKb(b.propertyId, 35); // birebir aynı metinler
    await warmPropertyKbVectors(b.propertyId);
    await __awaitSemanticWarm();
    const aItems = await prisma.knowledgeBaseItem.findMany({ where: { propertyId: a.propertyId }, select: { id: true } });
    expect(await prisma.kbChunkVector.count({ where: { kbItemId: { in: aItems.map((i) => i.id) } } })).toBe(0);
    restart();
    expect((await prepare(a.propertyId)).status).toBe("cold");
  });
});

describe("kalıcı gömme deposu — bozuk satır, zaman aşımı", () => {
  it("🚨 bozuk satır (bayt uzunluğu yanlış) eksik sayılır ve silinir; YARIM HARİTA YOK → cold", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await seedKb(propertyId, 35);
    await warmPropertyKbVectors(propertyId);
    await __awaitSemanticWarm();
    const victim = await prisma.kbChunkVector.findFirst({ select: { id: true } });
    await prisma.kbChunkVector.update({ where: { id: victim!.id }, data: { vector: Buffer.alloc(10) } });
    // Arka plan ısıtması bu testte gömmesin (yalnız depo davranışı sınanır): sağlayıcı arızalı.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, headers: new Headers(), json: async () => ({}) })));
    restart();
    expect((await prepare(propertyId)).status).toBe("cold");
    for (let i = 0; i < 50 && (await prisma.kbChunkVector.count({ where: { id: victim!.id } })) > 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(await prisma.kbChunkVector.count({ where: { id: victim!.id } })).toBe(0);
  });

  it("🚨 depo okuması zaman sınırını aşarsa karar beklemez: cold (misafir 250 ms'den fazla beklemez)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await seedKb(propertyId, 35);
    await warmPropertyKbVectors(propertyId);
    await __awaitSemanticWarm();
    restart();
    __setVectorStoreReadForTests(() => new Promise((r) => setTimeout(() => r([]), 2_000)));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, headers: new Headers(), json: async () => ({}) })));
    const t0 = Date.now();
    const prep = await prepare(propertyId);
    expect(prep.status).toBe("cold");
    expect(Date.now() - t0).toBeLessThan(1_500);
  });

  it("izinli boyut türe göre: 512 boyutlu cümle satırı geçerli, bilinmeyen boyut / NaN / başka tarif bozuk", () => {
    const v512 = encodeVector(Array.from({ length: 512 }, () => 0.5));
    expect(decodeVector({ kind: "sentence", recipe: "c1", dims: 512, vector: v512 })).not.toBeNull();
    expect(decodeVector({ kind: "chunk", recipe: "c1", dims: 512, vector: v512 })).toBeNull();
    expect(decodeVector({ kind: "sentence", recipe: "c2", dims: 512, vector: v512 })).toBeNull();
    const nan = encodeVector([0.1, Number.NaN, 0.3].concat(Array.from({ length: 509 }, () => 0)));
    expect(decodeVector({ kind: "sentence", recipe: "c1", dims: 512, vector: nan })).toBeNull();
    expect(decodeVector({ kind: "mystery", recipe: "c1", dims: 512, vector: v512 })).toBeNull();
  });
});

describe("kalıcı gömme deposu — temizlik", () => {
  it("🚨 kalem / daire silinince satırları gider (cascade)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await seedKb(propertyId, 35);
    await warmPropertyKbVectors(propertyId);
    await __awaitSemanticWarm();
    const item = await prisma.knowledgeBaseItem.findFirst({ where: { propertyId }, select: { id: true } });
    expect(await prisma.kbChunkVector.count({ where: { kbItemId: item!.id } })).toBeGreaterThan(0);
    await prisma.knowledgeBaseItem.delete({ where: { id: item!.id } });
    expect(await prisma.kbChunkVector.count({ where: { kbItemId: item!.id } })).toBe(0);
    await prisma.property.delete({ where: { id: propertyId } });
    expect(await prisma.kbChunkVector.count()).toBe(0);
  });

  it("🚨 kalem değişince (yazma kancası) eski metnin satırı silinir, yeni metin ısıtılıp yazılır", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await seedKb(propertyId, 35);
    await warmPropertyKbVectors(propertyId);
    await __awaitSemanticWarm();
    const item = await prisma.knowledgeBaseItem.findFirst({ where: { propertyId, title: "Bilgi 3" }, select: { id: true } });
    const oldRows = await prisma.kbChunkVector.findMany({ where: { kbItemId: item!.id }, select: { inputHash: true } });
    expect(oldRows.length).toBe(1);
    await prisma.knowledgeBaseItem.update({ where: { id: item!.id }, data: { content: "Dairedeki 3. bilgi notu artık farklı." } });
    await afterKbItemsChanged({ organizationId: orgId, propertyIds: [propertyId] });
    // Kancanın ısıtması beklenmeden başlar (önce bilgi tabanını okur); testte aynı ısıtmayı bekleyerek çağır.
    await warmPropertyKbVectors(propertyId);
    await __awaitSemanticWarm();
    const newRows = await prisma.kbChunkVector.findMany({ where: { kbItemId: item!.id }, select: { inputHash: true } });
    expect(newRows.map((r) => r.inputHash)).not.toContain(oldRows[0].inputHash);
    expect(newRows.length).toBe(1);
    // Yalnız değişen kalem gömüldü; öteki 34 kalemin satırı yerinde.
    const after = chunkTextsEmbedded();
    expect(after.filter((t) => t.includes("artık farklı")).length).toBe(1);
    expect(await prisma.kbChunkVector.count()).toBe(35);
  });

  it("açılışta başka modelin satırları silinir", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await seedKb(propertyId, 35);
    const item = await prisma.knowledgeBaseItem.findFirst({ where: { propertyId }, select: { id: true } });
    const full = await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: item!.id }, select: { updatedAt: true } });
    const zero = encodeVector(Array.from({ length: 1536 }, () => 0));
    await prisma.kbChunkVector.createMany({
      data: [
        { kbItemId: item!.id, model: "eski-model", inputHash: "x", dims: 1536, vector: zero, itemUpdatedAt: full.updatedAt },
        { kbItemId: item!.id, model: embeddingModel(), recipe: "c0", inputHash: "y", dims: 1536, vector: zero, itemUpdatedAt: full.updatedAt },
        // Kancanın göremediği eski sürüm satırı (ör. süreç düzenleme sırasında öldü): açılışta gider.
        { kbItemId: item!.id, model: embeddingModel(), inputHash: "z", dims: 1536, vector: zero, itemUpdatedAt: new Date(full.updatedAt.getTime() - 60_000) },
        // Bugünkü sürümün satırı: KALIR.
        { kbItemId: item!.id, model: embeddingModel(), inputHash: "w", dims: 1536, vector: zero, itemUpdatedAt: full.updatedAt },
      ],
    });
    warmAllKbVectorsOnce();
    const gone = async () => prisma.kbChunkVector.count({ where: { inputHash: { in: ["x", "y", "z"] } } });
    for (let i = 0; i < 100 && (await gone()) > 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(await gone()).toBe(0);
    expect(await prisma.kbChunkVector.count({ where: { inputHash: "w" } })).toBe(1);
    await __awaitSemanticWarm();
  });

  it("🚨 düzenlemeden ÖNCE başlamış ısıtma eski metnin satırını YAZAMAZ (kalem sürümü tutmazsa yazma yok); silinmiş kalem sessizce atlanır", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await seedKb(propertyId, 2);
    const [a, b] = await prisma.knowledgeBaseItem.findMany({ where: { propertyId }, orderBy: { title: "asc" } });
    const v = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.01);
    // Isıtma A'yı eski sürümüyle görmüştü; yazmadan önce A düzenlendi.
    await prisma.knowledgeBaseItem.update({ where: { id: a.id }, data: { content: "Yeni Wi-Fi şifresi başka." } });
    await prisma.knowledgeBaseItem.delete({ where: { id: b.id } });
    const written = await persistChunkVectors(embeddingModel(), [
      { owners: [{ kbItemId: a.id, updatedAt: a.updatedAt }], text: "eski metin", vector: v },
      { owners: [{ kbItemId: b.id, updatedAt: b.updatedAt }], text: "silinen kalem", vector: v },
    ]);
    expect(written.size).toBe(0);
    expect(await prisma.kbChunkVector.count()).toBe(0);
    // KONTROL: bugünkü sürümle yazılır.
    const fresh = await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: a.id } });
    expect((await persistChunkVectors(embeddingModel(), [{ owners: [{ kbItemId: a.id, updatedAt: fresh.updatedAt }], text: "yeni metin", vector: v }])).size).toBe(1);
    expect(await prisma.kbChunkVector.count()).toBe(1);
  });
});

describe("kalıcı gömme deposu — Haiku 10-28 bulguları", () => {
  it("🚨 aynı metin iki dairede (kopyalanmış bilgi tabanı): bellekteki vektör ikinci dairenin kalemlerine de satır yazdırır → yeniden başlatmada ikinci daire de 'ok', yeniden ödeme yok", async () => {
    const p1 = await makeOrgWithProperty();
    const p2 = await makeOrgWithProperty();
    await seedKb(p1.propertyId, 35);
    await seedKb(p2.propertyId, 35); // birebir aynı metinler
    await warmPropertyKbVectors(p1.propertyId);
    await __awaitSemanticWarm();
    embedded.length = 0;
    await warmPropertyKbVectors(p2.propertyId); // metinler bellekte → gömme YOK, ama p2'nin kendi satırları yazılmalı
    await __awaitSemanticWarm();
    expect(chunkTextsEmbedded()).toEqual([]);
    const p2Items = await prisma.knowledgeBaseItem.findMany({ where: { propertyId: p2.propertyId }, select: { id: true } });
    expect(await prisma.kbChunkVector.count({ where: { kbItemId: { in: p2Items.map((i) => i.id) } } })).toBe(35);
    restart();
    expect((await prepare(p2.propertyId)).status).toBe("ok");
    expect(chunkTextsEmbedded()).toEqual([]);
  });

  it("🚨 saatlik ısıtma bütçesi doluyken de depodan okuma yapılır (bedava): yeniden başlatma sonrası ısıtma belleği depodan doldurur", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await seedKb(propertyId, 35);
    await warmPropertyKbVectors(propertyId);
    await __awaitSemanticWarm();
    restart();
    __exhaustWarmBudgetForTests();
    await warmPropertyKbVectors(propertyId);
    await __awaitSemanticWarm();
    expect(__semanticStoreSize()).toBe(35);
    expect(chunkTextsEmbedded()).toEqual([]);
  });

  it("🚨 bellek deposu küçük / doluyken (tahliye) depodan okunan vektörler o kararda kullanılır → 'ok' (sürekli cold + her mesajda okuma yok)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await seedKb(propertyId, 35);
    await warmPropertyKbVectors(propertyId);
    await __awaitSemanticWarm();
    restart();
    __setChunkVectorCacheMaxForTests(10);
    expect((await prepare(propertyId)).status).toBe("ok");
    expect(chunkTextsEmbedded()).toEqual([]);
  });
});
