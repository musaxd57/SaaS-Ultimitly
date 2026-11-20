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
import { kbEmbedOrgKey } from "@/lib/ai/embeddings/embed-budget";

// ---------------------------------------------------------------------------
// KURUCUNUN İSTEDİĞİ İKİ YAYIN ÖNCESİ TEST (kurucu 11-20 sabah, E-1…E-5 AYNEN: "1. A işletmesi büyük dosya işlerken B'nin yeni düzenlediği
// bilgi tabanı kaydı da makul sürede işleniyor. B'nin hazır vektörleriyle arama yapabilmesi tek başına yeterli test değil. 2. Host Wi-Fi
// şifresini değiştirir değiştirmez eski şifre artık gönderilmiyor. Yeni vektör hazır değilse güncel kayıtta sözcüksel arama yapılıyor.")
// Anahtarlar AÇIK: kalıcı depo + pilot listesinde iki işletme (A, B) + D1 kovalar (600 / 2.000) + D2 gecikme (20 sn) + D3 temizlik.
// Sahte saat (setTimeout / clearTimeout / Date) — süre sanal saniyedir; ısıtmanın kendisi gerçek süredir (taklit sağlayıcı). DB gerçek.
// ---------------------------------------------------------------------------

const calls: string[][] = [];
const chunkTexts = () => calls.flat().filter((t) => /^(general|wifi)\b/.test(t));
const CONCEPTS: [RegExp, number][] = [
  [/kombi|ısıt|isit|üşü|usu|ılık|ilik/i, 0],
  [/wi-?fi|şifre|sifre|nternet/i, 1],
];
const vec = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const [re, dim] of CONCEPTS) if (re.test(text)) v[dim] = 1;
  v[10 + (h % (EMBEDDING_DIMENSIONS - 10))] += 0.3;
  return v;
};
const wifiText = (pass: string) => `Ağ adı: LaleNet. Şifre: ${pass}. Modem salondaki dolabın üstündedir.`;
const HEATING = "Kombi koridordaki dolabın içindedir; termostat salonda, 22 dereceye ayarlıdır.";
/** Kelime paylaşmayan parafraz: sözcüksel arama kombi kaydını bulamaz, yalnız anlamsal arama bulur. */
const PARAPHRASE = "Gece çok üşüdük, evi ılık yapabilir miyiz?";
const longContent = (round: number, i: number) =>
  Array.from({ length: 50 }, (_, k) => `Tur ${round} kalem ${i} satır ${k} kullanım bilgisi burada yer alıyor.`).join(" ");

async function createItem(propertyId: string, title: string, content: string, category = "general") {
  return prisma.knowledgeBaseItem.create({
    data: { propertyId, category, title, content, isActive: true, source: "host_manual", reviewState: "approved" },
    select: { id: true },
  });
}

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
  return {
    sem: r.evidence?.sem,
    fb: r.evidence?.fb,
    selection: r.selection,
    titles: r.items.map((i) => i.title),
    block: packKnowledgeBase(r.items, r.droppedItems, r.selection, r.notes).text,
  };
}

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
  // Kurucu kararı 11-20: 600 / 2.000 / 20 sn — değişkenler boş = bu varsayılanlar.
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

/** İki işletme, ikisi de pilot listesinde; B'nin bilgi tabanı (46 kalem + Wi-Fi) ısınmış, A'nın 30 uzun kalemi var. */
async function setup() {
  const a = await makeOrgWithProperty();
  const b = await makeOrgWithProperty();
  vi.stubEnv("KB_VECTOR_STORE_ORG_IDS", `${a.orgId},${b.orgId}`);
  for (let i = 0; i < 45; i++) await createItem(b.propertyId, `Bilgi ${i}`, `Dairedeki ${i}. bilgi notu.`);
  const bWifi = await createItem(b.propertyId, "Wi-Fi", wifiText("ESKI-4821"), "wifi");
  const aIds: string[] = [];
  for (let i = 0; i < 30; i++) aIds.push((await createItem(a.propertyId, `Saldirgan ${i}`, longContent(0, i))).id);
  await warmPropertyKbVectors(b.propertyId);
  await __awaitSemanticWarm();
  return { a, b, bWifi, aIds };
}

/** A'nın bir turu: 30 kalemi kişi başı yazma sınırı (300 / dk) içinde, gerçek kancayla düzenler. */
async function aRound(a: { orgId: string; propertyId: string }, aIds: readonly string[], round: number) {
  for (let i = 0; i < aIds.length; i++) {
    await prisma.knowledgeBaseItem.update({ where: { id: aIds[i] }, data: { content: longContent(round, i) } });
    await afterKbItemsChanged({ organizationId: a.orgId, propertyIds: [a.propertyId] });
    await vi.advanceTimersByTimeAsync(200);
  }
}

