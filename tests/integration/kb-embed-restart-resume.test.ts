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
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { afterKbItemsChanged } from "@/lib/kb/after-change";
import { kbEmbedOrgKey } from "@/lib/ai/embeddings/embed-budget";

// ---------------------------------------------------------------------------
// "BÜTÇE DOLARSA İŞ KAYBOLMASIN, SONRAKİ UYGUN ZAMANDA DEVAM ETSİN" (kurucu 11-20 sabah, E-1…E-5) — YENİDEN BAŞLATMA. Gecikmeli ısıtmanın
// zamanlayıcısı ve yeniden denemesi süreç içidir (D2); süreç kapanınca kaybolur. Bu dosya yeniden başlatmadan sonra işin sürdüğünü gösterir:
//  (a) kaydın gecikmesi dolmadan süreç kapandı → açılış ısıtması (`warmAllKbVectorsOnce`) daireyi güncel hâliyle ısıtır;
//  (b) açılışta işletme kovası (DB, kopyalar ortak) hâlâ dolu → açılış ısıtması reddedilir; iş kaybolmamalı, pencere açılınca kendiliğinden
//      yeniden denenmeli (bugün: açılış ısıtması yeniden planlamıyordu).
// Anahtarlar açık: kalıcı depo (pilot '*') + D1 + D2 + D3. Sahte saat (setTimeout / clearTimeout / Date); DB gerçek.
// ---------------------------------------------------------------------------

const calls: string[][] = [];
const wifiEmbeds = () => calls.flat().filter((t) => t.startsWith("wifi"));
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

const sem = async (propertyId: string) =>
  (await retrieveKbForPrompt({ items: (await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true })).items, guestMessage: "Wi-Fi şifresi ne?" })).evidence?.sem;

/** "Yeniden başlatma": süreç belleği, zamanlayıcılar ve açılış bayrağı sıfır; veritabanı (kalıcı depo + sayaçlar) yerinde. */
function restart() {
  __resetSemanticRetrieval();
  __resetKbIndexCache();
  kbWarm.__resetBootWarm();
  kbWarm.__resetWarmScheduler();
  clearEmbeddingCache();
  calls.length = 0;
}

beforeEach(async () => {
  await resetDb();
  restart();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
  vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
  vi.stubEnv("KB_VECTOR_STORE_ENABLED", "1");
  vi.stubEnv("KB_VECTOR_STORE_ORG_IDS", "*");
  vi.stubEnv("KB_EMBED_ORG_BUDGET_ENABLED", "1");
  vi.stubEnv("KB_EMBED_DEBOUNCE_ENABLED", "1");
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
  kbWarm.__resetWarmScheduler();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("yeniden başlatmada iş sürer", () => {
  it("(a) kaydın 20 sn gecikmesi dolmadan süreç kapandı → açılış ısıtması daireyi GÜNCEL hâliyle ısıtır ('ok', yeni şifre gömüldü)", async () => {
    const p = await makeOrgWithProperty();
    const wifi = await seed(p.propertyId);
    await kbWarm.warmPropertyKbVectors(p.propertyId);
    await __awaitSemanticWarm();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await prisma.knowledgeBaseItem.update({ where: { id: wifi.id }, data: { content: wifiText("YENI-1111") } });
    await afterKbItemsChanged({ organizationId: p.orgId, propertyIds: [p.propertyId] });
    await vi.advanceTimersByTimeAsync(5_000); // gecikme dolmadı
    restart(); // süreç kapandı: bekleyen zamanlayıcı kayboldu
    expect(kbWarm.__pendingWarmTimers().size).toBe(0);
    kbWarm.warmAllKbVectorsOnce();
    await settle();
    expect(wifiEmbeds().some((t) => t.includes("YENI-1111"))).toBe(true);
    expect(await sem(p.propertyId)).toBe("ok");
  });

  it("🚨 (b) açılışta işletme kovası hâlâ dolu → açılış ısıtması reddedilir, iş KAYBOLMAZ: pencere açılınca kendiliğinden yeniden denenir", async () => {
    const p = await makeOrgWithProperty();
    const wifi = await seed(p.propertyId);
    await kbWarm.warmPropertyKbVectors(p.propertyId);
    await __awaitSemanticWarm();
    await prisma.knowledgeBaseItem.update({ where: { id: wifi.id }, data: { content: wifiText("YENI-2222") } });
    // Kova bu saat için dolu (başka kopyanın / önceki sürecin harcaması — DB'de).
    await prisma.rateLimitCounter.update({ where: { key: kbEmbedOrgKey(p.orgId) }, data: { count: 600 } });
    restart();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    kbWarm.warmAllKbVectorsOnce();
    await settle();
    expect(wifiEmbeds()).toEqual([]); // reddedildi
    expect(await sem(p.propertyId)).toBe("cold");
    // Sorunun soğuk dalı da arka planda bir ısıtma başlatır (o da kovaya takılır); pencere açılmadan BİTMELİ — yoksa pencere açıldıktan
    // sonra koşup testi açılış ısıtmasından bağımsız yeşile çevirir (ilk taslakta oldu).
    await settle();
    expect(wifiEmbeds()).toEqual([]);
    // Pencere biter (DB saatiyle geçmişe çekilir) ve zaman ilerler: iş kendiliğinden yeniden denenmeli.
    await prisma.$executeRaw`UPDATE "RateLimitCounter" SET "resetAt" = (now() AT TIME ZONE 'utc') - interval '1 second' WHERE "key" = ${kbEmbedOrgKey(p.orgId)}`;
    await vi.advanceTimersByTimeAsync(3_600_000);
    await settle();
    expect(wifiEmbeds().some((t) => t.includes("YENI-2222"))).toBe(true);
    expect(await sem(p.propertyId)).toBe("ok");
  });

  it("KONTROL (D2 kapalı): açılış ısıtması bugünkü gibi tek deneme — reddedilirse zamanlayıcı kurulmaz", async () => {
    vi.stubEnv("KB_EMBED_DEBOUNCE_ENABLED", "");
    const p = await makeOrgWithProperty();
    const wifi = await seed(p.propertyId);
    await kbWarm.warmPropertyKbVectors(p.propertyId);
    await __awaitSemanticWarm();
    await prisma.knowledgeBaseItem.update({ where: { id: wifi.id }, data: { content: wifiText("YENI-3333") } });
    await prisma.rateLimitCounter.update({ where: { key: kbEmbedOrgKey(p.orgId) }, data: { count: 600 } });
    restart();
    kbWarm.warmAllKbVectorsOnce();
    await settle();
    expect(wifiEmbeds()).toEqual([]);
    expect(kbWarm.__pendingWarmTimers().size).toBe(0);
  });
});
