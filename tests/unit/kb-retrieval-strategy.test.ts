import { describe, it, expect, beforeEach, vi } from "vitest";
import { selectKbForPrompt, retrievalQueries } from "@/lib/ai/retrieval/select";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { neutralPadding } from "../helpers/kb-padding";
import { parseConfig } from "../eval/rag-lab/config";

// ---------------------------------------------------------------------------
// #189 SEÇİM STRATEJİSİ DENEY SEÇENEKLERİ (`strategy`, `rerankScoresBySubquery`). Sözleşme: VERİLMEDİKLERİNDE davranış
// BİREBİR bugünkü (üretim bunları vermez); verildiklerinde yalnız SIRA / PAKETLEME değişir — aday eklenmez, yetki/sürüm/çelişki
// kuralları aynen. Deneylerin ölçüm aracı `tests/eval/rag-lab`.
// ---------------------------------------------------------------------------

const t0 = Date.UTC(2026, 5, 1);
const NOW = Date.UTC(2026, 8, 26, 12);
const base = [
  { id: "wifi", category: "wifi", title: "Wi-Fi", content: "Wi-Fi ağı Lale-5G, şifre modemin altında.", updatedAt: new Date(t0) },
  { id: "wifi2", category: "wifi", title: "İnternet hızı", content: "İnternet hızı 100 Mbps; Wi-Fi modemi salonda.", updatedAt: new Date(t0 - 500) },
  { id: "park", category: "parking", title: "Otopark", content: "Binanın önünde ücretsiz açık otopark var.", updatedAt: new Date(t0 - 1000) },
  { id: "park2", category: "parking", title: "Otopark kuralı", content: "Otoparkta gece 23:00'ten sonra korna çalınmaz.", updatedAt: new Date(t0 - 1500) },
  ...neutralPadding(40),
];

describe("seçim stratejisi — varsayılan davranış birebir", () => {
  beforeEach(() => __resetKbIndexCache());

  it("strategy / rerankScoresBySubquery verilmezse sonuç aynı", () => {
    const a = selectKbForPrompt({ items: base, guestMessage: "Wi-Fi şifresi ne? Otopark var mı?", mode: "hybrid", now: NOW });
    __resetKbIndexCache();
    const b = selectKbForPrompt({ items: base, guestMessage: "Wi-Fi şifresi ne? Otopark var mı?", mode: "hybrid", now: NOW, strategy: {} });
    expect(b.items.map((i) => `${i.id}#${i.chunk ?? 0}`)).toEqual(a.items.map((i) => `${i.id}#${i.chunk ?? 0}`));
  });
});

describe("soru başına yeniden sıralayıcı puanı", () => {
  beforeEach(() => __resetKbIndexCache());

  it("her alt sorgu listesi KENDİ etiketiyle sıralanır (düz etiket tek soruya yığılır)", () => {
    const msg = "Wi-Fi şifresi ne? Otopark var mı?";
    const [q1, q2] = retrievalQueries(msg).queries.map((q) => q.subquery);
    // Düz etiket: yalnız wifi2 "cevap" → iki listede de öne çıkar; iki parçalık bütçede otopark cevabı düşebilir.
    const flat = selectKbForPrompt({ items: base, guestMessage: msg, mode: "hybrid", now: NOW, maxChunks: 2, rerankScores: new Map([["wifi2#0", 3]]) });
    __resetKbIndexCache();
    const per = selectKbForPrompt({
      items: base,
      guestMessage: msg,
      mode: "hybrid",
      now: NOW,
      maxChunks: 2,
      rerankScoresBySubquery: new Map([
        [q1, new Map([["wifi2#0", 3]])],
        [q2, new Map([["park2#0", 3]])],
      ]),
    });
    expect(per.items.map((i) => i.id)).toEqual(["wifi2", "park2"]);
    expect(flat.items.map((i) => i.id)[0]).toBe("wifi2");
  });

  it("verilmeyen alt sorguda düz puan geçerli", () => {
    const msg = "Wi-Fi şifresi ne? Otopark var mı?";
    const [q1] = retrievalQueries(msg).queries.map((q) => q.subquery);
    const r = selectKbForPrompt({
      items: base,
      guestMessage: msg,
      mode: "hybrid",
      now: NOW,
      maxChunks: 2,
      rerankScores: new Map([["park2#0", 3]]),
      rerankScoresBySubquery: new Map([[q1, new Map([["wifi2#0", 3]])]]),
    });
    expect(r.items.map((i) => i.id)).toEqual(["wifi2", "park2"]);
  });
});

