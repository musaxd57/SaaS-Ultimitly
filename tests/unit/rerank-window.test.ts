import { describe, it, expect } from "vitest";
import {
  rerankCandidateKeys,
  rerankCandidateWindows,
  unionTopCandidates,
  RERANK_FALLBACK_CANDIDATES,
  RERANK_MAX_CALLS,
  RERANK_MAX_CANDIDATES,
  RERANK_OWN_CANDIDATES,
  RERANK_PER_REQUEST_CANDIDATES,
} from "@/lib/ai/semantic/rerank";
import { retrievalQueries, selectKbForPrompt, type CandidateListMeta } from "@/lib/ai/retrieval/select";
import { understandingQueries } from "@/lib/ai/semantic/understanding-schema";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { neutralPadding } from "../helpers/kb-padding";

// ---------------------------------------------------------------------------
// #189 YENİDEN SIRALAYICI PENCERESİ SORU BAŞINA. Eski pencere (alt sorgu listelerinden sırayla ilk 20) iki sorulu mesajda
// cevabın çoğunu dışarıda bırakıyordu (mesaj 6–8 listeye bölünüyor, liste başına ~3 aday). Sözleşme: anlama isteği
// indeksli listeler istek başına RRF ile tek sıraya iner, her istek kendi payını alır; deterministik listeler taban.
// ---------------------------------------------------------------------------

const L = (prefix: string, n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i + from}#0` }));

describe("rerankCandidateKeys", () => {
  it("anlama isteği yoksa: sırayla birleşim, genişlik RERANK_FALLBACK_CANDIDATES", () => {
    const lists = [L("a", 60), L("b", 60)];
    expect(rerankCandidateKeys(lists, [{ extra: false }, { extra: false }])).toEqual(unionTopCandidates(lists, RERANK_FALLBACK_CANDIDATES));
    expect(rerankCandidateKeys(lists)).toEqual(unionTopCandidates(lists, RERANK_FALLBACK_CANDIDATES));
  });

  it("iki istek: her biri KENDİ sorgularının ilk RERANK_PER_REQUEST_CANDIDATES adayını alır (derin sıradaki cevap da girer)", () => {
    // Özgün listeler iki soruyu karıştıran parçalar; istek 1'in cevabı "q1_" listelerinde 35. sırada, istek 2'ninki 30.
    const own = [L("o", 50), L("p", 50)];
    const req1 = [L("q1_", 50), L("q1_", 50)]; // Türkçe + özgün dil sorgusu aynı sırayı üretmiş
    const req2 = [L("q2_", 50)];
    const lists = [...own, ...req1, ...req2];
    const meta: CandidateListMeta[] = [{ extra: false }, { extra: false }, { extra: true, request: 0 }, { extra: true, request: 0 }, { extra: true, request: 1 }];
    const keys = rerankCandidateKeys(lists, meta);
    expect(keys).toContain("q1_35#0");
    expect(keys).toContain("q2_30#0");
    expect(keys.filter((k) => k.startsWith("q1_"))).toHaveLength(RERANK_PER_REQUEST_CANDIDATES);
    expect(keys.filter((k) => k.startsWith("q2_"))).toHaveLength(RERANK_PER_REQUEST_CANDIDATES);
    // Taban: deterministik listelerden sırayla RERANK_OWN_CANDIDATES.
    expect(keys.filter((k) => k.startsWith("o") || k.startsWith("p"))).toEqual(unionTopCandidates(own, RERANK_OWN_CANDIDATES));
    expect(new Set(keys).size).toBe(keys.length);
    // ESKİ pencere (sırayla ilk 20) bu iki cevabı taşımıyordu.
    const old = unionTopCandidates(lists, 20);
    expect(old).not.toContain("q1_35#0");
    expect(old).not.toContain("q2_30#0");
  });

  it("aynı istek içindeki listeler RRF ile birleşir (iki sorguda da yüksek aday önce)", () => {
    const lists = [
      [{ key: "x#0" }, { key: "y#0" }, { key: "z#0" }],
      [{ key: "z#0" }, { key: "w#0" }],
    ];
    const keys = rerankCandidateKeys(lists, [
      { extra: true, request: 0 },
      { extra: true, request: 0 },
    ]);
    // z iki listede (1/63 + 1/61) → önce; y ve w eşit (1/62) → ilk görülen (y) önce.
    expect(keys).toEqual(["z#0", "x#0", "y#0", "w#0"]);
  });

  it("üç istek: üç pencere, her biri kendi 40'ı; beş istekte çağrı tavanı (3) — kovadaki istekler payı bölüşür; isteği bilinmeyen ek liste tabana girer", () => {
    const three = [L("o", 30), L("a", 60), L("b", 60), L("c", 60), L("u", 30)];
    const meta3: CandidateListMeta[] = [{ extra: false }, { extra: true, request: 0 }, { extra: true, request: 1 }, { extra: true, request: 2 }, { extra: true }];
    const wins = rerankCandidateWindows(three, meta3);
    expect(wins).toHaveLength(3);
    expect(wins[0].filter((k) => k.startsWith("a"))).toHaveLength(RERANK_PER_REQUEST_CANDIDATES);
    expect(wins[2].filter((k) => k.startsWith("c"))).toHaveLength(RERANK_PER_REQUEST_CANDIDATES);
    for (const w of wins) {
      expect(w.some((k) => k.startsWith("u"))).toBe(true); // isteği bilinmeyen ek liste → taban
      expect(w.length).toBeLessThanOrEqual(RERANK_MAX_CANDIDATES);
      expect(new Set(w).size).toBe(w.length);
    }
    const five = [L("o", 30), ...["a", "b", "c", "d", "e"].map((p) => L(p, 60))];
    const meta5: CandidateListMeta[] = [{ extra: false }, ...[0, 1, 2, 3, 4].map((r) => ({ extra: true, request: r }))];
    const w5 = rerankCandidateWindows(five, meta5);
    expect(w5).toHaveLength(RERANK_MAX_CALLS);
    // İlk kova istek 0 ve 3'ü taşır → her biri yarım pay.
    expect(w5[0].filter((k) => k.startsWith("a"))).toHaveLength(RERANK_PER_REQUEST_CANDIDATES / 2);
    expect(w5[0].filter((k) => k.startsWith("d"))).toHaveLength(RERANK_PER_REQUEST_CANDIDATES / 2);
    expect(rerankCandidateKeys(five, meta5)).toEqual([...new Set(w5.flat())]);
  });
});

