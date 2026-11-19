import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { warmPropertyKbVectors, __awaitScheduledWarms, __resetBootWarm, __resetWarmScheduler } from "@/lib/ai/embeddings/kb-warm";
import { __awaitSemanticWarm, __resetSemanticRetrieval } from "@/lib/ai/embeddings/semantic-retrieval";
import { clearEmbeddingCache, EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings/provider";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { packKnowledgeBase } from "@/lib/ai/prompts";
import { afterKbItemsChanged } from "@/lib/kb/after-change";

// ---------------------------------------------------------------------------
// EMB tur 2 — TASARIM §4 İLK DENEME TESTİ, ANAHTARLAR AÇIK (kurucu 11-19 akşam madde 2: "A işletmesi yoğun düzenleme yaparken B işletmesinin
// güncel bilgi tabanındaki anlamsal araması çalışmaya devam etmeli"). Açık: kalıcı depo + D1 kovalar + D2 gecikmeli ısıtma + D3 parça özeti
// temizliği. Adımlar 1–7 (`docs/TASARIM-2026-11-19-anlamsal-arama-butcesi.md` §4); 3. adım: "gecikme + ısıtma süresi içinde B 'ok'".
// Sahte saat (setTimeout / clearTimeout / Date); veritabanı ve sayaç penceresi gerçek DB saatiyle. Gömme sağlayıcısı taklit (ağ yok).
// ---------------------------------------------------------------------------

const OLD = "ESKI-4821";
const NEW = "YENI-7305";
const calls: string[][] = [];
const isChunkText = (t: string) => /^(general|wifi)\b/.test(t);
const chunkTexts = () => calls.flat().filter(isChunkText);
const vec = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  if (/wi-?fi|şifre|nternet/i.test(text)) v[0] = 1;
  v[1 + (h % (EMBEDDING_DIMENSIONS - 1))] += 0.3;
  return v;
};
const wifiText = (pass: string) => `Ağ adı: LaleNet. Şifre: ${pass}. Modem salondaki dolabın üstündedir.`;
const longContent = (round: number, i: number) =>
  Array.from({ length: 50 }, (_, k) => `Tur ${round} kalem ${i} satır ${k} kullanım bilgisi burada yer alıyor.`).join(" ");

async function createItem(propertyId: string, title: string, content: string, category = "general") {
  return prisma.knowledgeBaseItem.create({
    data: { propertyId, category, title, content, isActive: true, source: "host_manual", reviewState: "approved" },
    select: { id: true },
  });
}

/** Gerçek G/Ç'nin bitmesi (sahte saat altında `setTimeout` yok; `performance.now` / `setImmediate` gerçek). */
async function settle(ms = 90): Promise<void> {
  for (let round = 0; round < 3; round++) {
    await __awaitScheduledWarms();
    await __awaitSemanticWarm();
    const t0 = performance.now();
    while (performance.now() - t0 < ms / 3) await new Promise((r) => setImmediate(r));
  }
}

async function ask(propertyId: string, guestMessage: string) {
  const r = await retrieveKbForPrompt({ items: (await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true })).items, guestMessage });
  return { sem: r.evidence?.sem, block: packKnowledgeBase(r.items, r.droppedItems, r.selection, r.notes).text };
}

const counter = async (key: string) => (await prisma.rateLimitCounter.findUnique({ where: { key } }))?.count ?? 0;

function restart() {
  __resetSemanticRetrieval();
  __resetKbIndexCache();
  __resetBootWarm();
  __resetWarmScheduler();
  clearEmbeddingCache();
}

