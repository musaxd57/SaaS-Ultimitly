import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { packKnowledgeBase } from "@/lib/ai/prompts";
import { kbBlockChars, kbFitsWhole, kbLine, SMALL_KB_MARGIN_CHARS } from "@/lib/ai/retrieval/kb-line";
import { retrievalNeeded, selectKbForPrompt } from "@/lib/ai/retrieval/select";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { KB_CHAR_BUDGET, KB_ITEM_CAP } from "@/lib/ai/limits";

// ---------------------------------------------------------------------------
// #209 KÜÇÜK-KB SINIRI (kurucu kararı 09-27): "30 veya daha az kayıtlı bilgi tabanı sınırı yalnız birkaç düzine karakter
// aşıyorsa, 6.000 karakterlik seçime geçip kayıt düşürmek yerine dar ek payla kayıtların tamamını koruyalım. Büyük aşımda bu
// istisna uygulanmasın. Ön hesap ile gerçek paketleme aynı biçimlendirilmiş uzunluğu ölçmeli; satır ayraçları da hesaba
// katılmalı. Ek pay yalnız bu küçük-KB yolu için geçerli olsun, genel bütçe büyümesin. Özellikle son kayıttaki cevap
// sorulduğunda kanıtın ve doğru müşteri cevabının korunduğu test edilsin."
// Ölçülen kusur: seçicinin ön hesabı kalem başına +6 sayıyordu, paketleyicinin satırı +7 ve ayracı +1 → "sığar" denen 30 kalemlik
// bilgi tabanının SON kalemi paketlemede düşüyor, model "yer sınırı" notunu görüp o konuyu insana devrediyordu.
// ---------------------------------------------------------------------------

const T0 = Date.UTC(2026, 0, 1);
const ANSWER = "Çamaşır makinesi kapsülleri banyodaki beyaz dolabın üst rafındadır.";

/** `n` kalem; biçimli blok (satırlar + ayraçlar) TAM `total` karakter; son kalem cevap cümlesini taşır. */
function kbOfTotal(n: number, total: number) {
  const items = Array.from({ length: n }, (_, i) => ({
    id: `k${i}`,
    category: "rules",
    title: `Bilgi ${String(i).padStart(2, "0")}`,
    content: "",
    updatedAt: new Date(T0 - i * 60_000),
  }));
  items[n - 1] = { ...items[n - 1], category: "amenities", title: "Çamaşır" };
  const base = items.map((k) => kbLine(k).length);
  const room = total - (n - 1) - base.reduce((a, b) => a + b, 0) - ANSWER.length - 1;
  const per = Math.floor(room / (n - 1));
  const filler = (len: number) => ("Bina girişi sakin bir sokaktadır ve komşular gece sessizliğe özen gösterir. ".repeat(40)).slice(0, len);
  for (let i = 0; i < n - 1; i++) items[i].content = filler(i === n - 2 ? room - per * (n - 2) : per);
  items[n - 1].content = `${ANSWER} ${filler(0)}`.trim();
  // Son kalemi tam hedefe getir (yuvarlama farkı).
  const diff = total - kbBlockChars(items);
  items[n - 2].content = filler(items[n - 2].content.length + diff);
  expect(kbBlockChars(items)).toBe(total);
  return items;
}