describe("anlama sorgusu deterministik alt sorguyla BİREBİR aynıysa (çakışma)", () => {
  // Ölçüm (09-26 gece, gerçekçi 276 kalemlik dev set): anlama katmanının Türkçe sorgusu kısa sorularda mesajın kendi alt
  // sorgusuyla harfiyen aynı çıkabiliyor; sorgu ikinci kez eklenmediği için o SORU kendi penceresini alamıyor, cevabı yalnız
  // 10'luk tabandan gelebiliyordu. Artık o deterministik liste isteğe işaretlenir.
  const extra = [
    { text: "askılık nerede", turkish: true, request: 0 },
    { text: "kumanda pili", turkish: true, request: 1 },
  ];

  it("sorgu ikinci kez EKLENMEZ; deterministik alt sorgu isteğe işaretlenir (ek sorgu sayısı değişmez)", () => {
    const r = retrievalQueries("Askılık nerede? Bir de kumanda pili var mı?", undefined, { extraQueries: extra });
    expect(r.queries.map((q) => q.subquery)).toEqual(["askilik nerede", "kumanda pili var mi", "kumanda pili"]);
    expect(r.queries.map((q) => q.request)).toEqual([0, undefined, 1]);
    expect(r.queries.map((q) => q.extra)).toEqual([undefined, undefined, true]);
    expect(r.extra).toBe(1);
  });

  it("ilk işaret kalır; geçersiz sıra (negatif / kesirli) işaretlemez", () => {
    const r = retrievalQueries("Askılık nerede?", undefined, {
      extraQueries: [
        { text: "askılık nerede", turkish: true, request: 2 },
        { text: "Askılık nerede", turkish: false, request: 3 },
      ],
    });
    expect(r.queries.map((q) => q.request)).toEqual([2]);
    for (const bad of [-1, 1.5]) {
      const b = retrievalQueries("Askılık nerede?", undefined, { extraQueries: [{ text: "askılık nerede", turkish: true, request: bad }] });
      expect(b.queries[0].request).toBeUndefined();
    }
  });

  it("🚨 işaretli deterministik liste o isteğin penceresine DERİNDEN girer (tabana değil); iki pencere", () => {
    const own = L("o", 50);
    const det0 = L("d", 50); // istek 0'a işaretli deterministik liste; cevap 30. sırada
    const req1 = L("q", 50);
    const wins = rerankCandidateWindows([det0, own, req1], [{ extra: false, request: 0 }, { extra: false }, { extra: true, request: 1 }]);
    expect(wins).toHaveLength(2);
    expect(wins[0]).toContain("d30#0");
    expect(wins[0].filter((k) => k.startsWith("d"))).toHaveLength(RERANK_PER_REQUEST_CANDIDATES);
    // Taban yalnız işaretsiz listeden.
    expect(wins[1].filter((k) => k.startsWith("o"))).toEqual(unionTopCandidates([own], RERANK_OWN_CANDIDATES));
    expect(wins[1].some((k) => k.startsWith("d"))).toBe(false);
    // KONTROL — işaret olmasa (eski davranış) istek 0'ın penceresi yok, cevap tabandan da gelmez.
    const old = rerankCandidateWindows([det0, own, req1], [{ extra: false }, { extra: false }, { extra: true, request: 1 }]);
    expect(old).toHaveLength(1);
    expect(old[0]).not.toContain("d30#0");
  });

  it("seçici işareti onCandidates kaynağına taşır", () => {
    __resetKbIndexCache();
    const items = [
      { id: "hanger", category: "general", title: "Salon", content: "Askılık salondaki dolabın yanındadır.", updatedAt: new Date(0) },
      { id: "battery", category: "general", title: "TV", content: "Kumanda pili TV dolabının çekmecesindedir.", updatedAt: new Date(0) },
      ...neutralPadding(40),
    ];
    let meta: readonly CandidateListMeta[] = [];
    selectKbForPrompt({ items, guestMessage: "Askılık nerede? Bir de kumanda pili var mı?", mode: "hybrid", extraQueries: extra, onCandidates: (_l, m) => (meta = m) });
    expect(meta).toEqual([{ extra: false, request: 0 }, { extra: false }, { extra: true, request: 1 }]);
  });
});