describe("paketleme ve kalem başına parça", () => {
  beforeEach(() => __resetKbIndexCache());
  const long = "Otopark kuralı: " + Array.from({ length: 9 }, (_, i) => `Bu uzun bir otopark cümlesidir ve sayısı ${i + 1} olan ayrıntıyı anlatır. `.repeat(3)).join("\n");
  const items = [
    { id: "guide", category: "parking", title: "Otopark rehberi", content: long, updatedAt: new Date(t0) },
    { id: "short", category: "parking", title: "Otopark kısa", content: "Otopark ücretsiz.", updatedAt: new Date(t0 - 1000) },
    ...neutralPadding(40),
  ];

  it("kalem başına parça tavanı 3 (varsayılan); ezilince daha fazlası seçilebilir", () => {
    const def = selectKbForPrompt({ items, guestMessage: "Otopark kuralı nedir?", mode: "hybrid", now: NOW, budgetChars: 50_000 });
    __resetKbIndexCache();
    const five = selectKbForPrompt({ items, guestMessage: "Otopark kuralı nedir?", mode: "hybrid", now: NOW, budgetChars: 50_000, strategy: { maxChunksPerItem: 5 } });
    const count = (r: typeof def) => r.items.filter((i) => i.id === "guide").length;
    expect(count(def)).toBe(3);
    expect(count(five)).toBeGreaterThan(3);
  });

  it("'skip' paketleme: sığmayan parçadan sonra kısa parça yine girer; 'break' (varsayılan) orada durur", () => {
    // Sıra yeniden sıralayıcı etiketiyle SABİTLENİR: guide#0, guide#1 (cevap) → short (ilgili).
    const rerankScores = new Map([
      ["guide#0", 3],
      ["guide#1", 3],
      ["short#0", 2],
    ]);
    const all = selectKbForPrompt({ items, guestMessage: "Otopark kuralı nedir?", mode: "hybrid", now: NOW, budgetChars: 50_000, rerankScores });
    const size = (i: (typeof all.items)[number]) => i.category.length + i.title.length + i.content.length + 6;
    const [g0, g1] = all.items;
    const sh = all.items.find((i) => i.id === "short")!;
    expect([g0.id, g1.id]).toEqual(["guide", "guide"]);
    expect(size(sh)).toBeLessThan(size(g1));
    const budget = size(g0) + size(sh) + 1; // g0 + short sığar, g0 + g1 sığmaz
    __resetKbIndexCache();
    const brk = selectKbForPrompt({ items, guestMessage: "Otopark kuralı nedir?", mode: "hybrid", now: NOW, budgetChars: budget, rerankScores });
    __resetKbIndexCache();
    const skp = selectKbForPrompt({ items, guestMessage: "Otopark kuralı nedir?", mode: "hybrid", now: NOW, budgetChars: budget, rerankScores, strategy: { packing: "skip" } });
    expect(brk.items.map((i) => i.id)).toEqual(["guide"]);
    expect(skp.items.map((i) => i.id)).toEqual(["guide", "short"]);
  });
});

describe("anlama sorgularının bütçe payı (extraShare)", () => {
  const parks = Array.from({ length: 6 }, (_, i) => ({
    id: `park${i}`,
    category: "parking",
    title: `Otopark ${i}`,
    content: `Otopark bilgisi ${i}: araç için yer var.`,
    updatedAt: new Date(t0 - 2000 - i),
  }));
  const items = [...base.slice(0, 2), ...parks, ...neutralPadding(40)];
  const extraQueries = [
    { text: "otopark yeri", turkish: true },
    { text: "araç için otopark", turkish: true },
  ];
  const run = (strategy?: { extraShare?: number }) => {
    __resetKbIndexCache();
    return selectKbForPrompt({ items, guestMessage: "Wi-Fi şifresi ne?", mode: "hybrid", now: NOW, maxChunks: 6, extraQueries, ...(strategy ? { strategy } : {}) });
  };
  const parksIn = (r: ReturnType<typeof run>) => r.items.filter((i) => i.id.startsWith("park")).length;

  it("varsayılan 1/3 (6 parçada 2); verilmezse, 1/3 verilirse ya da geçersizse AYNI", () => {
    expect(parksIn(run())).toBe(2);
    expect(run({ extraShare: 1 / 3 }).items.map((i) => i.id)).toEqual(run().items.map((i) => i.id));
    for (const bad of [7, -1, Number.NaN]) expect(parksIn(run({ extraShare: bad }))).toBe(2);
  });

  it("pay büyütülünce daha çok ek-sorgu parçası girer; 0 iken hiç girmez (özgün soru etkilenmez)", () => {
    expect(parksIn(run({ extraShare: 1 }))).toBeGreaterThan(2);
    const none = run({ extraShare: 0 });
    expect(parksIn(none)).toBe(0);
    expect(none.items.map((i) => i.id)).toEqual(expect.arrayContaining(["wifi"]));
  });
});

