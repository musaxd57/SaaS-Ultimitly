import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { warmPropertyKbVectors, __resetBootWarm } from "@/lib/ai/embeddings/kb-warm";
import {
  __awaitSemanticWarm,
  __exhaustWarmBudgetForTests,
  __resetSemanticRetrieval,
  purgeStaleVectorsForProperties,
} from "@/lib/ai/embeddings/semantic-retrieval";
import { clearEmbeddingCache, EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings/provider";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { chunkItems } from "@/lib/ai/retrieval/chunker";
import { embeddingTextFor } from "@/lib/ai/embeddings/context-text";
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { packKnowledgeBase } from "@/lib/ai/prompts";
import { __setVectorStoreReadForTests, inputHashOf } from "@/lib/ai/embeddings/vector-store";
import { afterKbItemsChanged } from "@/lib/kb/after-change";

// ---------------------------------------------------------------------------
// EMB tur 2 — D3 KALICI DEPODA TEMİZLİK PARÇA ÖZETİ DÜZEYİNDE (kurucu 11-19 akşam madde 2: "değişmeyen parçalar yeniden işlenmesin").
// Anahtar `KB_VECTOR_PURGE_BY_HASH_ENABLED` (yalnız "1"), yalnız kalıcı depo (`KB_VECTOR_STORE_ENABLED`) açıkken etkili. Bugün yazma kancası
// değişen kalemin BÜTÜN satırlarını siliyordu (sürüm uyuşmazlığı kalem düzeyinde) → düzenleyen süreçte vektör bellekte yoksa değişmeyen
// parçalar yeniden ödeniyordu (ölçüldü 5/5). Yeni hâl: kalemin bugünkü parça özetleri hesaplanır, yalnız ARTIK GEÇMEYEN özetler silinir,
// kalanların sürüm damgası yenilenir — yalnız kalem temizliğin okuduğu sürümdeyse. 🚨 Sürüm kuralı aynen: eski sürümle başlamış ısıtma
// eski satır yazamaz. Eski içerik isteme girmez (okuma içerik adresli; EMB-1).
// ---------------------------------------------------------------------------

const OLD = "ESKI-4821";
const NEW = "YENI-7305";
const calls: string[][] = [];
const guideEmbeds = () => calls.flat().filter((t) => t.startsWith("general · Ev rehberi"));
const vec = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, d) => (d === h % EMBEDDING_DIMENSIONS ? 1 : 0.001));
};

function wifiGuide(pass: string): string {
  const s = (k: number) => `Rehber satırı ${k} dairenin kullanımına dair ayrıntılı bir açıklama içeriyor ve misafire yol gösteriyor.`;
  const before = Array.from({ length: 12 }, (_, k) => s(k)).join(" ");
  const after = Array.from({ length: 12 }, (_, k) => s(k + 20)).join(" ");
  return `${before} Kablosuz ağ adı LaleNet, şifre ${pass} olarak ayarlıdır. ${after}`;
}

async function seed(propertyId: string) {
  for (let i = 0; i < 35; i++) {
    await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "general", title: `Bilgi ${i}`, content: `Dairedeki ${i}. bilgi notu.`, isActive: true, source: "host_manual", reviewState: "approved" },
    });
  }
  return prisma.knowledgeBaseItem.create({
    data: { propertyId, category: "general", title: "Ev rehberi", content: wifiGuide(OLD), isActive: true, source: "host_manual", reviewState: "approved" },
    select: { id: true },
  });
}

const kbOf = async (propertyId: string) => (await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true })).items;
const hashesOf = async (propertyId: string, id: string) =>
  chunkItems((await kbOf(propertyId)).filter((i) => i.id === id)).map((c) => inputHashOf(embeddingTextFor(c)));
const rowsOf = (kbItemId: string) => prisma.kbChunkVector.findMany({ where: { kbItemId }, select: { inputHash: true, itemUpdatedAt: true } });
const versionOf = async (id: string) => (await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } })).updatedAt.getTime();

async function warmAndWait(propertyId: string) {
  await warmPropertyKbVectors(propertyId);
  await __awaitSemanticWarm();
}

function restart() {
  __resetSemanticRetrieval();
  __resetKbIndexCache();
  __resetBootWarm();
  clearEmbeddingCache();
  calls.length = 0;
}

