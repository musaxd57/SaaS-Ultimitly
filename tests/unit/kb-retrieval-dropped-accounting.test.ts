import { describe, it, expect } from "vitest";
import { selectKbForPrompt } from "@/lib/ai/retrieval/select";
import { KB_ITEM_CAP } from "@/lib/ai/limits";

// ---------------------------------------------------------------------------
// §C — "KAÇ KALEM MODELE GİTMEDİ" MUHASEBESİ (denetim turu 09-12).
//
// 🚨 ÖLÇÜLEN YALAN: geri çekilme (fail-open) dalında hibrit `kb-fetch`ten 200
// kalem çeker, `cappedForFallback` bunu 30'a indirir ve `legacyResult`
// `droppedItems: 0` SABİTLER. Yani 170 kalem isteme GİRMEZ ve karar kaydı
// "hiç kalem düşmedi" der.
//
// Bu sayı `RiskEvent.kbDropped`a gidiyor ve oradan `classifyGrounding`e:
// `dropped === 0` iken etiket `ungrounded` ("kalem vardı, model kullanmadı"),
// oysa gerçek `capacity` ("kalem isteme sığmadı"). Yani host'a YANLIŞ teşhis
// gösteriliyor.
//
// ⚠️ A2 SÖZLEŞMESİ: "NULL = ÖLÇÜLMEDİ, 0 DEĞİL". Ölçülmüş-ama-YANLIŞ bir sıfır
// NULL'dan kötüdür — çünkü sahte bir kesinlik üretir.
//
// 🚨 KIRPMANIN KENDİSİ DOĞRU ve DEĞİŞMİYOR (09-11 ölçümü: hibritin legacy'den
// fazla gönderdiği tek yerdi, kapatıldı). Burada düzeltilen tek şey SAYAÇ.
// ---------------------------------------------------------------------------

type Item = { id: string; title: string; content: string; category: string; updatedAt: Date };

const NOW = new Date("2026-09-12T00:00:00Z").getTime();
const item = (i: number): Item => ({
  id: `k${i}`,
  title: `Konu ${i}`,
  content: `Bu ${i} numaralı bilgi kalemi. Ayrıntı ${i}.`,
  category: "general",
  updatedAt: new Date(NOW - i * 1000),
});

/** Sözcüksel isabet ÜRETMEYEN ama boş da olmayan bir soru (fail-open dalı). */
const NO_HIT_QUESTION = "Zzzqqq vvvxxx yyywww?";

describe("§C — geri çekilme dalında DÜŞEN kalem sayılır", () => {
  it("🚨 200 kalem → 30 kalem: düşen 170 SAYILIR (eskiden 0 diyordu)", () => {
    const items = Array.from({ length: 200 }, (_, i) => item(i));
    const out = selectKbForPrompt({ items, guestMessage: NO_HIT_QUESTION, now: NOW, mode: "hybrid" });
    // Kırpma davranışı AYNEN korunur.
    expect(out.items.length).toBe(KB_ITEM_CAP);
    // Sayaç artık gerçeği söylüyor.
    expect(out.droppedItems).toBe(200 - KB_ITEM_CAP);
    // Anti-vakumluk: gerçekten geri çekilme dalındayız.
    expect(out.evidence?.fb).toBe("no_lexical_hits");
  });

  it("boş sorgu dalı da sayar (aynı kırpma, ayrı dal)", () => {
    const items = Array.from({ length: 90 }, (_, i) => item(i));
    const out = selectKbForPrompt({ items, guestMessage: "   ", now: NOW, mode: "hybrid" });
    expect(out.items.length).toBe(KB_ITEM_CAP);
    expect(out.droppedItems).toBe(90 - KB_ITEM_CAP);
    expect(out.evidence?.fb).toBe("empty_query");
  });

  it("🚨 TAVANIN ALTINDA hiçbir şey düşmez (aşırı uygulama kontrolü)", () => {
    const items = Array.from({ length: 10 }, (_, i) => item(i));
    const out = selectKbForPrompt({ items, guestMessage: NO_HIT_QUESTION, now: NOW, mode: "hybrid" });
    expect(out.items.length).toBe(10);
    expect(out.droppedItems).toBe(0);
  });

  it("LEGACY modda sayaç 0 KALIR — kırpmayı `kb-fetch` yapar, o kendi sayar", () => {
    // Legacy'de `kb-fetch` zaten 30 çeker ve düşeni KENDİ raporlar
    // (`fetchKnowledgeBaseForPrompt.dropped`). Burada ikinci kez saymak
    // ÇİFT SAYIM olurdu.
    const items = Array.from({ length: 200 }, (_, i) => item(i));
    const out = selectKbForPrompt({ items, guestMessage: NO_HIT_QUESTION, now: NOW, mode: "legacy" });
    expect(out.items.length).toBe(200);
    expect(out.droppedItems).toBe(0);
  });

  it("küçük KB dalı (aynı dizi referansı sözleşmesi) BOZULMAZ", () => {
    const items = Array.from({ length: 3 }, (_, i) => item(i));
    const out = selectKbForPrompt({ items, guestMessage: NO_HIT_QUESTION, now: NOW, mode: "hybrid" });
    expect(out.droppedItems).toBe(0);
    // 🚨 `small_kb` dalında dizi KOPYALANMAZ — `select.ts`in kendi sözleşmesi.
    expect(out.items).toBe(items as unknown as typeof out.items);
    expect(out.evidence?.fb).toBe("small_kb");
  });
});

describe("§C — SÜRÜM kuralı DÜŞÜŞ SAYILMAZ (ölçülüp REDDEDİLDİ)", () => {
  it("halefi olan kalem `droppedItems`e GİRMEZ — bilgi kaybı değil, sürüm çözümü", () => {
    // `supersededById`: eski kalem düşer ama HALEFİ kümededir, yani bilgi
    // modele GİDER. Bunu "düştü" diye saymak host'a "bilgi ulaşmadı" derdi —
    // ölçülmüş YANLIŞ. Kanıtta zaten `sup` alanı var, teşhis oradan yapılır.
    const base = Array.from({ length: 40 }, (_, i) => item(i));
    const withSuperseded = base.map((k, i) =>
      i === 0 ? { ...k, supersededById: base[1].id } : k,
    );
    const out = selectKbForPrompt({
      items: withSuperseded,
      guestMessage: NO_HIT_QUESTION,
      now: NOW,
      mode: "hybrid",
    });
    // 40 kalemin 1'i sürümce düştü → 39 kaldı, tavan 30 → 9 GERÇEK düşüş.
    expect(out.droppedItems).toBe(39 - KB_ITEM_CAP);
    // Sürüm düşüşü AYRI alanda raporlanır.
    expect(out.evidence?.sup).toBe(1);
  });
});