describe("seçici → pencere bağlantısı: anlama isteği indeksi listelerin kaynağına kadar taşınır", () => {
  it("understandingQueries istek sırasını verir; onCandidates listelerle aynı sırada kaynak bilgisini iletir", () => {
    __resetKbIndexCache();
    const u = {
      language: "tr",
      requests: [
        { intent: "wifi", queryTr: "wifi şifresi", queryOriginal: "wifi şifresi" },
        { intent: "greeting_thanks", queryTr: "teşekkür", queryOriginal: "teşekkür" },
        { intent: "parking", queryTr: "otopark yeri", queryOriginal: "otopark yeri" },
      ],
    } as never;
    const extra = understandingQueries(u);
    expect(extra).toEqual([
      { text: "wifi şifresi", turkish: true, request: 0 },
      { text: "otopark yeri", turkish: true, request: 1 },
    ]);
    const items = [
      { id: "wifi", category: "wifi", title: "Wi-Fi", content: "Wi-Fi şifresi modemin altında.", updatedAt: new Date(0) },
      { id: "park", category: "parking", title: "Otopark", content: "Otopark bina altında.", updatedAt: new Date(0) },
      ...neutralPadding(40),
    ];
    let meta: readonly CandidateListMeta[] = [];
    selectKbForPrompt({ items, guestMessage: "İnternet ve araba için bilgi lazım", mode: "hybrid", extraQueries: extra, onCandidates: (_l, m) => (meta = m) });
    const qs = retrievalQueries("İnternet ve araba için bilgi lazım", undefined, { extraQueries: extra }).queries;
    expect(meta).toHaveLength(qs.length);
    expect(meta.filter((m) => m.extra).map((m) => m.request)).toEqual([0, 1]);
    // Çakışma yok: deterministik listeler işaretsiz.
    expect(meta.filter((m) => !m.extra).every((m) => m.request === undefined)).toBe(true);
  });
});

describe("pencere kuruluşu seçenekleri (#189 deneyi; verilmezse bugünkü kural)", () => {
  const lists = [L("o", 50), L("a", 50), L("b", 50)];
  const meta: CandidateListMeta[] = [{ extra: false }, { extra: true, request: 0 }, { extra: true, request: 1 }];

  it("seçenek verilmezse / boş nesne: birebir aynı", () => {
    expect(rerankCandidateWindows(lists, meta, {})).toEqual(rerankCandidateWindows(lists, meta));
  });

  it("perRequest: istek başına aday sayısı", () => {
    const w = rerankCandidateWindows(lists, meta, { perRequest: 50 });
    expect(w[0].filter((k) => k.startsWith("a"))).toHaveLength(50);
    expect(w[0]).toHaveLength(RERANK_MAX_CANDIDATES);
  });

  it("listFloor: tek listede ÖN sıradaki aday, iki listede birden orta sırada geçenlerin gerisine DÜŞMEZ", () => {
    const shared = L("s", 60);
    const withT = [...shared.slice(0, 2), { key: "t#0" }, ...shared.slice(2, 57)];
    const two = [withT, shared];
    const m2: CandidateListMeta[] = [{ extra: true, request: 0 }, { extra: true, request: 0 }];
    // KONTROL: saf RRF'de t (yalnız bir listede, 3. sıra) 40'lık pencerenin DIŞINDA.
    expect(rerankCandidateWindows(two, m2)[0]).not.toContain("t#0");
    expect(rerankCandidateWindows(two, m2, { listFloor: 10 })[0]).toContain("t#0");
  });

  it("ownFusion rrf: birkaç deterministik listede birden geçen aday tabana girer (sıra-sıra birleşim kaçırır)", () => {
    // Dört özgün listenin her birinde 6. sırada ortak aday "c"; kalanlar listeye özgü.
    const own = ["p", "q", "r", "u"].map((pfx) => [...L(pfx, 5), { key: "c#0" }, ...L(pfx, 20, 5)]);
    const all = [...own, L("a", 50)];
    const m: CandidateListMeta[] = [...own.map(() => ({ extra: false })), { extra: true, request: 0 }];
    expect(rerankCandidateWindows(all, m)[0]).not.toContain("c#0");
    expect(rerankCandidateWindows(all, m, { ownFusion: "rrf" })[0]).toContain("c#0");
  });

  it("own: taban aday sayısı", () => {
    const w = rerankCandidateWindows(lists, meta, { own: 20 });
    expect(w[0].filter((k) => k.startsWith("o"))).toHaveLength(20);
  });
});