beforeEach(async () => {
  await resetDb();
  restart();
  __setVectorStoreReadForTests(null);
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
  vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
  vi.stubEnv("KB_VECTOR_STORE_ENABLED", "1");
  // Kalıcı depo pilot listesi (kurucu 11-20 sabah): bu dosya depoyu bütün işletmeler için sınar.
  vi.stubEnv("KB_VECTOR_STORE_ORG_IDS", "*");
  vi.stubEnv("KB_VECTOR_PURGE_BY_HASH_ENABLED", "1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const { input } = JSON.parse(init.body) as { input: string[] };
      calls.push(input);
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

describe("D3 parça özeti düzeyinde temizlik (anahtar + kalıcı depo açık)", () => {
  it("🚨 düzenleyen süreçte bellek boşken yalnız DEĞİŞEN parça gömülür (bugün 5/5 → 1/5); değişmeyen satırların damgası yeni sürüm, eski özet yok", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const guide = await seed(propertyId);
    await warmAndWait(propertyId);
    const before = await hashesOf(propertyId, guide.id);
    expect(before.length).toBeGreaterThanOrEqual(3);

    restart(); // bu süreçte rehberin vektörleri bellekte yok (tahliye / soğuk kopya)
    await prisma.knowledgeBaseItem.update({ where: { id: guide.id }, data: { content: wifiGuide(NEW) } });
    await afterKbItemsChanged({ organizationId: orgId, propertyIds: [propertyId] });
    await warmAndWait(propertyId);
    console.log(`D3 kalemParça=${before.length} yenidenGömülen=${guideEmbeds().length}`);
    expect(guideEmbeds()).toHaveLength(1);
    expect(guideEmbeds()[0]).toContain(NEW);

    const after = await hashesOf(propertyId, guide.id);
    const rows = await rowsOf(guide.id);
    const version = await versionOf(guide.id);
    expect(rows.map((r) => r.inputHash).sort()).toEqual([...after].sort());
    expect(rows.every((r) => r.itemUpdatedAt.getTime() === version)).toBe(true);
    const gone = before.filter((h) => !after.includes(h));
    expect(gone).toHaveLength(1);
    expect(rows.map((r) => r.inputHash)).not.toContain(gone[0]);
  });

  it("🚨 eski içerik isteme girmez: düzenleme + bütçe dolu + yeniden başlatma → karar 'cold', istemde yeni şifre var, eski yok", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const guide = await seed(propertyId);
    await warmAndWait(propertyId);
    await prisma.knowledgeBaseItem.update({ where: { id: guide.id }, data: { content: wifiGuide(NEW) } });
    restart();
    __exhaustWarmBudgetForTests();
    await afterKbItemsChanged({ organizationId: orgId, propertyIds: [propertyId] });
    await warmAndWait(propertyId);
    const r = await retrieveKbForPrompt({ items: await kbOf(propertyId), guestMessage: "Wi-Fi şifresi ne?" });
    const block = packKnowledgeBase(r.items, r.droppedItems, r.selection, r.notes).text;
    expect(r.evidence?.sem).toBe("cold");
    expect(block).toContain(NEW);
    expect(block).not.toContain(OLD);
  });

  it("🚨 sürüm kuralı aynen: eski sürümle başlamış ısıtma, temizlikten SONRA yazmaya çalışır ve yazamaz (eski özetin satırı hiç oluşmaz)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const guide = await seed(propertyId);
    const oldHashes = await hashesOf(propertyId, guide.id);
    const v1 = await versionOf(guide.id);

    // Eski sürümün ısıtması depo okumasında bekletilir; bu sırada düzenleme + D3 temizliği biter; sonra ısıtma bırakılır ve yazmaya çalışır.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered = false;
    __setVectorStoreReadForTests(async () => {
      entered = true;
      await gate;
      return [];
    });
    const oldWarm = warmPropertyKbVectors(propertyId); // bilgi tabanını ŞİMDİ (v1) okur
    for (let i = 0; i < 200 && !entered; i++) await new Promise((r) => setTimeout(r, 5));
    expect(entered).toBe(true); // eski ısıtma depo okumasında bekliyor
    await prisma.knowledgeBaseItem.update({ where: { id: guide.id }, data: { content: wifiGuide(NEW) } });
    await afterKbItemsChanged({ organizationId: orgId, propertyIds: [propertyId] });
    release();
    await oldWarm;
    await __awaitSemanticWarm();
    __setVectorStoreReadForTests(null);

    const newHashes = await hashesOf(propertyId, guide.id);
    const gone = oldHashes.filter((h) => !newHashes.includes(h));
    expect(gone).toHaveLength(1);
    const rows = await rowsOf(guide.id);
    expect(rows.map((r) => r.inputHash)).not.toContain(gone[0]);
    expect(rows.some((r) => r.itemUpdatedAt.getTime() === v1)).toBe(false);
    // Sonraki ısıtma bellekteki vektörlerin satırlarını güncel sürümle yazar: tam küme, hepsi güncel sürüm, eski özet yok.
    await warmAndWait(propertyId);
    const final = await rowsOf(guide.id);
    const v2 = await versionOf(guide.id);
    expect(final.map((r) => r.inputHash).sort()).toEqual([...newHashes].sort());
    expect(final.every((r) => r.itemUpdatedAt.getTime() === v2)).toBe(true);
  });

  it("damga yalnız kalem temizliğin okuduğu sürümdeyse yenilenir: okunan sürüm bayatsa (araya yeni düzenleme girdi) satırlar silinir", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const guide = await seed(propertyId);
    await warmAndWait(propertyId);
    const hashes = await hashesOf(propertyId, guide.id);
    const staleVersion = await versionOf(guide.id);
    // Metni değiştirmeyen yeni sürüm (v2); temizliğe v1'i okumuş gibi bayat bir liste verilir.
    await prisma.knowledgeBaseItem.update({ where: { id: guide.id }, data: { updatedAt: new Date(staleVersion + 60_000) } });
    await purgeStaleVectorsForProperties([propertyId], [{ id: guide.id, versionMs: staleVersion, hashes }]);
    expect(await rowsOf(guide.id)).toEqual([]);
    // KONTROL: güncel sürümle verilen liste damgayı yeniler, satır kalır.
    await warmAndWait(propertyId);
    const v3 = staleVersion + 120_000;
    await prisma.knowledgeBaseItem.update({ where: { id: guide.id }, data: { updatedAt: new Date(v3) } });
    await purgeStaleVectorsForProperties([propertyId], [{ id: guide.id, versionMs: v3, hashes }]);
    const rows = await rowsOf(guide.id);
    expect(rows).toHaveLength(hashes.length);
    expect(rows.every((r) => r.itemUpdatedAt.getTime() === v3)).toBe(true);
  });
});