describe("yayın öncesi test 1 — A büyük dosya işlerken B'nin YENİ kaydı makul sürede anlamsal aramaya yansır", () => {
  it("B kombi kaydı ekler (A bütçeyi doldurmuş, hâlâ düzenliyor) → 20 sn gecikme + ısıtma içinde kelimesiz parafraz anlamsal aramayla kombi kaydını bulur", async () => {
    const { a, b, aIds } = await setup();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    // A bütçeyi doldurur: işletme kovası 600 dolana kadar turlar (sonraki tur reddedilir).
    for (let round = 1; round <= 5; round++) {
      await aRound(a, aIds, round);
      await vi.advanceTimersByTimeAsync(20_000);
      await settle();
    }
    expect((await prisma.rateLimitCounter.findUnique({ where: { key: kbEmbedOrgKey(a.orgId) } }))?.count).toBe(600);

    // ÖNCE: parafraz kombi kaydını bulamaz (kayıt yok).
    expect((await ask(b.propertyId, PARAPHRASE)).titles).not.toContain("Isıtma");

    // B YENİ kaydı ekler; A aynı anda yeni bir tur işler (bütçesi dolu, reddedilir). Bu sürede B'ye soru SORULMAZ: soru soğuk dalda ısıtmayı
    // hemen başlatır (aşağıda ayrıca ölçülür) — burada yalnız arka plan yolu (gecikme + ısıtma) ölçülür.
    const heating = await createItem(b.propertyId, "Isıtma", HEATING);
    await afterKbItemsChanged({ organizationId: b.orgId, propertyIds: [b.propertyId] });
    const savedAt = Date.now(); // sahte saat
    await aRound(a, aIds, 6);
    await settle();
    // Isıtmanın bitişi = kaydın parça satırı kalıcı depoda (pilot işletme).
    let reflectedAfterMs: number | null = null;
    let realMs = 0;
    for (let s = 0; s < 120 && reflectedAfterMs === null; s++) {
      if ((await prisma.kbChunkVector.count({ where: { kbItemId: heating.id } })) > 0) {
        reflectedAfterMs = Date.now() - savedAt;
        break;
      }
      await vi.advanceTimersByTimeAsync(1_000);
      const t0 = performance.now();
      await settle(30);
      realMs += performance.now() - t0;
    }
    const after = await ask(b.propertyId, PARAPHRASE);
    console.log(
      `YAYIN-ONCESI-1 arka plan yansıma=${reflectedAfterMs} ms sanal (20 sn gecikme dahil; ısıtma + bekleme gerçek ≈ ${Math.round(realMs)} ms, ` +
        `taklit sağlayıcı) · sonra sem=${after.sem} fb=${after.fb} seçim=${after.selection}`,
    );
    expect(reflectedAfterMs).not.toBeNull();
    expect(reflectedAfterMs!).toBeGreaterThanOrEqual(20_000);
    expect(reflectedAfterMs!).toBeLessThanOrEqual(22_000);
    // Anlamsal arama (sözcüksel geri çekilme değil) yeni kaydı SEÇER.
    expect(after.sem).toBe("ok");
    expect(after.fb).toBe("none");
    expect(after.selection).toBe("retrieved");
    expect(after.titles).toContain("Isıtma");
    // A'nın yeni turu hâlâ reddedilmiş (kendi kovası dolu): B'nin yansıması A'yı beklemedi.
    expect(chunkTexts().filter((t) => t.startsWith("general · Saldirgan") && t.includes("Tur 6 kalem"))).toEqual([]);
    // Kurucunun izleyeceği sayı olay günlüğünde: B'nin KAYDETME ANI → ısıtmanın bitişi (`job.kb_embed.ready`; sert kontrol 11-20 A2'den beri
    // ölçü kaydetme anından başlar — iki uç da uygulamanın saati, sahte saatle de doğrudan "kayıt → yansıma").
    const ev = await prisma.operationalEvent.findMany({ where: { event: "job.kb_embed.ready", organizationId: b.orgId } });
    expect(ev).toHaveLength(1);
    const lag = (JSON.parse(ev[0].dataJson ?? "{}") as { durationMs?: number }).durationMs ?? -1;
    console.log(`YAYIN-ONCESI-1 olay günlüğü durationMs=${lag} (arka plan yansıma ${reflectedAfterMs} ms)`);
    expect(Math.abs(lag - reflectedAfterMs!)).toBeLessThan(1_500);

    // Misafir sorusu gecikmeyi BEKLEMEZ: B kaydı yeniden düzenler; ilk soru 'cold' (güncel kayıtta sözcüksel), soru ısıtmayı o anda başlatır,
    // sanal saat ilerlemeden sonraki soru 'ok' ve kombi kaydını seçer.
    await prisma.knowledgeBaseItem.update({ where: { id: heating.id }, data: { content: `${HEATING} Kombi şifresi yoktur.` } });
    await afterKbItemsChanged({ organizationId: b.orgId, propertyIds: [b.propertyId] });
    const first = await ask(b.propertyId, PARAPHRASE);
    await settle();
    const second = await ask(b.propertyId, PARAPHRASE);
    console.log(`YAYIN-ONCESI-1 soru tetiklemeli: ilk=${first.sem} sonraki=${second.sem} (sanal süre 0)`);
    expect(first.sem).toBe("cold");
    expect(second.sem).toBe("ok");
    expect(second.titles).toContain("Isıtma");
  }, 300_000);
});

