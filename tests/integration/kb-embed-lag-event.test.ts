import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import * as kbWarm from "@/lib/ai/embeddings/kb-warm";
import { __awaitSemanticWarm, __resetSemanticRetrieval } from "@/lib/ai/embeddings/semantic-retrieval";
import { clearEmbeddingCache, EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings/provider";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { afterKbItemsChanged } from "@/lib/kb/after-change";
import { kbEmbedOrgKey } from "@/lib/ai/embeddings/embed-budget";
import { __resetEventLogLimits } from "@/lib/event-log";

// ---------------------------------------------------------------------------
// KURUCUNUN İLK HAFTA İZLEYECEĞİ SAYI (11-20 sabah, E-1…E-5: "bir KB değişikliği anlamsal aramaya ne kadar sürede yansıyor?"). Migration'sız
// en sade yol: düzenlemeden doğan ısıtma bitince kalıcı, yalnız-ekle olay günlüğüne (`OperationalEvent`) tek satır `job.kb_embed.ready`:
// `durationMs` = kayıt değişikliği (`updatedAt`) → ısıtmanın bitişi (gecikme, bütçe beklemesi ve yeniden denemeler içinde), `count` = gömülen
// metin. Açılış ısıtması ve reddedilen / yarım kalan iş satır yazmaz. Sahte saat (setTimeout / clearTimeout / Date); DB gerçek.
// ---------------------------------------------------------------------------

const calls: string[][] = [];
const vec = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, d) => (d === h % EMBEDDING_DIMENSIONS ? 1 : 0.001));
};
const wifiText = (pass: string) => `Ağ adı: LaleNet. Şifre: ${pass}. Modem salondaki dolabın üstündedir.`;

async function settle(ms = 90): Promise<void> {
  const hooks = kbWarm as { __awaitScheduledWarms?: () => Promise<void>; __awaitBootWarm?: () => Promise<void> };
  for (let round = 0; round < 3; round++) {
    await hooks.__awaitBootWarm?.();
    await hooks.__awaitScheduledWarms?.();
    await __awaitSemanticWarm();
    const t0 = performance.now();
    while (performance.now() - t0 < ms / 3) await new Promise((r) => setImmediate(r));
  }
}

async function seed(propertyId: string) {
  for (let i = 0; i < 35; i++) {
    await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "general", title: `Bilgi ${i}`, content: `Dairedeki ${i}. bilgi notu.`, isActive: true, source: "host_manual", reviewState: "approved" },
    });
  }
  return prisma.knowledgeBaseItem.create({
    data: { propertyId, category: "wifi", title: "Wi-Fi", content: wifiText("ESKI-0000"), isActive: true, source: "host_manual", reviewState: "approved" },
    select: { id: true },
  });
}

const readyEvents = async (organizationId: string) =>
  (await prisma.operationalEvent.findMany({ where: { event: "job.kb_embed.ready", organizationId }, orderBy: { createdAt: "asc" } })).map(
    (e) => JSON.parse(e.dataJson ?? "{}") as { job?: string; durationMs?: number; count?: number },
  );

