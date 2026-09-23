import { describe, it, expect, beforeEach } from "vitest";
import { selectKbForPrompt } from "@/lib/ai/retrieval/select";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { packKnowledgeBase } from "@/lib/ai/prompts";
import { KB_ITEM_CAP, KB_RETRIEVAL_CHAR_BUDGET } from "@/lib/ai/limits";
import { makeSyntheticKb, type SyntheticKb } from "../helpers/kb-retrieval-synthetic";
import { PARAPHRASES } from "../helpers/kb-paraphrase-set";

// ---------------------------------------------------------------------------
// KÜÇÜK KB EŞİĞİ = LEGACY TAVANI (09-23). Tamamı karakter bütçesine (6k) sığan ≤30 kalemlik KB'de
// seçim YAPILMAZ. Eski şart `kalem ≤ 12` idi (12 = seçimin ÇIKTI tavanı) ve tipik host KB'sini
// (13–30 kalem) daraltıyordu: kelime paylaşmayan Türkçe soruda cevap cümlesi isteme %33–36 giriyordu,
// legacy'de %91–100 (`docs/olcum/kb-retrieval-parafraz-2026-09-23.md`).
// ---------------------------------------------------------------------------

const NOW = Date.UTC(2026, 8, 23, 12);

function sortedPool(kb: SyntheticKb) {
  return [...kb.items].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

/** Bu boyutta KB'de konusu bulunan parafrazlar + altın cevap cümleleri. */
function paraphrasesFor(kb: SyntheticKb) {
  return PARAPHRASES.flatMap((p) => {
    const ref = p.gold.startsWith("guide:")
      ? kb.questions.find((q) => q.id === `q_guide_${p.gold.slice(6)}`)
      : kb.questions.find((q) => q.topic === p.gold && q.kind === "tr");
    return ref ? [{ text: p.text, needles: ref.needles }] : [];
  });
}

const blockHas = (text: string, needles: readonly string[]) => needles.some((n) => text.includes(n));

beforeEach(() => __resetKbIndexCache());

describe("küçük KB eşiği = legacy tavanı", () => {
  it("🚨 15 ve 20 kalemlik KB (6k içinde): seçim YOK, girdi dizisinin KENDİSİ döner", () => {
    for (const n of [15, 20]) {
      const pool = sortedPool(makeSyntheticKb(n));
      expect(pool.length).toBeLessThanOrEqual(KB_ITEM_CAP);
      expect(pool.length).toBeGreaterThan(12); // KONTROL: eski eşiğin ÜSTÜNDE
      const r = selectKbForPrompt({ items: pool, guestMessage: "Otopark var mı?", mode: "hybrid", now: NOW });
      expect(r.evidence?.fb, `n=${n}`).toBe("small_kb");
      expect(r.items).toBe(pool as unknown as typeof r.items);
    }
  });

  it("parafraz: 15/20 kalemde HER sorunun cevap cümlesi isteme girer ve blok legacy ile birebir aynıdır", () => {
    for (const n of [15, 20]) {
      const kb = makeSyntheticKb(n);
      const pool = sortedPool(kb);
      const legacy = packKnowledgeBase(pool.slice(0, KB_ITEM_CAP)).text;
      const cases = paraphrasesFor(kb);
      expect(cases.length).toBeGreaterThanOrEqual(15);
      for (const c of cases) {
        const r = selectKbForPrompt({ items: pool, guestMessage: c.text, mode: "hybrid", now: NOW });
        const text = packKnowledgeBase(r.items, r.droppedItems, r.selection).text;
        expect(blockHas(text, c.needles), `${n}: ${c.text}`).toBe(true);
        expect(text).toBe(legacy);
      }
    }
  });

  it("KONTROL (kusurun gerçekliği): ESKİ eşikle (12) aynı 20 kalemlik KB parafrazların çoğunda cevabı DÜŞÜRÜYORDU", () => {
    const kb = makeSyntheticKb(20);
    const pool = sortedPool(kb);
    const cases = paraphrasesFor(kb);
    const missed = cases.filter((c) => {
      const r = selectKbForPrompt({ items: pool, guestMessage: c.text, mode: "hybrid", now: NOW, fullSetMaxItems: 12 });
      return !blockHas(packKnowledgeBase(r.items, r.droppedItems, r.selection).text, c.needles);
    }).length;
    // Ölçüldü: 46 sorgunun 20'si (TR 15/23 + EN 5/23).
    expect(missed).toBeGreaterThanOrEqual(15);
  });

  it("SINIR: tam 30 kalem → tamamı gider; 31 kalem → seçim", () => {
    const pool = sortedPool(makeSyntheticKb(30)); // 34 kalem, hepsi kısa (6k içinde)
    const at = (n: number) => selectKbForPrompt({ items: pool.slice(0, n), guestMessage: "Otopark var mı?", mode: "hybrid", now: NOW });
    expect(at(KB_ITEM_CAP).evidence?.fb).toBe("small_kb");
    expect(at(KB_ITEM_CAP + 1).evidence?.fb).toBe("none");
  });

  it("30 kalemi aşan KB'de seçim SÜRER (retrieval yalnız gerektiğinde)", () => {
    const pool = sortedPool(makeSyntheticKb(30)); // 34 kalem
    expect(pool.length).toBeGreaterThan(KB_ITEM_CAP);
    const r = selectKbForPrompt({ items: pool, guestMessage: "Otopark var mı?", mode: "hybrid", now: NOW });
    expect(r.evidence?.fb).toBe("none");
    expect(r.selection).toBe("retrieved");
  });

  it("≤30 kalem ama karakter bütçesini aşan KB'de seçim SÜRER (uzun rehberler daraltılır)", () => {
    const long = (i: number, topic: string) => ({
      id: `long_${i}`,
      category: "faq",
      title: `${topic} rehberi`,
      content: `${topic} hakkında ayrıntılı açıklama. `.repeat(20),
      updatedAt: new Date(NOW - i * 60_000),
    });
    const items = [
      ...Array.from({ length: 14 }, (_, i) => long(i, `Konu ${i}`)),
      { id: "parking", category: "parking", title: "Otopark", content: "Bina altı otopark ücretsizdir.", updatedAt: new Date(NOW - 99 * 60_000) },
    ];
    const total = items.reduce((s, it) => s + it.content.length, 0);
    expect(total).toBeGreaterThan(KB_RETRIEVAL_CHAR_BUDGET); // KONTROL
    const r = selectKbForPrompt({ items, guestMessage: "Otopark var mı?", mode: "hybrid", now: NOW });
    expect(r.evidence?.fb).toBe("none");
    expect(r.items.map((i) => i.id)).toContain("parking");
    expect(r.items.length).toBeLessThan(items.length);
  });
});
