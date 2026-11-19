import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { warmPropertyKbVectors, __resetBootWarm } from "@/lib/ai/embeddings/kb-warm";
import { __awaitSemanticWarm, __resetSemanticRetrieval } from "@/lib/ai/embeddings/semantic-retrieval";
import { clearEmbeddingCache, EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings/provider";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { afterKbItemsChanged } from "@/lib/kb/after-change";
import { rateLimitTakeIfFits } from "@/lib/rate-limit";
import { embedBgPerHour, embedOrgPerHour, takeEmbedBudget } from "@/lib/ai/embeddings/embed-budget";

// ---------------------------------------------------------------------------
// EMB tur 2 — D1 KOVA AYRIMI (kurucu 11-19 akşam madde 2: "işletme başına arka plan bütçesi … bütçeyi uygulama kopyaları birlikte görsün").
// Anahtar `KB_EMBED_ORG_BUDGET_ENABLED` (yalnız "1"). Açıkken bir ısıtma işi önce işletme kovasından (`kb-embed-org:<orgId>`), sonra ortak
// arka plan kovasından (`kb-embed-bg`) alınır; ikisi `RateLimitCounter` satırı, DB saatiyle — süreç belleği değil. İşletme kovası taşarsa
// ortak kovaya dokunulmaz; iş hepsi-ya-hiç. Sıcak yol (misafir sorgusunun gömmesi) hiçbir kovayı okumaz / yazmaz. Kapalıyken bugünkü süreç
// içi sayaç birebir. Gömme sağlayıcısı taklit (ağ yok).
// ---------------------------------------------------------------------------

const calls: string[][] = [];
const isChunkText = (t: string) => /^(general|wifi)\b/.test(t);
const chunkTextsEmbedded = () => calls.flat().filter(isChunkText);
const vec = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[h % EMBEDDING_DIMENSIONS] = 1;
  return v;
};

async function createItem(propertyId: string, title: string, content: string, category = "general") {
  return prisma.knowledgeBaseItem.create({
    data: { propertyId, category, title, content, isActive: true, source: "host_manual", reviewState: "approved" },
    select: { id: true },
  });
}

async function seedNeutral(propertyId: string, n: number) {
  for (let i = 0; i < n; i++) await createItem(propertyId, `Bilgi ${i}`, `Dairedeki ${i}. bilgi notu.`);
}

/** Uzun kalem: her cümle tur ve kalem numarasını taşır → her düzenlemede bütün parçalar yeni metin (~5 parça / kalem). */
function longContent(tag: string, round: number, i: number): string {
  return Array.from({ length: 50 }, (_, k) => `${tag} ${round} kalem ${i} satır ${k} kullanım bilgisi burada yer alıyor.`).join(" ");
}

async function seedLong(propertyId: string, tag: string, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push((await createItem(propertyId, `${tag} ${i}`, longContent(tag, 0, i))).id);
  return ids;
}

async function warmAndWait(propertyId: string): Promise<void> {
  await warmPropertyKbVectors(propertyId);
  await __awaitSemanticWarm();
}

/** Bir tur toplu düzenleme (rotaların kancası). Dönüş: bu turda gömülen parça metni. */
async function editRound(orgId: string, propertyId: string, ids: readonly string[], tag: string, round: number): Promise<number> {
  const before = chunkTextsEmbedded().length;
  for (let i = 0; i < ids.length; i++) await prisma.knowledgeBaseItem.update({ where: { id: ids[i] }, data: { content: longContent(tag, round, i) } });
  await afterKbItemsChanged({ organizationId: orgId, propertyIds: [propertyId] });
  await warmAndWait(propertyId);
  return chunkTextsEmbedded().length - before;
}

/** Reddedilene kadar düzenle. Dönüş: son tur numarası + toplam gömülen. */
async function spree(orgId: string, propertyId: string, ids: readonly string[], tag: string): Promise<{ rounds: number; embedded: number }> {
  let embedded = 0;
  let round = 1;
  for (; round <= 60; round++) {
    const got = await editRound(orgId, propertyId, ids, tag, round);
    if (got === 0) break;
    embedded += got;
  }
  return { rounds: round, embedded };
}