describe("cevaplar önce (answersFirst) — yeniden sıralayıcının 'cevaplıyor' dediği, yalnız ek sorgudan gelen parça", () => {
  // Ölçülen kusurun ikizi (276 kalem, multi_55): işaretler tüm listelere uygulanınca ek sorgunun başı özgün sorunun ilk
  // adaylarından biri olur → "aynı konuyu tekrar eden ek sorgu" kuralı onu atlar → yalnız o sorgudan gelen, modelin
  // "cevaplıyor" dediği parça bloğa HİÇ girmez.
  const items = [
    ...base,
    { id: "bike", category: "general", title: "Bisiklet", content: "Bisiklet kilidi mutfak çekmecesinde durur.", updatedAt: new Date(t0 - 3000) },
  ];
  // Ek sorgunun en güçlü eşleşmesi özgün sorunun ilk adayı (park), bisiklet ancak ikinci: işaretlerle sıralanınca baş yine park.
  const extraQueries = [{ text: "ücretsiz açık otopark bisiklet", turkish: true }];
  const rerankScores = new Map([
    ["park#0", 3],
    ["park2#0", 3],
    ["bike#0", 3],
    ["wifi#0", 3],
  ]);
  const run = (strategy?: { answersFirst?: boolean; extraShare?: number }, scores: ReadonlyMap<string, number> = rerankScores) => {
    __resetKbIndexCache();
    return selectKbForPrompt({
      items,
      guestMessage: "Wi-Fi şifresi ne? Otopark var mı?",
      mode: "hybrid",
      now: NOW,
      extraQueries,
      rerankScores: scores,
      ...(strategy ? { strategy } : {}),
    });
  };

  it("🚨 09-27 (#208): 'tekrar' kararı yeniden sıralamadan ÖNCEKİ baş adaylarla → işaretli ek-sorgu parçası varsayılan yolda da girer", () => {
    // Eskiden bu KONTROL kusuru sabitliyordu (bisiklet girmiyordu). Artık ek sorgunun ilk adayları özgün sorgunun başında olmadığı
    // için ek sorgu tekrar sayılmaz, bisiklet ek sorgu payından girer.
    const ids = run().items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["wifi", "park", "park2", "bike"]));
  });

  it("🚨 answersFirst: işaretli parçalar önce alınır — yalnız ek sorgudan gelen cevap da bloğa girer", () => {
    const ids = run({ answersFirst: true }).items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["wifi", "park", "park2", "bike"]));
    expect(ids.indexOf("bike")).toBeLessThan(4);
  });

  it("işaretli cevaplar ek sorgu PAYINA sayılmaz (pay 0 iken de girer; model doğruladı)", () => {
    expect(run({ answersFirst: true, extraShare: 0 }).items.map((i) => i.id)).toContain("bike");
    // KONTROL: pay 0 + seçenek yok → ek sorgudan hiçbir şey girmez.
    expect(run({ extraShare: 0 }).items.map((i) => i.id)).not.toContain("bike");
  });

  it("YALNIZ 'cevaplıyor' (3) öne alınır — 'ilgili' (2) işaretli ek-sorgu parçası kurtarılmaz (ek sorgu payı 0)", () => {
    const related = new Map([...rerankScores].map(([k, v]) => [k, k === "bike#0" ? 2 : v] as const));
    expect(run({ answersFirst: true, extraShare: 0 }, related).items.map((i) => i.id)).not.toContain("bike");
    // KONTROL: aynı pay ile "cevaplıyor" (3) öne alınır.
    expect(run({ answersFirst: true, extraShare: 0 }).items.map((i) => i.id)).toContain("bike");
  });

  it("puan yoksa seçenek etkisiz (sonuç birebir)", () => {
    __resetKbIndexCache();
    const a = selectKbForPrompt({ items, guestMessage: "Wi-Fi şifresi ne? Otopark var mı?", mode: "hybrid", now: NOW, extraQueries });
    __resetKbIndexCache();
    const b = selectKbForPrompt({ items, guestMessage: "Wi-Fi şifresi ne? Otopark var mı?", mode: "hybrid", now: NOW, extraQueries, strategy: { answersFirst: true } });
    expect(b.items.map((i) => `${i.id}#${i.chunk ?? 0}`)).toEqual(a.items.map((i) => `${i.id}#${i.chunk ?? 0}`));
  });
});