beforeEach(() => {
  __resetKbIndexCache();
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
  vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "");
  vi.stubEnv("KB_RERANK_ENABLED", "");
  vi.stubEnv("AI_UNDERSTANDING_ENABLED", "");
  vi.stubEnv("KB_RETRIEVAL_WIDE_BUDGET", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("ön hesap = gerçek paketleme (tek ölçü)", () => {
  it("biçimli blok uzunluğu paketlenen bloğun uzunluğudur (satır + ayraç; not yokken)", () => {
    const items = [
      { category: "wifi", title: "Wi-Fi", content: "Ağ adı karttadır." },
      { category: "rules", title: "Sigara", content: "İçeride sigara içilmez; balkonda serbest." },
      { category: "checkin", title: "Giriş", content: "Giriş 15:00'ten itibaren." },
    ];
    const packed = packKnowledgeBase(items);
    expect(packed.omitted).toBe(0);
    expect(packed.text.length).toBe(kbBlockChars(items));
    expect(packed.text.split("\n")).toEqual(items.map(kbLine));
  });
});

describe("🚨 dar ek pay: ≤30 kalem, sınırı birkaç düzine karakter aşan bilgi tabanı TAMAMEN gider", () => {
  it("24.000 + 50 karakter, 30 kalem: seçim YOK, paketleme hiçbir kalemi düşürmez, son kalemin cevabı blokta, 'yer sınırı' notu yok", () => {
    const items = kbOfTotal(KB_ITEM_CAP, KB_CHAR_BUDGET + 50);
    expect(kbFitsWhole(items)).toBe(true);
    expect(retrievalNeeded(items)).toBe(false);
    const sel = selectKbForPrompt({ items, guestMessage: "Çamaşır makinesi kapsülleri nerede?", now: T0 });
    expect(sel.evidence?.fb).toBe("small_kb");
    expect(sel.items).toHaveLength(KB_ITEM_CAP);
    const packed = packKnowledgeBase(sel.items, sel.droppedItems, sel.selection, sel.notes);
    expect(packed.omitted).toBe(0);
    expect(packed.text).toContain(ANSWER);
    expect(packed.text).not.toMatch(/yer sınırı|SORUYA GÖRE SEÇİLDİ/);
  });

  it("🚨 ESKİ KUSUR (kırmızı-önce): ön hesap sığar dediği hâlde son kalem düşmüyor — sınırın hemen üstündeki her toplam için", () => {
    for (const over of [1, 10, 29, 30, 59, SMALL_KB_MARGIN_CHARS]) {
      const items = kbOfTotal(KB_ITEM_CAP, KB_CHAR_BUDGET + over);
      const packed = packKnowledgeBase(items);
      expect(packed.omitted, `+${over}`).toBe(0);
      expect(packed.text, `+${over}`).toContain(ANSWER);
      expect(retrievalNeeded(items), `+${over}`).toBe(false);
    }
  });

  it("büyük aşımda istisna YOK: 24.000 + 61 → seçim yapılır (küçük-KB yolu değil)", () => {
    const items = kbOfTotal(KB_ITEM_CAP, KB_CHAR_BUDGET + SMALL_KB_MARGIN_CHARS + 1);
    expect(kbFitsWhole(items)).toBe(false);
    expect(retrievalNeeded(items)).toBe(true);
    const sel = selectKbForPrompt({ items, guestMessage: "Çamaşır makinesi kapsülleri nerede?", now: T0 });
    expect(sel.evidence?.fb).not.toBe("small_kb");
    // Seçim cevabı yine bulur (soruyla sözcük paylaşıyor) — istisna yokken de kanıt kaybolmaz.
    expect(sel.items.some((i) => i.content.includes(ANSWER))).toBe(true);
  });

  it("ek pay yalnız ≤30 kalemde: 31 kalemlik bilgi tabanı ek pay ALMAZ", () => {
    const items = kbOfTotal(KB_ITEM_CAP + 1, KB_CHAR_BUDGET - 500);
    expect(kbFitsWhole(items)).toBe(false);
    expect(retrievalNeeded(items)).toBe(true);
  });
});

describe("ölçü isteme GİRECEK metinle (yer tutucular doldurulmuş)", () => {
  // Ham metin sınıra sığar (+20), "{isim}" 26 harflik bir ada dönünce doldurulmuş blok +80 olur (payın dışında).
  const NAME = "Maximiliantheodorwilhelmfr";
  const withNames = () => {
    const items = kbOfTotal(KB_ITEM_CAP, KB_CHAR_BUDGET + 20);
    for (let i = 0; i < 3; i++) items[i] = { ...items[i], content: `{isim}${items[i].content.slice(6)}` };
    expect(kbBlockChars(items)).toBe(KB_CHAR_BUDGET + 20);
    return items;
  };

  it("🚨 ham metne göre 'sığar' ama doldurulmuş metin sığmıyor → seçim yapılır; paket cevabı düşürmez (A5 F5 '{isim}' vakası)", async () => {
    const items = withNames();
    expect(retrievalNeeded(items)).toBe(false); // ham ölçü tek başına yanıltırdı
    const r = await retrieveKbForPrompt({
      items,
      guestMessage: "Çamaşır makinesi kapsülleri nerede?",
      now: T0,
      placeholders: { guestFirstName: NAME, propertyName: "Lale" },
    });
    expect(r.evidence?.fb).not.toBe("small_kb");
    const packed = packKnowledgeBase(r.items, r.droppedItems, r.selection, r.notes);
    expect(packed.text).toContain(ANSWER);
    expect(packed.text).not.toContain("{isim}");
  });

  it("KONTROL — yer tutucu yokken aynı ham bilgi tabanı küçük-KB yolunda kalır (tamamı gider)", async () => {
    const items = withNames();
    const r = await retrieveKbForPrompt({ items, guestMessage: "Çamaşır makinesi kapsülleri nerede?", now: T0 });
    expect(r.evidence?.fb).toBe("small_kb");
    expect(r.items).toHaveLength(KB_ITEM_CAP);
  });
});

describe("genel bütçe büyümez", () => {
  it("küçük-KB yolu dışında paket ayraçlarla birlikte 24.000'i aşmaz", () => {
    const items = kbOfTotal(KB_ITEM_CAP + 10, KB_CHAR_BUDGET + 5_000);
    const packed = packKnowledgeBase(items);
    expect(packed.omitted).toBeGreaterThan(0);
    const block = packed.text.split("\n- [NOT]")[0];
    expect(block.length).toBeLessThanOrEqual(KB_CHAR_BUDGET);
  });

  it("küçük-KB yolunda da paket bütçe + dar ek payı aşmaz", () => {
    const items = kbOfTotal(KB_ITEM_CAP, KB_CHAR_BUDGET + SMALL_KB_MARGIN_CHARS);
    expect(packKnowledgeBase(items).text.length).toBeLessThanOrEqual(KB_CHAR_BUDGET + SMALL_KB_MARGIN_CHARS);
  });
});
