import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import * as kbWarm from "@/lib/ai/embeddings/kb-warm";
import { __awaitSemanticWarm, __exhaustWarmBudgetForTests, __resetSemanticRetrieval } from "@/lib/ai/embeddings/semantic-retrieval";
import { clearEmbeddingCache, EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings/provider";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { afterKbItemsChanged } from "@/lib/kb/after-change";
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { packKnowledgeBase } from "@/lib/ai/prompts";

// ---------------------------------------------------------------------------
// EMB tur 2 — D2 GECİKMELİ ISITMA + REDDEDİLEN İŞİN YENİDEN PLANLANMASI (kurucu 11-19 akşam madde 2: "Host aynı Wi-Fi kaydını art arda
// düzenlerse her ara sürüm için para harcamayalım; kuyrukta güncel sürüm kalsın"). Anahtar `KB_EMBED_DEBOUNCE_ENABLED` (yalnız "1"),
// bekleme `KB_EMBED_DEBOUNCE_SECONDS` (varsayılan 20, kurucu sorusu E-5). Kanca daireyi "kirli" işaretler; ısıtma son kayıttan D saniye sonra
// bilgi tabanının O ANKİ hâlini okur. Bütçe reddederse iş pencere açılınca kendiliğinden yeniden planlanır (sınırlı). Sahte saat
// (yalnız setTimeout / clearTimeout / Date; veritabanı G/Ç gerçek). Kapalıyken bugünkü "hemen ısıt" davranışı.
// ---------------------------------------------------------------------------

const calls: string[][] = [];
const wifiEmbeds = () => calls.flat().filter((t) => t.startsWith("wifi"));
const vec = (i: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, d) => (d === i % EMBEDDING_DIMENSIONS ? 1 : 0.001));
const wifiText = (pass: string) => `Ağ adı: LaleNet. Şifre: ${pass}. Modem salondaki dolabın üstündedir.`;

/** Gerçek G/Ç'nin (veritabanı) bitmesini bekler — sahte saat altında `setTimeout` kullanılamaz; `performance.now` ve `setImmediate` gerçek. */
async function settle(ms = 120): Promise<void> {
  for (let round = 0; round < 3; round++) {
    const awaitRuns = (kbWarm as { __awaitScheduledWarms?: () => Promise<void> }).__awaitScheduledWarms;
    if (awaitRuns) await awaitRuns();
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

async function save(orgId: string, propertyId: string, id: string, pass: string) {
  await prisma.knowledgeBaseItem.update({ where: { id }, data: { content: wifiText(pass) } });
  await afterKbItemsChanged({ organizationId: orgId, propertyIds: [propertyId] });
}

beforeEach(async () => {
  await resetDb();
  __resetSemanticRetrieval();
  __resetKbIndexCache();
  clearEmbeddingCache();
  (kbWarm as { __resetWarmScheduler?: () => void }).__resetWarmScheduler?.();
  calls.length = 0;
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
  vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
  vi.stubEnv("KB_VECTOR_STORE_ENABLED", "");
  vi.stubEnv("KB_EMBED_ORG_BUDGET_ENABLED", "");
  vi.stubEnv("KB_EMBED_DEBOUNCE_ENABLED", "1");
  vi.stubEnv("KB_EMBED_DEBOUNCE_SECONDS", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const { input } = JSON.parse(init.body) as { input: string[] };
      calls.push(input);
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ data: input.map((_, index) => ({ index, embedding: vec(index) })) }) };
    }),
  );
});
afterEach(() => {
  (kbWarm as { __resetWarmScheduler?: () => void }).__resetWarmScheduler?.();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await prisma.$disconnect();
});

/** Isınmış daire (gerçek saatle), sonra sahte saat. */
async function warmProperty() {
  const p = await makeOrgWithProperty();
  const wifi = await seed(p.propertyId);
  await kbWarm.warmPropertyKbVectors(p.propertyId);
  await __awaitSemanticWarm();
  calls.length = 0;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  return { ...p, wifiId: wifi.id };
}

