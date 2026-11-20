import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { warmPropertyKbVectors, __resetBootWarm, __resetWarmScheduler } from "@/lib/ai/embeddings/kb-warm";
import { __awaitSemanticWarm, __exhaustWarmBudgetForTests, __resetSemanticRetrieval } from "@/lib/ai/embeddings/semantic-retrieval";
import { clearEmbeddingCache, EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings/provider";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { chunkItems } from "@/lib/ai/retrieval/chunker";
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { kbEmbedOrgKey } from "@/lib/ai/embeddings/embed-budget";

// ---------------------------------------------------------------------------
// EMB D1 düzeltmesi — G2 tur 4 T4-B12 (repro `tests/repro-g2-t4-qr-split-budget.test.ts`, dal agent/g2-tur4, c1c8c844; kalıcı teste
// çevrildi). Tasarım: bir DAİRENİN ısıtma işi hepsi-ya-hiç alınır; boş pencere tavandan büyük tek işi alabilir. Uygulamada daire ısıtması iki
// işti (ham küme + yer tutuculu kalem varsa QR'ın nötr hitaplı kümesi, her biri ayrı bütçe alımı): küçük QR işi boş pencereyi önce açıyor,
// 600'ü aşan ham iş "açık pencerede tavandan büyük iş" olarak reddediliyordu → bilgi tabanında tek bir "{isim}" geçen büyük dairenin bütün
// kararları ≤ 1 saat 'cold'. Düzeltme: `KB_EMBED_ORG_BUDGET_ENABLED` açıkken dairenin kümeleri TEK işte (tek bütçe alımı). Kapalıyken iki iş
// (bugünkü süreç içi sayaç davranışı birebir).
// ---------------------------------------------------------------------------

const embedded: string[] = [];
const vec = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, d) => (d === h % EMBEDDING_DIMENSIONS ? 1 : 0.001));
};

const kbOf = async (propertyId: string) => (await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true })).items;
const chunkCount = async (propertyId: string) => chunkItems(await kbOf(propertyId)).length;
const counter = async (key: string) => (await prisma.rateLimitCounter.findUnique({ where: { key } }))?.count ?? 0;
const GREETING_RAW = "Hoş geldiniz {isim}, iyi tatiller dileriz.";
const filledGreeting = () => embedded.filter((t) => t.includes("Hoş geldiniz") && !t.includes("{isim}"));
const rawGreeting = () => embedded.filter((t) => t.includes("Hoş geldiniz {isim}"));

/** Daireye TAM `targetChunks` parça (yer tutucusuz) üretir (G2'nin tohumlayıcısı). */
async function seedChunks(propertyId: string, targetChunks: number) {
  const sentence = (i: number, k: number) => `Rehber kalem ${i} cümle ${k} uzun kullanım bilgisini ayrıntılı biçimde anlatıyor.`;
  const item = (i: number) => ({
    propertyId,
    category: "general",
    title: `Rehber ${i}`,
    content: Array.from({ length: 24 }, (_, k) => sentence(i, k)).join(" "),
    isActive: true,
    source: "host_manual",
    reviewState: "approved",
  });
  const base = await chunkCount(propertyId);
  await prisma.knowledgeBaseItem.create({ data: item(0) });
  const per = (await chunkCount(propertyId)) - base;
  const more = Math.max(0, Math.floor((targetChunks - base) / per) - 1);
  await prisma.knowledgeBaseItem.createMany({ data: Array.from({ length: more }, (_, i) => item(i + 1)) });
  let n = await chunkCount(propertyId);
  for (let k = 0; n < targetChunks && k < 300; k++) {
    await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "general", title: `Rehber ek ${k}`, content: "Kısa ek not.", isActive: true, source: "host_manual", reviewState: "approved" },
    });
    n = await chunkCount(propertyId);
  }
  return n;
}

async function seedWithGreeting(propertyId: string) {
  await seedChunks(propertyId, 639);
  await prisma.knowledgeBaseItem.create({
    data: { propertyId, category: "general", title: "Karşılama", content: GREETING_RAW, isActive: true, source: "host_manual", reviewState: "approved" },
  });
  expect(await chunkCount(propertyId)).toBe(640);
}

