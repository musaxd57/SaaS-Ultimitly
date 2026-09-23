import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })) }));
import { reportError } from "@/lib/report-error";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { selectKbForPrompt, retrievalQueries, EMBED_QUERY_MAX_CHARS } from "@/lib/ai/retrieval/select";
import { semanticRetrievalInfo } from "@/lib/ai/retrieval/flag";
import { thresholdTransform, SEMANTIC_COSINE_THRESHOLD, SEMANTIC_QUALIFY_MIN } from "@/lib/ai/retrieval/semantic";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import {
  prepareSemanticScores,
  __resetSemanticRetrieval,
  __awaitSemanticWarm,
  __semanticStoreSize,
  SEMANTIC_HOT_PATH_DEADLINE_MS,
  SEMANTIC_MAX_CHUNKS,
  WARM_TEXTS_PER_HOUR,
  __setChunkVectorCacheMaxForTests,
} from "@/lib/ai/embeddings/semantic-retrieval";
import { rerank, SEMANTIC_BONUS } from "@/lib/ai/retrieval/rerank";
import { getOrBuildKbIndex } from "@/lib/ai/retrieval/index-cache";
import { chunkItems, chunkKey } from "@/lib/ai/retrieval/chunker";
import { packKnowledgeBase } from "@/lib/ai/prompts";
import { makeSyntheticKb } from "../helpers/kb-retrieval-synthetic";
import { PARAPHRASES } from "../helpers/kb-paraphrase-set";
import { clearEmbeddingCache, embedTexts, retryPlan, EMBEDDING_DIMENSIONS, EMBEDDING_TOTAL_DEADLINE_MS } from "@/lib/ai/embeddings/provider";
import { buildKbEvidence } from "@/lib/ai/grounding";
import { neutralPadding } from "../helpers/kb-padding";

// ---------------------------------------------------------------------------
// ANLAMSAL ADAY KAYNAĞI — ÜRETİM YOLU (09-23). Ağ çağrısı `fetch` stub'ıyla; gömme SAHTE ama
// KAVRAM tabanlı (kelime paylaşmayan parafraz aynı kavram boyutuna düşer) → sözcüksel yöntemin
// yapısal açığı (parafraz) ile anlamsal kaynağın kapattığı şey ayrı ayrı gözlemlenir.
// ---------------------------------------------------------------------------

const CONCEPTS: [RegExp, number][] = [
  [/kombi|ısıt|isit|üşü|usu|ılık|ilik|heating|freezing/i, 0],
  [/otopark|araba|araç|parking|car\b/i, 1],
  [/çamaşır|camasir|laundry|washing/i, 2],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** Kavram boyutları + metne özgü küçük gürültü (kavramsız metinler birbirine benzemesin). */
function fakeVec(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const [re, dim] of CONCEPTS) if (re.test(text)) v[dim] = 1;
  v[100 + (hash(text) % 1400)] += 0.3;
  return v;
}

interface FetchCall {
  input: string[];
}

function embeddingFetch(calls: FetchCall[], opts: { fail?: number } = {}) {
  return vi.fn(async (_url: string, init: { body: string }) => {
    const { input } = JSON.parse(init.body) as { input: string[] };
    calls.push({ input });
    if (opts.fail) return { ok: false, status: opts.fail, headers: new Headers(), text: async () => "{}", json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ data: input.map((t, index) => ({ index, embedding: fakeVec(t) })) }),
    };
  });
}

const T0 = Date.UTC(2026, 0, 1);
const HEATING = {
  id: "kb_heating",
  category: "general",
  title: "Isıtma",
  content: "Kombi koridordaki dolabın içindedir; termostat salonda, 22 dereceye ayarlıdır.",
  // En eski kalem: legacy'nin "en yeni 30" geri çekilmesine GİRMEZ.
  updatedAt: new Date(T0 - 365 * 86_400_000),
};
const PARKING = {
  id: "kb_parking",
  category: "general",
  title: "Otopark",
  content: "Otopark bina altında, B2 katında; 14 numaralı yer size ayrılmıştır.",
  updatedAt: new Date(T0 - 364 * 86_400_000),
};
const LAUNDRY = {
  id: "kb_laundry",
  category: "general",
  title: "Çamaşır",
  content: "Çamaşır makinesi banyodadır; deterjan lavabonun altındaki dolaptadır.",
  updatedAt: new Date(T0 - 363 * 86_400_000),
};
const PARAPHRASE = "Gece çok üşüdük, evi ılık yapabilir miyiz?";

