import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { warmPropertyKbVectors, __resetBootWarm } from "@/lib/ai/embeddings/kb-warm";
import { __awaitSemanticWarm, __resetSemanticRetrieval, prepareSemanticScores } from "@/lib/ai/embeddings/semantic-retrieval";
import { clearEmbeddingCache, EMBEDDING_DIMENSIONS, embeddingModel } from "@/lib/ai/embeddings/provider";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { afterKbItemsChanged } from "@/lib/kb/after-change";
import * as vectorStore from "@/lib/ai/embeddings/vector-store";
const { __setVectorStoreReadForTests, persistChunkVectors } = vectorStore;

// ---------------------------------------------------------------------------
// KALICI VEKTÖR DEPOSU — "ÖNCE SINIRLI PİLOT" (kurucu 11-20 sabah, E-4: "Kalıcı depo, şema ve güncellik testleri geçince önce sınırlı bir
// pilotta açılsın"). `KB_VECTOR_STORE_ENABLED=1` ana anahtar + işletme listesi `KB_VECTOR_STORE_ORG_IDS` (virgüllü kimlikler ya da `*`;
// `DURABLE_OUTBOX_ORG_IDS` deseni). Liste yoksa / boşsa KİMSE (listeyi silmek depoyu herkese açmasın — güvenli yön bugünkü bellek yolu).
// Listede olmayan işletme bugünkü gibi yalnız bellek kullanır: depo OKUNMAZ, YAZILMAZ, temizlik sorgusu da çalışmaz. Depo satırında işletme
// yoktur; işletme KALEMDEN bulunur (kalem → daire → işletme) ve yazma sınırında da ayrıca denetlenir.
// ---------------------------------------------------------------------------

const embedded: string[] = [];
const chunkTexts = () => embedded.filter((t) => t.startsWith("general"));
const vec = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, d) => (d === h % EMBEDDING_DIMENSIONS ? 1 : 0.001));
};

/** Her işletmeye AYRI metin (`tag`): bellek deposu içerik adreslidir — aynı metin başka işletmenin vektörünü bellekte bulurdu (bilinçli). */
async function seed(propertyId: string, n = 35, tag = "A") {
  for (let i = 0; i < n; i++) {
    await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "general", title: `Bilgi ${tag}${i}`, content: `Dairedeki ${i}. bilgi notu (${tag}).`, isActive: true, source: "host_manual", reviewState: "approved" },
    });
  }
}

const kbOf = async (propertyId: string) => (await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true })).items;
const prepare = async (propertyId: string) => prepareSemanticScores({ items: await kbOf(propertyId), guestMessage: "Dairedeki 3. bilgi notu nedir?" });
const rowsOfProperty = (propertyId: string) => prisma.kbChunkVector.count({ where: { kbItem: { propertyId } } });

async function warm(propertyId: string) {
  await warmPropertyKbVectors(propertyId);
  await __awaitSemanticWarm();
}

function restart() {
  __resetSemanticRetrieval();
  __resetKbIndexCache();
  __resetBootWarm();
  (vectorStore as { __resetVectorStoreOwnerCache?: () => void }).__resetVectorStoreOwnerCache?.();
  clearEmbeddingCache();
  embedded.length = 0;
}

/** Depo okuması sayacı (sorgunun yerine geçmez: gerçek okumaya devreder). */
let reads: string[][] = [];

beforeEach(async () => {
  await resetDb();
  restart();
  reads = [];
  __setVectorStoreReadForTests(null);
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
  vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
  vi.stubEnv("KB_VECTOR_STORE_ENABLED", "1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const { input } = JSON.parse(init.body) as { input: string[] };
      embedded.push(...input);
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ data: input.map((t, index) => ({ index, embedding: vec(t) })) }) };
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

/** Yeniden başlatmadan sonra depo okumalarını kaydeder (kalem kimlikleri) — okuma yine yapılır (gerçek sorguyu atlamak için boş döner). */
function countReads() {
  __setVectorStoreReadForTests(async (args) => {
    reads.push(args.kbItemIds);
    return [];
  });
}