async function rawSem(propertyId: string) {
  const r = await retrieveKbForPrompt({ items: await kbOf(propertyId), guestMessage: "Rehber kalem 3 cümle 4 nedir?" });
  return r.evidence?.sem;
}

beforeEach(async () => {
  await resetDb();
  __resetSemanticRetrieval();
  __resetKbIndexCache();
  __resetBootWarm();
  __resetWarmScheduler();
  clearEmbeddingCache();
  embedded.length = 0;
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
  vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
  vi.stubEnv("KB_VECTOR_STORE_ENABLED", "1");
  vi.stubEnv("KB_EMBED_ORG_BUDGET_ENABLED", "1");
  vi.stubEnv("KB_EMBED_ORG_PER_HOUR", "");
  vi.stubEnv("KB_EMBED_BG_PER_HOUR", "");
  vi.stubEnv("KB_EMBED_DEBOUNCE_ENABLED", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      if (!String(url).includes("/embeddings")) throw new Error(`beklenmeyen ağ çağrısı ${String(url)}`);
      const { input } = JSON.parse(init.body) as { input: string[] };
      embedded.push(...input);
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ data: input.map((t, index) => ({ index, embedding: vec(t) })) }) };
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

describe("D1 — dairenin ısıtması tek bütçe alımı (anahtar açık)", () => {
  it("KONTROL: 640 parçalı daire, yer tutucu YOK → boş pencerede tek iş, sayaç 640, karar 'ok'", async () => {
    const p = await makeOrgWithProperty();
    expect(await seedChunks(p.propertyId, 640)).toBe(640);
    await warmPropertyKbVectors(p.propertyId);
    await __awaitSemanticWarm();
    expect(await counter(kbEmbedOrgKey(p.orgId))).toBe(640);
    expect(await rawSem(p.propertyId)).toBe("ok");
  }, 120_000);

  it("🚨 aynı daire + tek '{isim}' kalemi → ham ve QR kümeleri TEK işte alınır: karar 'ok', iki biçim de gömülür, sayaç 641 (640 ham + 1 QR)", async () => {
    const p = await makeOrgWithProperty();
    await seedWithGreeting(p.propertyId);
    await warmPropertyKbVectors(p.propertyId);
    await __awaitSemanticWarm();
    expect(await rawSem(p.propertyId)).toBe("ok");
    expect(rawGreeting()).toHaveLength(1);
    expect(filledGreeting()).toHaveLength(1);
    expect(await counter(kbEmbedOrgKey(p.orgId))).toBe(641);
    expect(await counter("kb-embed-bg")).toBe(641);
  }, 120_000);

  it("tek iş hepsi-ya-hiç: pencere açıkken (başka iş aldı) tavanı aşan daire işinin HİÇBİR kümesi alınmaz (QR biçimi de gömülmez)", async () => {
    const p = await makeOrgWithProperty();
    await seedWithGreeting(p.propertyId);
    await prisma.rateLimitCounter.create({ data: { key: kbEmbedOrgKey(p.orgId), count: 5, resetAt: new Date(Date.now() + 3_600_000) } });
    await warmPropertyKbVectors(p.propertyId);
    await __awaitSemanticWarm();
    expect(embedded.filter((t) => t.startsWith("general"))).toEqual([]);
    expect(await counter(kbEmbedOrgKey(p.orgId))).toBe(5);
    expect(await rawSem(p.propertyId)).toBe("cold");
  }, 120_000);
});

describe("D1 kapalı — bugünkü iki iş birebir", () => {
  it("KONTROL: süreç içi sayaçta 640 pay kalmışken ham iş (640) alınır, ardından QR işi (1) reddedilir — iki ayrı alım", async () => {
    vi.stubEnv("KB_EMBED_ORG_BUDGET_ENABLED", "");
    vi.stubEnv("KB_VECTOR_STORE_ENABLED", ""); // kararlar senkron ve sıralı (ham önce)
    const p = await makeOrgWithProperty();
    await seedWithGreeting(p.propertyId);
    __exhaustWarmBudgetForTests(640);
    await warmPropertyKbVectors(p.propertyId);
    await __awaitSemanticWarm();
    expect(rawGreeting()).toHaveLength(1);
    expect(filledGreeting()).toEqual([]);
    expect(await rawSem(p.propertyId)).toBe("ok");
    expect(await prisma.rateLimitCounter.count()).toBe(0);
  }, 120_000);
});