describe("yayın öncesi test 2 — Wi-Fi şifresi değişir değişmez eski şifre gönderilmez; vektör hazır değilse güncel kayıtta sözcüksel", () => {
  it("kayıttan hemen sonra, gecikme süresince, ısındıktan sonra ve başka kopyada: istem bloğunda YENİ şifre var, ESKİ hiç yok", async () => {
    const { b, bWifi } = await setup();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const warmBefore = await ask(b.propertyId, "Wi-Fi şifresi ne?");
    expect(warmBefore.sem).toBe("ok");
    expect(warmBefore.block).toContain("ESKI-4821");

    await prisma.knowledgeBaseItem.update({ where: { id: bWifi.id }, data: { content: wifiText("YENI-7305") } });
    await afterKbItemsChanged({ organizationId: b.orgId, propertyIds: [b.propertyId] });
    const checks: { at: string; sem?: string }[] = [];
    const check = async (at: string, msg: string) => {
      const r = await ask(b.propertyId, msg);
      checks.push({ at, sem: r.sem });
      expect(r.block, at).toContain("YENI-7305");
      expect(r.block, at).not.toContain("ESKI-4821");
      return r;
    };
    // Hemen (0 sn): yeni vektör yok → sözcüksel, güncel kayıt. (Bu soru ısıtmayı o anda başlatır; sonraki kararlar 'ok' olabilir — iddia
    // eski şifrenin HİÇBİR anda istem bloğunda olmamasıdır.)
    expect((await check("0 sn doğrudan", "Wi-Fi şifresi ne?")).sem).toBe("cold");
    await check("0 sn parafraz", "İnternete bağlanmak için ne yazmam gerekiyor?");
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    await check("10 sn", "Wi-Fi şifresi ne?");
    // Gecikme + ısıtma: anlamsal kaynak yeni metinle.
    await vi.advanceTimersByTimeAsync(11_000);
    await settle();
    expect((await check("21 sn", "Wi-Fi şifresi ne?")).sem).toBe("ok");
    expect((await check("21 sn parafraz", "İnternete bağlanmak için ne yazmam gerekiyor?")).sem).toBe("ok");
    // Başka kopya (bellek boş): kalıcı depodan okunur — eski satır yok.
    restart();
    expect((await check("başka kopya", "Wi-Fi şifresi ne?")).sem).toBe("ok");
    expect(await prisma.kbChunkVector.count({ where: { kbItemId: bWifi.id } })).toBe(1);
    console.log(`YAYIN-ONCESI-2 ${JSON.stringify(checks)}`);
  }, 120_000);

  it("işletme kovası doluyken şifre değişti → yeni vektör hiç üretilmez; karar 'cold', istemde YENİ şifre, ESKİ yok", async () => {
    const { b, bWifi } = await setup();
    await prisma.rateLimitCounter.update({ where: { key: kbEmbedOrgKey(b.orgId) }, data: { count: 600 } });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    calls.length = 0;
    await prisma.knowledgeBaseItem.update({ where: { id: bWifi.id }, data: { content: wifiText("YENI-9001") } });
    await afterKbItemsChanged({ organizationId: b.orgId, propertyIds: [b.propertyId] });
    await vi.advanceTimersByTimeAsync(21_000);
    await settle();
    expect(chunkTexts()).toEqual([]);
    const r = await ask(b.propertyId, "Wi-Fi şifresi ne?");
    expect(r.sem).toBe("cold");
    expect(r.block).toContain("YENI-9001");
    expect(r.block).not.toContain("ESKI-4821");
  }, 120_000);
});