describe("D3 kontrol", () => {
  it("KONTROL (anahtar kapalı): bugünkü kalem düzeyinde silme — bellek boşken değişmeyen parçalar da yeniden gömülür (5/5)", async () => {
    vi.stubEnv("KB_VECTOR_PURGE_BY_HASH_ENABLED", "");
    const { orgId, propertyId } = await makeOrgWithProperty();
    const guide = await seed(propertyId);
    await warmAndWait(propertyId);
    const total = (await hashesOf(propertyId, guide.id)).length;
    restart();
    await prisma.knowledgeBaseItem.update({ where: { id: guide.id }, data: { content: wifiGuide(NEW) } });
    await afterKbItemsChanged({ organizationId: orgId, propertyIds: [propertyId] });
    await warmAndWait(propertyId);
    expect(guideEmbeds()).toHaveLength(total);
  });

  it("KONTROL (kalıcı depo kapalı, anahtar açık): veritabanına hiçbir şey yazılmaz / silinmez", async () => {
    vi.stubEnv("KB_VECTOR_STORE_ENABLED", "");
    const { orgId, propertyId } = await makeOrgWithProperty();
    const guide = await seed(propertyId);
    await warmAndWait(propertyId);
    await prisma.knowledgeBaseItem.update({ where: { id: guide.id }, data: { content: wifiGuide(NEW) } });
    await afterKbItemsChanged({ organizationId: orgId, propertyIds: [propertyId] });
    await warmAndWait(propertyId);
    expect(await prisma.kbChunkVector.count()).toBe(0);
  });
});