beforeEach(async () => {
  await resetDb();
  __resetSemanticRetrieval();
  __resetKbIndexCache();
  kbWarm.__resetBootWarm();
  kbWarm.__resetWarmScheduler();
  clearEmbeddingCache();
  __resetEventLogLimits();
  calls.length = 0;
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
  vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
  vi.stubEnv("KB_VECTOR_STORE_ENABLED", "");
  vi.stubEnv("KB_EMBED_ORG_BUDGET_ENABLED", "1");
  vi.stubEnv("KB_EMBED_DEBOUNCE_ENABLED", "1");
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
  kbWarm.__resetWarmScheduler();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function warmedProperty() {
  const p = await makeOrgWithProperty();
  const wifi = await seed(p.propertyId);
  await kbWarm.warmPropertyKbVectors(p.propertyId); // ilk ısıtma (ölçülmez)
  await __awaitSemanticWarm();
  return { ...p, wifiId: wifi.id };
}

describe("KB değişikliği → anlamsal aramaya yansıma süresi (olay günlüğü)", () => {
  it("🚨 düzenleme + 20 sn gecikme → tek 'job.kb_embed.ready' satırı: durationMs ≈ 20 sn, count = gömülen metin, işletmesi doğru", async () => {
    const p = await warmedProperty();
    expect(await readyEvents(p.orgId)).toEqual([]); // ilk (doğrudan) ısıtma ölçülmez
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const updated = await prisma.knowledgeBaseItem.update({ where: { id: p.wifiId }, data: { content: wifiText("YENI-1001") } });
    await afterKbItemsChanged({ organizationId: p.orgId, propertyIds: [p.propertyId] });
    const savedAt = Date.now(); // sahte saat
    await vi.advanceTimersByTimeAsync(20_000);
    await settle();
    const ev = await readyEvents(p.orgId);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ job: "kb_embed", count: 1 });
    // durationMs = ısıtmanın bitişi − kaydın `updatedAt`'i. `updatedAt`i Prisma motoru GERÇEK saatle yazar, ölçüm uygulamanın saatiyle biter
    // (üretimde ikisi aynı makinenin saati); testte uygulama saati sahte olduğundan beklenen değer iki saatten kurulur: bitiş = kayıt + 20 sn.
    const expected = savedAt + 20_000 - updated.updatedAt.getTime();
    expect(Math.abs(ev[0].durationMs! - expected)).toBeLessThan(1_500);
    expect(savedAt - updated.updatedAt.getTime()).toBeLessThan(1_500); // sahte saat kayıt anında gerçek saatle aynı → beklenen ≈ 20 sn
  }, 60_000);

  it("bütçe beklemesi ölçüye girer: işletme kovası doluyken düzenleme → ret (satır YOK) → pencere açılınca yeniden deneme → satır, durationMs ≈ 1 saat", async () => {
    const p = await warmedProperty();
    await prisma.rateLimitCounter.update({ where: { key: kbEmbedOrgKey(p.orgId) }, data: { count: 600 } });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await prisma.knowledgeBaseItem.update({ where: { id: p.wifiId }, data: { content: wifiText("YENI-1002") } });
    await afterKbItemsChanged({ organizationId: p.orgId, propertyIds: [p.propertyId] });
    await vi.advanceTimersByTimeAsync(20_000);
    await settle();
    expect(await readyEvents(p.orgId)).toEqual([]); // reddedilen iş satır yazmaz
    await prisma.$executeRaw`UPDATE "RateLimitCounter" SET "resetAt" = (now() AT TIME ZONE 'utc') - interval '1 second' WHERE "key" = ${kbEmbedOrgKey(p.orgId)}`;
    await vi.advanceTimersByTimeAsync(3_600_000);
    await settle();
    const ev = await readyEvents(p.orgId);
    expect(ev).toHaveLength(1);
    expect(ev[0].durationMs!).toBeGreaterThan(3_000_000);
  }, 60_000);

  it("KONTROL: açılış ısıtması ölçülmez (eski kalemler) — yeniden başlatmada bütün daire ısınır, satır yazılmaz", async () => {
    const p = await warmedProperty();
    __resetSemanticRetrieval();
    kbWarm.__resetBootWarm();
    clearEmbeddingCache();
    calls.length = 0;
    kbWarm.warmAllKbVectorsOnce();
    await settle();
    expect(calls.flat().length).toBeGreaterThan(30); // gerçekten ısındı
    expect(await readyEvents(p.orgId)).toEqual([]);
  }, 60_000);

  it("KONTROL (gecikmeli ısıtma kapalı): kanca hemen ısıtır ve yine ölçülür (durationMs küçük)", async () => {
    vi.stubEnv("KB_EMBED_DEBOUNCE_ENABLED", "");
    const p = await warmedProperty();
    await prisma.knowledgeBaseItem.update({ where: { id: p.wifiId }, data: { content: wifiText("YENI-1003") } });
    await afterKbItemsChanged({ organizationId: p.orgId, propertyIds: [p.propertyId] });
    await settle();
    const ev = await readyEvents(p.orgId);
    expect(ev).toHaveLength(1);
    expect(ev[0].durationMs!).toBeLessThan(5_000);
  }, 60_000);
});