describe("kalıcı depo pilot listesi", () => {
  it("🚨 listede A var, B yok → A'nın satırları yazılır ve yeniden başlatmada okunur ('ok'); B'nin HİÇ satırı yazılmaz, okunmaz (bellek: 'cold')", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    vi.stubEnv("KB_VECTOR_STORE_ORG_IDS", a.orgId);
    await seed(a.propertyId);
    await seed(b.propertyId, 35, "B");
    await warm(a.propertyId);
    await warm(b.propertyId);
    expect(await rowsOfProperty(a.propertyId)).toBe(35);
    expect(await rowsOfProperty(b.propertyId)).toBe(0);

    restart();
    expect((await prepare(a.propertyId)).status).toBe("ok"); // depodan
    expect(chunkTexts()).toEqual([]);
    countReads();
    const bItems = new Set((await kbOf(b.propertyId)).map((i) => i.id));
    expect((await prepare(b.propertyId)).status).toBe("cold"); // bugünkü bellek yolu
    expect(reads.filter((ids) => ids.some((id) => bItems.has(id)))).toEqual([]);
    await __awaitSemanticWarm(); // soğuk dalın bellek ısıtması: B yine satır yazmaz, okumaz
    expect(reads.filter((ids) => ids.some((id) => bItems.has(id)))).toEqual([]);
    __setVectorStoreReadForTests(null);
    expect(await rowsOfProperty(b.propertyId)).toBe(0);
    expect((await prepare(b.propertyId)).status).toBe("ok"); // bellek ısındı
  });

  it("🚨 yazma sınırında da işletme kalemden bulunur: B'nin kalemi için doğrudan yazma denemesi satır YAZMAZ; A'nınki yazar", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    vi.stubEnv("KB_VECTOR_STORE_ORG_IDS", ` ${a.orgId} , `);
    await seed(a.propertyId, 1);
    await seed(b.propertyId, 1, "B");
    const [ai] = await prisma.knowledgeBaseItem.findMany({ where: { propertyId: a.propertyId } });
    const [bi] = await prisma.knowledgeBaseItem.findMany({ where: { propertyId: b.propertyId } });
    const v = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.01);
    const written = await persistChunkVectors(embeddingModel(), [
      { owners: [{ kbItemId: ai.id, updatedAt: ai.updatedAt }], text: "a metni", vector: v },
      { owners: [{ kbItemId: bi.id, updatedAt: bi.updatedAt }], text: "b metni", vector: v },
    ]);
    expect(written.size).toBe(1);
    expect(await prisma.kbChunkVector.count({ where: { kbItemId: ai.id } })).toBe(1);
    expect(await prisma.kbChunkVector.count({ where: { kbItemId: bi.id } })).toBe(0);
  });

  it("listede olmayan işletmenin düzenlemesinde temizlik sorgusu çalışmaz (eski satır yerinde kalır — depoya dokunulmaz)", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    await seed(b.propertyId, 35, "B");
    // B daha önce pilottaydı (satırları var), sonra listeden çıkarıldı.
    vi.stubEnv("KB_VECTOR_STORE_ORG_IDS", b.orgId);
    await warm(b.propertyId);
    expect(await rowsOfProperty(b.propertyId)).toBe(35);
    vi.stubEnv("KB_VECTOR_STORE_ORG_IDS", a.orgId);
    const item = await prisma.knowledgeBaseItem.findFirstOrThrow({ where: { propertyId: b.propertyId, title: "Bilgi B3" } });
    await prisma.knowledgeBaseItem.update({ where: { id: item.id }, data: { content: "Dairedeki 3. bilgi notu değişti." } });
    await afterKbItemsChanged({ organizationId: b.orgId, propertyIds: [b.propertyId] });
    expect(await rowsOfProperty(b.propertyId)).toBe(35);
  });

  it("KONTROL: liste '*' → bütün işletmeler (bugünkü depo davranışı); liste YOK / boş → KİMSE (ana anahtar açık olsa da)", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    await seed(a.propertyId);
    await seed(b.propertyId, 35, "B");
    vi.stubEnv("KB_VECTOR_STORE_ORG_IDS", "");
    await warm(a.propertyId);
    expect(await prisma.kbChunkVector.count()).toBe(0);
    restart();
    vi.stubEnv("KB_VECTOR_STORE_ORG_IDS", "*");
    await warm(a.propertyId);
    await warm(b.propertyId);
    expect(await rowsOfProperty(a.propertyId)).toBe(35);
    expect(await rowsOfProperty(b.propertyId)).toBe(35);
    restart();
    expect((await prepare(b.propertyId)).status).toBe("ok");
    expect(chunkTexts()).toEqual([]);
  });

  it("KONTROL: ana anahtar kapalıyken liste dolu olsa da depo kapalı", async () => {
    const a = await makeOrgWithProperty();
    vi.stubEnv("KB_VECTOR_STORE_ENABLED", "");
    vi.stubEnv("KB_VECTOR_STORE_ORG_IDS", a.orgId);
    await seed(a.propertyId);
    await warm(a.propertyId);
    expect(await prisma.kbChunkVector.count()).toBe(0);
  });
});