function bigKb(padding = 35) {
  return [...neutralPadding(padding, T0), HEATING, PARKING, LAUNDRY];
}

let calls: FetchCall[];
const mockReport = vi.mocked(reportError);

beforeEach(() => {
  __resetSemanticRetrieval();
  __resetKbIndexCache();
  clearEmbeddingCache();
  calls = [];
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
  vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("anahtar KAPALI (varsayılan) — davranış birebir eski", () => {
  it("varsayılan kapalı; tanınmayan değer de KAPALI (gürültülü, ama açmaz)", () => {
    expect(semanticRetrievalInfo()).toEqual({ enabled: false, raw: "", recognized: true });
    vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "ture");
    expect(semanticRetrievalInfo()).toMatchObject({ enabled: false, recognized: false });
    vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
    expect(semanticRetrievalInfo().enabled).toBe(true);
  });

  it("🚨 kapalıyken ağa ÇIKMAZ ve sonuç selectKbForPrompt ile AYNI (kanıtta yeni alan yok)", async () => {
    const f = embeddingFetch(calls);
    vi.stubGlobal("fetch", f);
    const input = { items: bigKb(), guestMessage: "Otopark nerede?", history: [] };
    const viaWrapper = await retrieveKbForPrompt(input);
    const direct = selectKbForPrompt(input);
    expect(f).not.toHaveBeenCalled();
    expect(viaWrapper.evidence).not.toHaveProperty("sem");
    expect({ ...viaWrapper, evidence: { ...viaWrapper.evidence, ms: 0 } }).toEqual({ ...direct, evidence: { ...direct.evidence, ms: 0 } });
  });

  it("acil durdurma (KB_RETRIEVAL_MODE=legacy) anlamsal anahtarı da kapatır", async () => {
    vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    const f = embeddingFetch(calls);
    vi.stubGlobal("fetch", f);
    const r = await retrieveKbForPrompt({ items: bigKb(), guestMessage: PARAPHRASE });
    expect(f).not.toHaveBeenCalled();
    expect(r.mode).toBe("legacy");
  });
});

describe("anahtar AÇIK — sözcüksel açığı (parafraz) kapatır", () => {
  beforeEach(() => vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1"));

  it("KONTROL: sözcüksel yol parafrazda cevabı BULAMAZ (kelime ortak değil; eski kalem geri çekilmeye de girmez)", async () => {
    vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "");
    const r = await retrieveKbForPrompt({ items: bigKb(), guestMessage: PARAPHRASE });
    expect(r.items.map((i) => i.id)).not.toContain(HEATING.id);
  });

  /** Parça vektörleri YALNIZ arka planda üretilir: ilk karar soğuk, ısınma bitince sıcak. */
  async function warm(items: ReturnType<typeof bigKb>, msg = PARAPHRASE) {
    const first = await retrieveKbForPrompt({ items, guestMessage: msg });
    expect(first.evidence).toMatchObject({ sem: "cold" });
    await __awaitSemanticWarm();
  }

  it("🚨 anlamsal puan seçiciye ULAŞIR: cevap kalemi seçilir, kanıtta semantic + sem:ok", async () => {
    vi.stubGlobal("fetch", embeddingFetch(calls));
    await warm(bigKb());
    calls.length = 0;
    const r = await retrieveKbForPrompt({ items: bigKb(), guestMessage: PARAPHRASE });
    expect(r.selection).toBe("retrieved");
    expect(r.items[0].id).toBe(HEATING.id);
    expect(r.evidence).toMatchObject({ fb: "none", sem: "ok", fus: "rrf" });
    expect(r.evidence?.srcs).toContain("semantic");
    // Sıcak yolda TEK çağrı ve YALNIZ sorgu metinleri. Virgül cümleyi iki alt sorguya böler; ikisi de ait
    // oldukları HAM cümleyle sorulur (Türkçe karakterler korunur) + kendileriyle.
    expect(calls).toEqual([{ input: [PARAPHRASE, "gece cok usuduk", "evi ilik yapabilir miyiz"] }]);
  });

  it("🚨 SOĞUK KB misafiri BEKLETMEZ ve parça gömmesi sıcak yola ASLA girmez: ilk karar sözcüksel, parçalar arka planda", async () => {
    vi.stubGlobal("fetch", embeddingFetch(calls));
    const items = bigKb(80); // 83 parça
    const first = await retrieveKbForPrompt({ items, guestMessage: PARAPHRASE });
    expect(first.evidence).toMatchObject({ sem: "cold" });
    expect(first.evidence?.srcs).not.toContain("semantic");
    await __awaitSemanticWarm();
    expect(__semanticStoreSize()).toBe(items.length); // her kalem tek parça
    // Isınma çağrıları yalnız parça metni taşır (sorgu yok); sıcak yol yalnız sorgu.
    expect(calls.every((c) => !c.input.includes(PARAPHRASE))).toBe(true);
    const second = await retrieveKbForPrompt({ items, guestMessage: PARAPHRASE });
    expect(second.evidence).toMatchObject({ sem: "ok" });
    expect(second.items[0].id).toBe(HEATING.id);
    expect(calls[calls.length - 1].input).toEqual([PARAPHRASE, "gece cok usuduk", "evi ilik yapabilir miyiz"]);
  });

  it("🚨 YAVAŞ sağlayıcı KB'yi kalıcı olarak kör BIRAKMAZ (inceleme 09-23): sıcak yol bütçeyi aşsa da ısınma tamamlanır", async () => {
    // İlk sürüm eksik parçaları sorguyla aynı 1,5 sn'lik çağrıda gömüyordu: çağrı düşünce parçalar ısıtmaya
    // hiç gitmiyor, KB her mesajda `unavailable` kalıyordu. Şimdi ısınma TAM bütçeyle arka planda koşar.
    const DELAY = SEMANTIC_HOT_PATH_DEADLINE_MS + 200;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: { body: string; signal?: AbortSignal }) =>
          new Promise((resolve, reject) => {
            const { input } = JSON.parse(init.body) as { input: string[] };
            const t = setTimeout(
              () => resolve({ ok: true, status: 200, headers: new Headers(), json: async () => ({ data: input.map((x, index) => ({ index, embedding: fakeVec(x) })) }) }),
              DELAY,
            );
            init.signal?.addEventListener("abort", () => {
              clearTimeout(t);
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      ),
    );
    const items = bigKb();
    expect((await retrieveKbForPrompt({ items, guestMessage: PARAPHRASE })).evidence).toMatchObject({ sem: "cold" });
    await __awaitSemanticWarm();
    expect(__semanticStoreSize()).toBe(items.length);
    // Sorgu çağrısı sıcak yol bütçesini aşar → bu karar sözcüksel, ama depo DOLU (bir sonraki hızlı yanıt anlamsal olur).
    mockReport.mockClear();
    expect((await retrieveKbForPrompt({ items, guestMessage: PARAPHRASE })).evidence).toMatchObject({ sem: "unavailable" });
    expect(mockReport).not.toHaveBeenCalled(); // zaman aşımı geçici arızadır: çağrı başına alarm YOK
  }, 15_000);

  it("ikinci karar parça vektörlerini TEKRAR ödemez (depo); yalnız yeni sorgu gömülür", async () => {
    vi.stubGlobal("fetch", embeddingFetch(calls));
    await warm(bigKb());
    const stored = __semanticStoreSize();
    expect(stored).toBeGreaterThan(30);
    calls.length = 0;
    await retrieveKbForPrompt({ items: bigKb(), guestMessage: "Arabayı nereye bırakacağız?" });
    expect(calls).toEqual([{ input: ["Arabayı nereye bırakacağız?"] }]);
    expect(__semanticStoreSize()).toBe(stored);
  });

  it("aynı anda gelen kararlar aynı parçaları İKİ KEZ ödemez (ısınma tekilleştirilir)", async () => {
    vi.stubGlobal("fetch", embeddingFetch(calls));
    const items = bigKb();
    await Promise.all(Array.from({ length: 5 }, () => retrieveKbForPrompt({ items, guestMessage: PARAPHRASE })));
    await __awaitSemanticWarm();
    expect(calls.reduce((n, c) => n + c.input.length, 0)).toBe(items.length);
  });

  it("küçük KB (tamamı gider) → ağa ÇIKMAZ, kanıt sem:not_needed", async () => {
    const f = embeddingFetch(calls);
    vi.stubGlobal("fetch", f);
    const r = await retrieveKbForPrompt({ items: [HEATING, PARKING], guestMessage: PARAPHRASE });
    expect(f).not.toHaveBeenCalled();
    expect(r.selection).toBe("all");
    expect(r.evidence).toMatchObject({ fb: "small_kb", sem: "not_needed" });
  });

  it("🚨 ALT SORGU BAŞINA puan: iki sorulu mesajda her alt sorgunun en iyisi KENDİ konusu", async () => {
    vi.stubGlobal("fetch", embeddingFetch(calls));
    await warm(bigKb());
    const msg = "Gece çok üşüdük, evi ılık yapabilir miyiz? Çamaşır makinesi var mı?";
    const { queries } = retrievalQueries(msg, undefined, { embedTexts: true });
    expect(queries.map((q) => q.embedTexts)).toEqual([
      ["Gece çok üşüdük, evi ılık yapabilir miyiz?", "gece cok usuduk"],
      ["Gece çok üşüdük, evi ılık yapabilir miyiz?", "evi ilik yapabilir miyiz"],
      ["Çamaşır makinesi var mı?"], // kendi cümlesi — tüm mesajın karışık vektörü DEĞİL
    ]);
    const prep = await prepareSemanticScores({ items: bigKb(), guestMessage: msg });
    expect(prep.status).toBe("ok");
    const top = (sq: string) => [...prep.bySubquery!.get(sq)!.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    expect(top(queries[0].subquery)).toBe(`${HEATING.id}#0`);
    expect(top(queries[1].subquery)).toBe(`${HEATING.id}#0`);
    expect(top(queries[2].subquery)).not.toBe(`${HEATING.id}#0`);
  });

  it("seçicinin kendi yolu gömme metinlerini HESAPLAMAZ (anahtar kapalıyken ek iş yok)", () => {
    const { queries } = retrievalQueries("Gece çok üşüdük, evi ılık yapabilir miyiz? Çamaşır makinesi var mı?");
    expect(queries.map((q) => q.embedTexts)).toEqual([[], [], []]);
  });

  it("🚨 ÇOKLU SORGU = EN YÜKSEK benzerlik: virgülle ayrılan İKİ soruda her biri KENDİ konusunu, bağlamsız parçada cümle konusu bulur", async () => {
    vi.stubGlobal("fetch", embeddingFetch(calls));
    await warm(bigKb());
    const top = async (msg: string) => {
      const prep = await prepareSemanticScores({ items: bigKb(), guestMessage: msg });
      expect(prep.status).toBe("ok");
      return retrievalQueries(msg).queries.map((q) => [...prep.bySubquery!.get(q.subquery)!.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]);
    };
    // Aynı cümlede iki ayrı soru: cümle vektörü İKİ konunun karışımı; alt sorgunun kendi metni ayırır.
    expect(await top("Arabayı nereye bırakırız, çamaşır makinesi var mı?")).toEqual([`${PARKING.id}#0`, `${LAUNDRY.id}#0`]);
    // Tek sorunun iki cümleciği: "ne yapabiliriz" tek başına konusuz; cümle onu ısıtmaya bağlar.
    expect(await top("Çok üşüdük, ne yapabiliriz?")).toEqual([`${HEATING.id}#0`, `${HEATING.id}#0`]);
  });

  it("depo bir KB'yi tutamazsa (tahliye) YARIM HARİTA verilmez → ısınmadan sonra da cold, seçim sözcüksel", async () => {
    vi.stubGlobal("fetch", embeddingFetch(calls));
    __setChunkVectorCacheMaxForTests(20); // 38 parçalık KB sığmaz
    await warm(bigKb());
    const r = await retrieveKbForPrompt({ items: bigKb(), guestMessage: PARAPHRASE });
    expect(r.evidence).toMatchObject({ sem: "cold" });
    expect(r.evidence?.srcs).not.toContain("semantic");
  });

  it("GEÇİCİ sağlayıcı arızası (429/500) → sem:unavailable, seçim sözcüksel, FIRLATMAZ ve çağrı başına ALARM YOK", async () => {
    for (const status of [429, 500]) {
      __resetSemanticRetrieval();
      clearEmbeddingCache();
      // Isınma sırasında geçici arıza: alarm YOK, depo boş kalır (sonraki kararda yeniden denenir).
      mockReport.mockClear();
      vi.stubGlobal("fetch", embeddingFetch(calls, { fail: status }));
      await warm(bigKb());
      expect(__semanticStoreSize()).toBe(0);
      expect(mockReport, `ısınma ${status}`).not.toHaveBeenCalled();
      vi.stubGlobal("fetch", embeddingFetch(calls));
      await warm(bigKb());
      mockReport.mockClear();
      vi.stubGlobal("fetch", embeddingFetch(calls, { fail: status }));
      const input = { items: bigKb(), guestMessage: "Otopark nerede?" };
      for (let i = 0; i < 3; i++) {
        const r = await retrieveKbForPrompt(input);
        expect(r.evidence, String(status)).toMatchObject({ sem: "unavailable" });
        expect(r.items.map((x) => x.id)).toEqual(selectKbForPrompt(input).items.map((x) => x.id));
      }
      expect(mockReport, String(status)).not.toHaveBeenCalled();
    }
  });

  it("parça tavanını aşan KB → ağa çıkmadan unavailable (sürekli yeniden ısıtma = sessiz maliyet)", async () => {
    const f = embeddingFetch(calls);
    vi.stubGlobal("fetch", f);
    const r = await retrieveKbForPrompt({ items: bigKb(SEMANTIC_MAX_CHUNKS + 5), guestMessage: PARAPHRASE });
    expect(f).not.toHaveBeenCalled();
    expect(r.evidence).toMatchObject({ sem: "unavailable" });
  });

  it("arka plan ısıtmasının SAATLİK tavanı: aşan KB ısıtılmaz", async () => {
    vi.stubGlobal("fetch", embeddingFetch(calls));
    const per = 700;
    for (let k = 0; k < 3; k++) {
      const items = neutralPadding(per, T0 - k * 10_000_000_000).map((p) => ({ ...p, id: `k${k}_${p.id}`, title: `${p.title} k${k}` }));
      await retrieveKbForPrompt({ items, guestMessage: PARAPHRASE });
      await __awaitSemanticWarm();
    }
    expect(2 * per).toBeLessThanOrEqual(WARM_TEXTS_PER_HOUR);
    expect(3 * per).toBeGreaterThan(WARM_TEXTS_PER_HOUR);
    expect(__semanticStoreSize()).toBe(2 * per);
  });
});

describe("anlamsal uyum bonusu (yeniden sıralama)", () => {
  it("anlamsal kaynak YOKKEN etkisi sıfır; eşik üstü puanla doğrusal", () => {
    const items = [HEATING, PARKING];
    const index = getOrBuildKbIndex(items);
    const ctx = { ownStems: new Set<string>(), expansionStems: new Set<string>(), bigrams: [], categoryHints: new Map() };
    const base = new Float64Array([0.5, 0.5]);
    const without = rerank(index.chunks, index.bm25.docs, base, () => true, ctx);
    expect(without.map((c) => c.score)).toEqual([0.5, 0.5]);
    const sem = new Float64Array([1, 0.2]); // 1 = tam uyum, 0.2 = eşik altı
    const withSem = rerank(index.chunks, index.bm25.docs, base, () => true, ctx, undefined, { scores: sem, qualifyMin: SEMANTIC_QUALIFY_MIN });
    expect(withSem[0].score).toBeCloseTo(0.5 + SEMANTIC_BONUS, 9);
    expect(withSem[1].score).toBeCloseTo(0.5, 9);
  });

  it("🚨 KÂHİN anlamsal sinyalle iki sorulu parafraz mesajında İKİ cevap da bloğa girer (100 kalem; bonus yokken %87 ölçüldü)", () => {
    const kb = makeSyntheticKb(100);
    const pool = [...kb.items].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const chunks = chunkItems(pool);
    const direct = kb.questions.filter((q) => q.kind === "tr");
    let ok = 0;
    let n = 0;
    for (const p of PARAPHRASES.filter((x) => x.lang === "tr" && !x.gold.startsWith("guide:")).slice(0, 40)) {
      const a = kb.questions.find((q) => q.topic === p.gold && q.kind === "tr");
      const b = direct.find((q) => a && !q.goldIds.some((g) => a.goldIds.includes(g)) && q.topic !== a.topic);
      if (!a || !b) continue;
      const text = `${p.text} Ayrıca ${b.text}`;
      const gold = new Set([...a.goldIds, ...b.goldIds]);
      const bySubquery = new Map(
        retrievalQueries(text).queries.map((q) => [
          q.subquery,
          new Map(chunks.map((c) => [chunkKey(c), thresholdTransform(gold.has(c.id) ? 0.9 : 0.1, 0.3)] as const).filter(([, v]) => v > 0)),
        ]),
      );
      const r = selectKbForPrompt({ items: pool, guestMessage: text, mode: "hybrid", semanticBySubquery: bySubquery });
      const block = packKnowledgeBase(r.items, r.droppedItems, r.selection, r.notes).text;
      n += 1;
      if (a.needles.some((x) => block.includes(x)) && b.needles.some((x) => block.includes(x))) ok += 1;
    }
    expect(n).toBeGreaterThanOrEqual(25);
    expect(ok / n).toBeGreaterThanOrEqual(0.9);
  });
});

describe("sözleşme parçaları", () => {
  it("eşik dönüşümü kesin artan ve eşdeğer: s ≥ t ⇔ s' ≥ SEMANTIC_QUALIFY_MIN; negatif/NaN puan üretmez", () => {
    for (const t of [0.3, SEMANTIC_COSINE_THRESHOLD, 0.5]) {
      let prev = -1;
      for (let i = 1; i <= 1000; i++) {
        const s = i / 1000;
        const v = thresholdTransform(s, t);
        expect(v).toBeGreaterThan(prev);
        prev = v;
        expect(v >= SEMANTIC_QUALIFY_MIN - 1e-12, `t=${t} s=${s}`).toBe(s >= t - 1e-12);
      }
    }
    expect(thresholdTransform(-0.2)).toBe(0);
    expect(thresholdTransform(Number.NaN)).toBe(0);
  });

  it("sorgu metni: tek alt sorguda HAM cümle (tavanlı), cevapsız önceki soru da ayrı sorgu", () => {
    const long = `Otopark ${"x".repeat(EMBED_QUERY_MAX_CHARS * 2)}`;
    expect(retrievalQueries(long, undefined, { embedTexts: true }).queries[0].embedTexts.map((t) => t.length)).toEqual([EMBED_QUERY_MAX_CHARS]);
    // Virgülle bölünen uzun cümlenin İKİNCİ metni (alt sorgunun kendisi) de tavanlı (inceleme 09-23).
    const longClause = retrievalQueries(`Otopark ${"y".repeat(9_000)}, wifi var mi?`, undefined, { embedTexts: true }).queries[0].embedTexts;
    expect(Math.max(...longClause.map((t) => t.length))).toBeLessThanOrEqual(EMBED_QUERY_MAX_CHARS);
    const { queries, pending } = retrievalQueries(
      "Çamaşır makinesi var mı?",
      [
        { direction: "outbound", body: "Hoş geldiniz" },
        { direction: "inbound", body: "Otopark nerede?" },
      ],
      { embedTexts: true },
    );
    expect(pending).toBe(1);
    expect(queries.map((q) => q.embedTexts)).toEqual([["Çamaşır makinesi var mı?"], ["Otopark nerede?"]]);
  });

  it("cevapsız önceki mesaj güncel soruyu TEKRARLIYORSA ikinci sorgu açılmaz (bütçe ve gömme boşa gitmez)", () => {
    const { queries, pending } = retrievalQueries("Otopark nerede?", [
      { direction: "outbound", body: "Hoş geldiniz" },
      { direction: "inbound", body: "otopark nerede" }, // farklı yazım, AYNI alt sorgu
    ]);
    expect(pending).toBe(0);
    expect(queries.map((q) => q.subquery)).toEqual(["otopark nerede"]);
  });

  it("sıcak yol bütçesi toplam tavanı aşamaz; kısa bütçe tekrar denemeyi keser", () => {
    expect(SEMANTIC_HOT_PATH_DEADLINE_MS).toBeLessThan(EMBEDDING_TOTAL_DEADLINE_MS);
    // Varsayılan bütçede 1,4 sn sonra 200 ms bekleme sığar; 1,5 sn bütçede sığmaz.
    expect(retryPlan({ attempt: 1, status: 500, elapsedMs: 1_400 }).retry).toBe(true);
    expect(retryPlan({ attempt: 1, status: 500, elapsedMs: 1_400, deadlineMs: 1_500 }).retry).toBe(false);
    // Tavandan büyük bütçe istense de toplam tavan geçerli.
    expect(retryPlan({ attempt: 1, status: 500, elapsedMs: EMBEDDING_TOTAL_DEADLINE_MS - 100, deadlineMs: 60_000 }).retry).toBe(false);
  });

  it("🚨 kısa bütçe embedTexts'te GERÇEKTEN uygulanır: 503'te 300 ms bütçe 2 deneme, varsayılan 3", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { n += 1; return new Response("{}", { status: 503 }); }));
    expect(await embedTexts(["x"], { deadlineMs: 300 })).toBeNull();
    expect(n).toBe(2); // 0 ms dene → 200 ms bekle → dene → 400 ms bekleme bütçeyi aşar
    n = 0;
    expect(await embedTexts(["y"])).toBeNull();
    expect(n).toBe(3);
  });

  it("kanıt: sem/semMs/fus kapalı kümeyle taşınır, tanınmayan değer DÜŞER", () => {
    const base = { mode: "hybrid" as const, q: 1, fb: "none", sel: 2, cand: 40, ms: 1.2 };
    const ok = JSON.parse(buildKbEvidence({ retrieved: [], usedLabels: [], retrieval: { ...base, fus: "rrf", sem: "ok", semMs: 12.345 } })!);
    expect(ok.retrieval).toMatchObject({ fus: "rrf", sem: "ok", semMs: 12.3 });
    const bad = JSON.parse(buildKbEvidence({ retrieved: [], usedLabels: [], retrieval: { ...base, fus: "x", sem: "Ahmet Bey", semMs: -1 } })!);
    expect(bad.retrieval).not.toHaveProperty("sem");
    expect(bad.retrieval).not.toHaveProperty("fus");
    expect(bad.retrieval).not.toHaveProperty("semMs");
  });
});