// ---------------------------------------------------------------------------
// KALEM TAVANININ KAPSAMI (09-27, kurucu sorusu "büyük bilgi tabanında bir kayıttan en fazla 3 parça — bu kötü değil mi?"):
// tek uzun rehberde AYNI mesajda sorulan 4 bilgiden 4.'sü, tavan mesaj geneli 3 olduğu için düşüyordu (ücretsiz ölçüm: 4 soruda
// 0/10 mesajda hepsi blokta). `itemCapScope: "question"` = tavan × misafirin KENDİ soru sayısı (ek sorgular sayılmaz → tek soruda
// BİREBİR aynı). 🚨 VARSAYILAN (kurucu 09-27: "1.yi tabiki aç"); "message" = eski mesaj geneli tavan (ölçüm / geri alma).
// ---------------------------------------------------------------------------

const SECTIONS: [string, string][] = [
  ["GİRİŞ", "Giriş saatimiz 15:00'ten itibarendir."],
  ["ANAHTAR", "Anahtar kutusu bina kapısının solundaki duvarda."],
  ["OTOPARK", "Binanın arkasındaki otoparkta 7 numaralı yer size ayrılmıştır."],
  ["ÇÖP", "Çöp konteynerleri sokağın köşesinde, geri dönüşüm mavi kutuya atılır."],
  ["ÇAMAŞIR", "Çamaşır makinesi banyoda, deterjan lavabonun altındaki dolapta."],
];
const FILL = "Bu bölümle ilgili aklınıza takılan bir şey olursa bize yazmanız yeterli, her zaman yardımcı oluruz. ";
const guideItem = {
  id: "guide",
  category: "general",
  title: "Ev rehberi",
  content: SECTIONS.map(([h, needle]) => `${h}: ${FILL}${FILL}${needle} ${FILL}${FILL}${FILL}`).join("\n\n"),
  updatedAt: new Date(t0),
};
const guideKb = [guideItem, ...neutralPadding(40)];
const blockOf = (r: ReturnType<typeof selectKbForPrompt>) => r.items.map((i) => i.content).join("\n");