describe("D2 gecikmeli ısıtma (anahtar açık)", () => {
  it("🚨 art arda 5 kayıt (5 sn arayla) → TEK gömme, yalnız son sürüm; ara sürümler gömülmez", async () => {
    const { orgId, propertyId, wifiId } = await warmProperty();
    for (let v = 1; v <= 5; v++) {
      await save(orgId, propertyId, wifiId, `YENI-000${v}`);
      await vi.advanceTimersByTimeAsync(5_000);
      await settle();
    }
    expect(wifiEmbeds()).toEqual([]); // son kayıttan 20 sn geçmedi
    await vi.advanceTimersByTimeAsync(20_000);
    await settle();
    const w = wifiEmbeds();
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("YENI-0005");
  });

  it("🚨 gecikme süresince misafir sorusu: karar 'cold' (güncel kayıtta sözcüksel), istemde YENİ şifre var, ESKİ yok", async () => {
    const { orgId, propertyId, wifiId } = await warmProperty();
    await save(orgId, propertyId, wifiId, "YENI-0901");
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    const r = await retrieveKbForPrompt({ items: (await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true })).items, guestMessage: "Wi-Fi şifresi ne?" });
    const block = packKnowledgeBase(r.items, r.droppedItems, r.selection, r.notes).text;
    expect(r.evidence?.sem).toBe("cold");
    expect(block).toContain("YENI-0901");
    expect(block).not.toContain("ESKI-0000");
  });

  it("her kayıt saati yeniden kurar: 15 sn arayla 4 kayıt → son kayıttan 20 sn sonraya kadar ısıtma yok, sonra bir kez", async () => {
    const { orgId, propertyId, wifiId } = await warmProperty();
    for (let v = 1; v <= 4; v++) {
      await save(orgId, propertyId, wifiId, `YENI-001${v}`);
      if (v < 4) await vi.advanceTimersByTimeAsync(15_000);
      await settle();
    }
    await vi.advanceTimersByTimeAsync(19_000);
    await settle();
    expect(wifiEmbeds()).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);
    await settle();
    expect(wifiEmbeds()).toHaveLength(1);
  });

  it("🚨 bütçe reddederse iş pencere açılınca KENDİLİĞİNDEN yeniden planlanır (bugün kayboluyordu)", async () => {
    const { orgId, propertyId, wifiId } = await warmProperty();
    __exhaustWarmBudgetForTests();
    await save(orgId, propertyId, wifiId, "YENI-0101");
    await vi.advanceTimersByTimeAsync(20_000);
    await settle();
    expect(wifiEmbeds()).toEqual([]); // reddedildi
    await vi.advanceTimersByTimeAsync(3_600_000);
    await settle();
    const w = wifiEmbeds();
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("YENI-0101");
  });

  it("değer değişkeni: KB_EMBED_DEBOUNCE_SECONDS=5 → 5 sn sonra ısınır", async () => {
    vi.stubEnv("KB_EMBED_DEBOUNCE_SECONDS", "5");
    const { orgId, propertyId, wifiId } = await warmProperty();
    await save(orgId, propertyId, wifiId, "YENI-0201");
    await vi.advanceTimersByTimeAsync(4_000);
    await settle();
    expect(wifiEmbeds()).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);
    await settle();
    expect(wifiEmbeds()).toHaveLength(1);
  });
});

describe("D2 sınırlar", () => {
  it("🚨 yeniden deneme SINIRLI: kalıcı ret (işletme kovası uzun süre dolu) → ilk koşu + en çok WARM_RETRY_MAX yeniden deneme, sonra zamanlayıcı kalmaz", async () => {
    vi.stubEnv("KB_EMBED_ORG_BUDGET_ENABLED", "1");
    const p = await makeOrgWithProperty();
    const wifi = await seed(p.propertyId);
    await prisma.$executeRaw`
      INSERT INTO "RateLimitCounter" ("key", "count", "resetAt")
      VALUES (${`kb-embed-org:${p.orgId}`}, 1000000, (now() AT TIME ZONE 'utc') + interval '2 hours')`;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await save(p.orgId, p.propertyId, wifi.id, "YENI-0401");
    for (let i = 0; i < 40 && (i === 0 || kbWarm.__pendingWarmTimers().size > 0); i++) {
      await vi.advanceTimersByTimeAsync(2.2 * 3_600_000);
      await settle(60);
    }
    expect(kbWarm.__pendingWarmTimers().size).toBe(0);
    expect(kbWarm.__scheduledWarmRunCount()).toBe(kbWarm.WARM_RETRY_MAX + 1);
    expect(calls.flat().filter((t) => t.startsWith("general") || t.startsWith("wifi"))).toEqual([]);
  }, 120_000);

  it("zamanlayıcı süreci açık tutmaz (unref) ve daire başına tek zamanlayıcı kalır", async () => {
    const p = await makeOrgWithProperty();
    const wifi = await seed(p.propertyId);
    await save(p.orgId, p.propertyId, wifi.id, "YENI-0501");
    await save(p.orgId, p.propertyId, wifi.id, "YENI-0502");
    const timers = kbWarm.__pendingWarmTimers();
    expect(timers.size).toBe(1);
    const t = timers.get(p.propertyId) as unknown as { hasRef(): boolean };
    expect(t.hasRef()).toBe(false);
  });
});

describe("D2 kontrol", () => {
  it("KONTROL (anahtar kapalı): bugünkü 'hemen ısıt' — her kayıt kendi gömmesini başlatır, zamanlayıcı kurulmaz", async () => {
    vi.stubEnv("KB_EMBED_DEBOUNCE_ENABLED", "");
    const { orgId, propertyId, wifiId } = await warmProperty();
    for (let v = 1; v <= 3; v++) {
      await save(orgId, propertyId, wifiId, `YENI-030${v}`);
      await settle();
    }
    expect(wifiEmbeds()).toHaveLength(3);
    // Gecikmeli ısıtmanın zamanlayıcısı kurulmadı. (`vi.getTimerCount()` değil: ölçüm satırının olay günlüğü yazımı kendi 500 ms'lik zaman
    // aşımı zamanlayıcısını kurar — sahte saatte hiç dolmaz, gecikmeli ısıtmayla ilgisi yok.)
    expect(kbWarm.__pendingWarmTimers().size).toBe(0);
  });
});
