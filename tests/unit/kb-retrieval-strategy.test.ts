import { describe, it, expect, beforeEach } from "vitest";
import { selectKbForPrompt, retrievalQueries } from "@/lib/ai/retrieval/select";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { neutralPadding } from "../helpers/kb-padding";

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