const semOf = async (propertyId: string, guestMessage: string) =>
  (await retrieveKbForPrompt({ items: (await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true })).items, guestMessage })).evidence?.sem;

const counter = (key: string) => prisma.rateLimitCounter.findUnique({ where: { key } });

function restart() {
  __resetSemanticRetrieval();
  __resetKbIndexCache();
  __resetBootWarm();
  clearEmbeddingCache();
}

beforeEach(async () => {
  await resetDb();
  restart();
  calls.length = 0;
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
  vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
  vi.stubEnv("KB_VECTOR_STORE_ENABLED", "");
  vi.stubEnv("KB_EMBED_ORG_BUDGET_ENABLED", "1");
  vi.stubEnv("KB_EMBED_ORG_PER_HOUR", "");
  vi.stubEnv("KB_EMBED_BG_PER_HOUR", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      if (!String(url).includes("/embeddings")) throw new Error(`beklenmeyen ağ çağrısı ${String(url)}`);
      const { input } = JSON.parse(init.body) as { input: string[] };
      calls.push(input);
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

describe("D1 'n al — sığmıyorsa sayacı artırmadan reddet' (rateLimitTakeIfFits, gerçek PG)", () => {
  const HOUR = 3_600_000;
  const row = (key: string) => prisma.rateLimitCounter.findUnique({ where: { key } });

  it("boş anahtar → verilir, sayaç n; sığan alım birikir; sığmayan alım REDDEDİLİR ve satır (sayaç + pencere) DEĞİŞMEZ", async () => {
    expect((await rateLimitTakeIfFits("t:a", 4, 10, HOUR)).granted).toBe(true);
    expect((await row("t:a"))?.count).toBe(4);
    expect((await rateLimitTakeIfFits("t:a", 6, 10, HOUR)).granted).toBe(true);
    const full = await row("t:a");
    expect(full?.count).toBe(10);
    const refused = await rateLimitTakeIfFits("t:a", 1, 10, HOUR);
    expect(refused.granted).toBe(false);
    expect(refused.retryAfterMs).toBeGreaterThan(HOUR - 60_000);
    expect(await row("t:a")).toEqual(full);
  });

  it("🚨 eşzamanlı iki alım tavanı birlikte AŞAMAZ (6 + 6, tavan 10 → tam biri); KONTROL: 5 + 5 ikisi de verilir", async () => {
    for (let trial = 0; trial < 15; trial++) {
      const key = `t:race:${trial}`;
      const out = await Promise.all([rateLimitTakeIfFits(key, 6, 10, HOUR), rateLimitTakeIfFits(key, 6, 10, HOUR)]);
      expect(out.filter((o) => o.granted)).toHaveLength(1);
      expect((await row(key))?.count).toBe(6);
      const ok = await Promise.all([rateLimitTakeIfFits(`${key}:ok`, 5, 10, HOUR), rateLimitTakeIfFits(`${key}:ok`, 5, 10, HOUR)]);
      expect(ok.every((o) => o.granted)).toBe(true);
      expect((await row(`${key}:ok`))?.count).toBe(10);
    }
  });

  it("boş pencere tavandan büyük tek işi alır ve pencereyi doldurur; açık pencerede tavandan büyük iş reddedilir; dolmuş pencere sıfırlanır", async () => {
    expect((await rateLimitTakeIfFits("t:big", 15, 10, HOUR)).granted).toBe(true);
    expect((await row("t:big"))?.count).toBe(15);
    expect((await rateLimitTakeIfFits("t:big", 1, 10, HOUR)).granted).toBe(false);
    await rateLimitTakeIfFits("t:big2", 2, 10, HOUR);
    expect((await rateLimitTakeIfFits("t:big2", 15, 10, HOUR)).granted).toBe(false);
    expect((await row("t:big2"))?.count).toBe(2);
    // Pencere doldu (DB saatiyle geçmişte) → yeni pencere, sayaç n.
    await prisma.$executeRaw`UPDATE "RateLimitCounter" SET "resetAt" = (now() AT TIME ZONE 'utc') - interval '1 second' WHERE "key" = 't:big'`;
    expect((await rateLimitTakeIfFits("t:big", 3, 10, HOUR)).granted).toBe(true);
    expect((await row("t:big"))?.count).toBe(3);
  });
});

describe("D1 iki kova (takeEmbedBudget)", () => {
  it("işletme kovası taşarsa ortak kovaya DOKUNULMAZ; ortak kova taşarsa işletme kovasındaki alım GERİ ALINIR; ikisi sığarsa ikisi de n artar", async () => {
    vi.stubEnv("KB_EMBED_ORG_PER_HOUR", "10");
    vi.stubEnv("KB_EMBED_BG_PER_HOUR", "15");
    expect(await takeEmbedBudget({ n: 8, organizationId: "orgA", kbItemIds: [] })).toEqual({ granted: true });
    expect((await counter("kb-embed-org:orgA"))?.count).toBe(8);
    expect((await counter("kb-embed-bg"))?.count).toBe(8);

    const orgFull = await takeEmbedBudget({ n: 5, organizationId: "orgA", kbItemIds: [] });
    expect(orgFull).toMatchObject({ granted: false, bucket: "org" });
    expect((await counter("kb-embed-bg"))?.count).toBe(8);
    expect((await counter("kb-embed-org:orgA"))?.count).toBe(8);

    const bgFull = await takeEmbedBudget({ n: 9, organizationId: "orgB", kbItemIds: [] });
    expect(bgFull).toMatchObject({ granted: false, bucket: "bg" });
    expect(await counter("kb-embed-org:orgB")).toBeNull(); // işlem geri sarıldı: satır hiç oluşmadı
    expect((await counter("kb-embed-bg"))?.count).toBe(8);
    expect(await takeEmbedBudget({ n: 7, organizationId: "orgB", kbItemIds: [] })).toEqual({ granted: true });
    expect((await counter("kb-embed-bg"))?.count).toBe(15);
  });

  it("işletme verilmezse kalemlerden bulunur (sıcak yolun soğuk dalı); kalem yoksa sahibi yok → reddedilir, satır yazılmaz", async () => {
    const a = await makeOrgWithProperty();
    const item = await createItem(a.propertyId, "Bilgi", "Dairedeki bilgi notu.");
    expect(await takeEmbedBudget({ n: 3, kbItemIds: [item.id] })).toEqual({ granted: true });
    expect((await counter(`kb-embed-org:${a.orgId}`))?.count).toBe(3);
    expect(await takeEmbedBudget({ n: 3, kbItemIds: ["yok-boyle-kalem"] })).toEqual({ granted: false, bucket: "owner", retryAfterMs: null });
    expect((await counter("kb-embed-bg"))?.count).toBe(3);
  });

  it("değer değişkenleri: geçersiz değer varsayılana düşer (600 / 2.000)", () => {
    vi.stubEnv("KB_EMBED_ORG_PER_HOUR", "abc");
    vi.stubEnv("KB_EMBED_BG_PER_HOUR", "0");
    expect(embedOrgPerHour()).toBe(600);
    expect(embedBgPerHour()).toBe(2_000);
    vi.stubEnv("KB_EMBED_ORG_PER_HOUR", " 750 ");
    expect(embedOrgPerHour()).toBe(750);
  });
});

describe("D1 kova ayrımı — davranış (anahtar açık)", () => {
  it("🚨 A kendi işletme kovasını (600/saat) bitirir; B'nin yeni büyük bilgi tabanı ortak kovadan hemen ısınır → 'ok'", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    const aIds = await seedLong(a.propertyId, "Tur", 30);
    const run = await spree(a.orgId, a.propertyId, aIds, "Tur");
    console.log(`D1 A tur=${run.rounds} gömülen=${run.embedded}`);
    expect(run.embedded).toBeLessThanOrEqual(600);
    expect(run.embedded).toBeGreaterThan(0);

    // B: 40 uzun kalem (~200 parça) — bugünkü ortak süreç sayacında A'dan kalan pay buna yetmez.
    await seedLong(b.propertyId, "Bet", 40);
    calls.length = 0;
    await warmAndWait(b.propertyId);
    expect(chunkTextsEmbedded().length).toBeGreaterThan(150);
    expect(await semOf(b.propertyId, "Bet kalem satır bilgisi nedir?")).toBe("ok");
  }, 300_000);

  it("🚨 başka kopya / yeniden başlatma: süreç belleği sıfırlanınca A'nın kovası DB'de dolu kalır → A'nın yeni düzenlemesi gömülmez", async () => {
    const a = await makeOrgWithProperty();
    const aIds = await seedLong(a.propertyId, "Tur", 30);
    await spree(a.orgId, a.propertyId, aIds, "Tur");
    restart();
    expect(await editRound(a.orgId, a.propertyId, aIds, "Tur", 99)).toBe(0);
  }, 300_000);

  it("🚨 A'nın reddedilen işi ortak kovanın sayacını ARTIRMAZ; işletme kovası taşarken ortak kova yalnız verilenler kadar", async () => {
    const a = await makeOrgWithProperty();
    const aIds = await seedLong(a.propertyId, "Tur", 30);
    const run = await spree(a.orgId, a.propertyId, aIds, "Tur");
    const bg = await counter("kb-embed-bg");
    const org = await counter(`kb-embed-org:${a.orgId}`);
    expect(bg?.count).toBe(run.embedded);
    expect(org?.count).toBe(run.embedded);
    expect(await editRound(a.orgId, a.propertyId, aIds, "Tur", 98)).toBe(0);
    expect((await counter("kb-embed-bg"))?.count).toBe(run.embedded);
    expect((await counter(`kb-embed-org:${a.orgId}`))?.count).toBe(run.embedded);
  }, 300_000);

  it("PİN: sıcak yol kovayı okumaz / yazmaz — iki kova doluyken B'nin ısınmış bilgi tabanında soru 'ok', tek gömme isteği, satırlar değişmez", async () => {
    const b = await makeOrgWithProperty();
    await seedNeutral(b.propertyId, 35);
    await warmAndWait(b.propertyId);
    // B'nin ısıtması kovalara zaten yazdı; iki kova tavana çekilir.
    const full = new Date(Date.now() + 3_600_000);
    for (const [key, count] of [["kb-embed-bg", 2_000], [`kb-embed-org:${b.orgId}`, 600]] as const) {
      await prisma.rateLimitCounter.upsert({ where: { key }, create: { key, count, resetAt: full }, update: { count, resetAt: full } });
    }
    const before = await prisma.rateLimitCounter.findMany({ orderBy: { key: "asc" } });
    calls.length = 0;
    expect(await semOf(b.propertyId, "Dairedeki 3. bilgi notu nedir?")).toBe("ok");
    expect(calls.length).toBe(1);
    expect(chunkTextsEmbedded()).toEqual([]);
    await __awaitSemanticWarm();
    expect(await prisma.rateLimitCounter.findMany({ orderBy: { key: "asc" } })).toEqual(before);
  });

  it("KONTROL (anahtar kapalı): bugünkü süreç içi sayaç — A tek işletme olarak 2.000'e kadar gömer, sayaç tablosuna satır yazılmaz", async () => {
    vi.stubEnv("KB_EMBED_ORG_BUDGET_ENABLED", "");
    const a = await makeOrgWithProperty();
    const aIds = await seedLong(a.propertyId, "Tur", 30);
    const run = await spree(a.orgId, a.propertyId, aIds, "Tur");
    expect(run.embedded).toBeGreaterThan(600);
    expect(run.embedded).toBeLessThanOrEqual(2_000);
    expect(await prisma.rateLimitCounter.count()).toBe(0);
  }, 300_000);
});