describe("kalem tavanı soru başına — VARSAYILAN (kurucu 09-27 \"1.yi tabiki aç\")", () => {
  beforeEach(() => __resetKbIndexCache());

  it("🚨 tek rehberde 4 soru: VARSAYILAN seçimde 4 cevap da blokta; eski mesaj geneli tavanda ('message') 4. cevap DÜŞER", () => {
    const msg = "Merhaba! Giriş saati kaçta? Anahtar kutusu nerede? Otopark var mı? Çöpleri nereye atıyoruz?";
    const def = selectKbForPrompt({ items: guideKb, guestMessage: msg, mode: "hybrid", now: NOW });
    for (const [, needle] of SECTIONS.slice(0, 4)) expect(blockOf(def), needle).toContain(needle);
    __resetKbIndexCache();
    const old = selectKbForPrompt({ items: guideKb, guestMessage: msg, mode: "hybrid", now: NOW, strategy: { itemCapScope: "message" } });
    expect(old.items.filter((i) => i.id === "guide")).toHaveLength(3);
    expect(SECTIONS.slice(0, 4).filter(([, n]) => blockOf(old).includes(n))).toHaveLength(3);
    __resetKbIndexCache();
    const explicit = selectKbForPrompt({ items: guideKb, guestMessage: msg, mode: "hybrid", now: NOW, strategy: { itemCapScope: "question" } });
    expect(explicit.items.map((i) => `${i.id}#${i.chunk ?? 0}`)).toEqual(def.items.map((i) => `${i.id}#${i.chunk ?? 0}`));
  });

  it("🚨 ÜRETİM YOLU (`retrieveKbForPrompt`, strateji vermez) varsayılanı kullanır: 4 sorunun 4 cevabı da blokta", async () => {
    vi.stubEnv("KB_RETRIEVAL_MODE", "");
    try {
      const msg = "Merhaba! Giriş saati kaçta? Anahtar kutusu nerede? Otopark var mı? Çöpleri nereye atıyoruz?";
      const r = await retrieveKbForPrompt({ items: guideKb, guestMessage: msg, now: NOW });
      const block = r.items.map((i) => i.content).join("\n");
      for (const [, needle] of SECTIONS.slice(0, 4)) expect(block, needle).toContain(needle);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("tek sorulu mesajda varsayılan = eski mesaj geneli tavan, BİREBİR (ek sorgular soru sayısını artırmaz)", () => {
    for (const msg of ["Otopark var mı?", "Giriş saati kaçta?"]) {
      const extraQueries = [
        { text: "otopark park yeri araç", turkish: true, request: 0 },
        { text: "parking space car", turkish: false, request: 0 },
      ];
      const a = selectKbForPrompt({ items: guideKb, guestMessage: msg, mode: "hybrid", now: NOW, extraQueries, strategy: { itemCapScope: "message" } });
      __resetKbIndexCache();
      const b = selectKbForPrompt({ items: guideKb, guestMessage: msg, mode: "hybrid", now: NOW, extraQueries });
      expect(b.items.map((i) => `${i.id}#${i.chunk ?? 0}`), msg).toEqual(a.items.map((i) => `${i.id}#${i.chunk ?? 0}`));
    }
  });
});

describe("ölçer tabanları: `base0926` ESKİ tavanda sabit, `prod` üretim varsayılanını izler", () => {
  it("base0926 = mesaj geneli tavan (09-26 hâli); prod strateji vermez; `mcap` / `qcap` belirteçleri", () => {
    expect(parseConfig("base0926").select?.strategy?.itemCapScope).toBe("message");
    expect(parseConfig("prod").select?.strategy?.itemCapScope).toBeUndefined();
    expect(parseConfig("prod+mcap").select?.strategy?.itemCapScope).toBe("message");
    expect(parseConfig("prod+qcap").select?.strategy?.itemCapScope).toBe("question");
  });
});

describe("kalem tavanı soru başına — anlama katmanının EK sorguları soru sayısını ARTIRMAZ (mutasyon 09-27, Q2)", () => {
  beforeEach(() => __resetKbIndexCache());

  // Tek konu (otopark) rehberin SEKİZ bölümünde geçiyor: ek sorgular soru sayılsaydı tavan 3 × 3 = 9 olur, rehberden 3'ten fazla parça
  // gelirdi. Tek soruda tavan bugünkü gibi 3 kalmalı.
  const PARK: string[] = Array.from({ length: 8 }, (_, i) => `OTOPARK ${i + 1}: Otopark bölümü ${i + 1}, araç park yeri ve otopark girişi burada anlatılır.`);
  const parkGuide = {
    id: "park-guide",
    category: "parking",
    title: "Otopark rehberi",
    content: PARK.map((p) => `${p} ${FILL}${FILL}${FILL}${FILL}`).join("\n\n"),
    updatedAt: new Date(t0),
  };
  const kb = [parkGuide, ...neutralPadding(40)];

  it("tek soru + iki ek sorgu: soru başına tavanda (varsayılan) da rehberden en fazla 3 parça (eski tavan gibi)", () => {
    const extraQueries = [
      { text: "otopark yeri nerede araç park", turkish: true, request: 0 },
      { text: "otopark girişi park yeri", turkish: true, request: 0 },
    ];
    const msg = "Otopark nerede?";
    const off = selectKbForPrompt({ items: kb, guestMessage: msg, mode: "hybrid", now: NOW, extraQueries, strategy: { itemCapScope: "message" } });
    __resetKbIndexCache();
    const on = selectKbForPrompt({ items: kb, guestMessage: msg, mode: "hybrid", now: NOW, extraQueries });
    expect(on.items.filter((i) => i.id === "park-guide")).toHaveLength(off.items.filter((i) => i.id === "park-guide").length);
    expect(on.items.filter((i) => i.id === "park-guide").length).toBeLessThanOrEqual(3);
    // KONTROL: ek sorgular gerçekten rehberde daha fazla parça bulabiliyor (tavan 9 olsaydı fark görünürdü).
    __resetKbIndexCache();
    const wide = selectKbForPrompt({ items: kb, guestMessage: msg, mode: "hybrid", now: NOW, extraQueries, strategy: { maxChunksPerItem: 9 } });
    expect(wide.items.filter((i) => i.id === "park-guide").length).toBeGreaterThan(3);
  });
});