beforeEach(async () => {
  await resetDb();
  restart();
  calls.length = 0;
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
  vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
  vi.stubEnv("KB_VECTOR_STORE_ENABLED", "1");
  vi.stubEnv("KB_EMBED_ORG_BUDGET_ENABLED", "1");
  vi.stubEnv("KB_EMBED_DEBOUNCE_ENABLED", "1");
  vi.stubEnv("KB_VECTOR_PURGE_BY_HASH_ENABLED", "1");
  vi.stubEnv("KB_EMBED_ORG_PER_HOUR", "");
  vi.stubEnv("KB_EMBED_BG_PER_HOUR", "");
  vi.stubEnv("KB_EMBED_DEBOUNCE_SECONDS", "");
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
  __resetWarmScheduler();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("§4 — A yoğun düzenlerken B'nin güncel bilgi tabanında anlamsal arama sürer (D1 + D2 + D3 + kalıcı depo açık)", () => {
  it("adımlar 1–7", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    for (let i = 0; i < 45; i++) await createItem(b.propertyId, `Bilgi ${i}`, `Dairedeki ${i}. bilgi notu.`);
    const bWifi = await createItem(b.propertyId, "Wi-Fi", wifiText(OLD), "wifi");
    const aIds: string[] = [];
    for (let i = 0; i < 30; i++) aIds.push((await createItem(a.propertyId, `Saldirgan ${i}`, longContent(0, i))).id);
    await warmPropertyKbVectors(b.propertyId);
    await __awaitSemanticWarm();
    const B_Q = "Dairedeki 3. bilgi notu nedir?";
    expect((await ask(b.propertyId, B_Q)).sem).toBe("ok");

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });

    // 1) A gerçek kancayla, kişi başı yazma sınırı (300 / dk = 5 / sn) içinde düzenler; her tur 30 kalem, tur sonunda gecikme dolar.
    // 2) Her 10 A düzenlemesinde bir B misafir sorusu: 'ok', soru başına tek gömme isteği.
    let round = 0;
    let lastGranted = 0;
    let aEmbedded = 0;
    for (round = 1; round <= 8; round++) {
      for (let i = 0; i < aIds.length; i++) {
        await prisma.knowledgeBaseItem.update({ where: { id: aIds[i] }, data: { content: longContent(round, i) } });
        await afterKbItemsChanged({ organizationId: a.orgId, propertyIds: [a.propertyId] });
        await vi.advanceTimersByTimeAsync(200);
        if (i % 10 === 9) {
          await settle(30);
          calls.length = 0;
          // Her seferinde başka soru: aynı soru sağlayıcının süreç önbelleğinden gelir (0 istek — doğru ama burada ölçü değil).
          const bAnswer = await ask(b.propertyId, `Dairedeki ${10 + ((round * 3 + i) % 30)}. bilgi notu nedir, round ${round} soru ${i}?`);
          expect(bAnswer.sem).toBe("ok");
          expect(calls.length).toBe(1);
          expect(chunkTexts()).toEqual([]);
          calls.length = 0;
        }
      }
      // 3) A ikinci turdayken B Wi-Fi şifresini değiştirir → gecikme + ısıtma içinde B 'ok', istemde yeni şifre, eski yok.
      if (round === 2) {
        await prisma.knowledgeBaseItem.update({ where: { id: bWifi.id }, data: { content: wifiText(NEW) } });
        await afterKbItemsChanged({ organizationId: b.orgId, propertyIds: [b.propertyId] });
      }
      await vi.advanceTimersByTimeAsync(20_000); // son kayıttan 20 sn: gecikmeli ısıtmalar koşar
      await settle();
      const got = chunkTexts().filter((t) => t.startsWith("general · Saldirgan")).length;
      if (round === 2) {
        const bNow = await ask(b.propertyId, "Wi-Fi şifresi ne?");
        expect(bNow.sem).toBe("ok");
        expect(bNow.block).toContain(NEW);
        expect(bNow.block).not.toContain(OLD);
      }
      calls.length = 0;
      if (got === 0) break; // A'nın bu turu reddedildi: işletme kovası doldu
      aEmbedded += got;
      lastGranted = round;
    }
    console.log(`§4 A tur=${round} verilen=${lastGranted} gömülen=${aEmbedded} A kova=${await counter(`kb-embed-org:${a.orgId}`)}`);
    expect(round).toBeLessThan(8);
    expect(aEmbedded).toBeLessThanOrEqual(600);
    expect(await counter(`kb-embed-org:${a.orgId}`)).toBe(aEmbedded);

    // 5) A'nın reddedilen işleri ortak kovanın sayacını ARTIRMAZ.
    const bgAfterSpree = await counter("kb-embed-bg");
    expect(bgAfterSpree).toBe(aEmbedded + (await counter(`kb-embed-org:${b.orgId}`)));

    // 4) "Başka kopya": süreç belleği sıfırlanır → sayaçlar DB'de: A'nın kovası dolu, B'ninki değil.
    restart();
    expect(await counter(`kb-embed-org:${a.orgId}`)).toBeGreaterThan(450);
    expect(await counter(`kb-embed-org:${b.orgId}`)).toBeLessThan(100);
    for (let i = 0; i < aIds.length; i++) {
      await prisma.knowledgeBaseItem.update({ where: { id: aIds[i] }, data: { content: longContent(50, i) } });
      await afterKbItemsChanged({ organizationId: a.orgId, propertyIds: [a.propertyId] });
    }
    await vi.advanceTimersByTimeAsync(20_000);
    await settle();
    expect(chunkTexts().filter((t) => t.startsWith("general · Saldirgan"))).toEqual([]);
    expect(await counter("kb-embed-bg")).toBe(bgAfterSpree);
    calls.length = 0;
    const bAfterRestart = await ask(b.propertyId, B_Q); // bellek boş → kalıcı depodan
    expect(bAfterRestart.sem).toBe("ok");
    expect(chunkTexts()).toEqual([]);

    // 6) Ortak arka plan kovası doluyken B'nin sorgu gömmesi yapılır (misafir payı: sıcak yol kovaya bakmaz).
    await prisma.rateLimitCounter.update({ where: { key: "kb-embed-bg" }, data: { count: 2_000 } });
    calls.length = 0;
    expect((await ask(b.propertyId, "Dairedeki 7. bilgi notu nedir?")).sem).toBe("ok");
    expect(calls.length).toBe(1);

    // 7) A'nın kendi son sürümü: cold → güncel kayıtta sözcüksel, eski içerik istemde yok.
    const aNow = await ask(a.propertyId, "Tur kalem satır kullanım bilgisi nedir?");
    expect(aNow.sem).toBe("cold");
    expect(aNow.block).toContain("Tur 50 kalem");
    expect(aNow.block).not.toMatch(/Tur [1-8] kalem/);
  }, 300_000);
});
