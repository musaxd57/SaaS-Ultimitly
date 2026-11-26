import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { selectKbForPrompt } from "@/lib/ai/retrieval/select";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { KB_ITEM_CAP } from "@/lib/ai/limits";

// ---------------------------------------------------------------------------
// 🚨 GERİ ÇEKİLME DALI LEGACY TAVANINI AŞMAZ (ölçüm turu, 09-11).
//
// ÖLÇÜLEN KUSUR (`docs/olcum/hibrit-yan-etki-2026-09-11.md`): hibrit açıkken
// `kb-fetch` 30 yerine 200 kalem çekiyor; sözcüksel isabet olmayan ya da
// selamlaşma niteliğindeki mesajda seçici "hepsini gönder"e düşünce O 200'ÜN
// TAMAMI isteme giriyordu. Ölçülen oranlar (legacy bloğuna göre):
//
//     30 kalem → 1,04×   ·   60 (plan tavanı) → 1,69×   ·   100 → 3,00×   ·   300 → 7,57×
//
// Ve bu dal NADİR DEĞİL: 25 mesajlık gerçekçi kısa-mesaj bataryasının 18'i (%72)
// buraya düşüyor ("Merhaba", "Teşekkürler"…). Dört üretim yüzeyi de ham misafir
// mesajını geçiriyor, yani misafir doğrudan bu yola giriyor.
//
// İKİ SONUÇ, İKİSİ DE İSTENMEYEN:
//  ① MALİYET — hibritin legacy'den DAHA ÇOK gönderdiği ölçülen TEK yer.
//  ② MARUZİYET — legacy'nin "en yeni 30" penceresi bayat/kötü niyetli bir kalemi
//    kalıcı olarak ERİŞİLMEZ tutuyordu; geri çekilmede hepsi BİRDEN gidiyordu.
//
// KURAL: geri çekilme dalı en fazla `KB_ITEM_CAP` (=legacy'nin aldığı sayı) kalem
// taşır. Girdi `kb-fetch`ten `updatedAt desc` gelir, yani ilk N = legacy'nin TAM
// OLARAK aldığı küme. Böylece "hibrit legacy'den AZ bilgi taşımaz" değişmezi
// korunur (eşit taşır) ve "daha ÇOK taşır" durumu ortadan kalkar.
// ---------------------------------------------------------------------------

const t0 = new Date("2026-09-01T00:00:00Z");
/** `kb-fetch` sırasını taklit eder: en yeni ÖNCE. */
function items(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `k${String(i).padStart(3, "0")}`,
    category: "general",
    title: `Konu ${i}`,
    content: `Bu ${i} numaralı kalemin içeriğidir ve tek başına bütçeyi doldurmaz. `.repeat(6),
    updatedAt: new Date(t0.getTime() - i * 60_000),
  }));
}

const hybrid = (guestMessage: string, n: number) =>
  selectKbForPrompt({ items: items(n), guestMessage, mode: "hybrid" });

describe("🚨 hibrit geri çekilme dalı legacy tavanını AŞMAZ", () => {
  beforeEach(() => __resetKbIndexCache());

  it("SELAMLAŞMA (empty_query): 60 kalemde en fazla legacy kadar taşır", () => {
    const out = hybrid("Merhaba!", 60);
    expect(out.evidence?.fb).toBe("empty_query");
    expect(out.items.length).toBeLessThanOrEqual(KB_ITEM_CAP);
  });

  it("SÖZCÜKSEL İSABET YOK (no_lexical_hits): 100 kalemde de tavan geçerli", () => {
    // Hiçbir kalemle örtüşmeyen, gerçek kelimelerden kurulu bir soru.
    const out = hybrid("Jakuzi ve helikopter pisti var mı?", 100);
    expect(out.evidence?.fb).toBe("no_lexical_hits");
    expect(out.items.length).toBeLessThanOrEqual(KB_ITEM_CAP);
  });

  it("🚨 TAŞINAN KÜME LEGACY'NİN TA KENDİSİ — en yeni N, rastgele N değil", () => {
    // Girdi `updatedAt desc` sıralı; legacy `take: 30` ile ilk 30'u alır.
    // Eşitlik ŞART: az taşısa bilgi kaybı, fazla taşısa maruziyet olurdu.
    const n = 80;
    const out = hybrid("Merhaba!", n);
    expect(out.items.map((i) => i.id)).toEqual(items(n).slice(0, KB_ITEM_CAP).map((i) => i.id));
  });

  it("300 kalemde ölçülen 7,57× maruziyeti biter", () => {
    const out = hybrid("Merhaba!", 300);
    expect(out.items.length).toBe(KB_ITEM_CAP);
    // Karşı yön: en eski kalem ARTIK tek bir selamlaşmayla modele gidemez.
    expect(out.items.some((i) => i.id === "k299")).toBe(false);
  });
});

describe("🚨 KARŞI YÖN — tavan yanlış yere uygulanmadı", () => {
  beforeEach(() => __resetKbIndexCache());

  it("KÜÇÜK KB (small_kb) tavandan ETKİLENMEZ ve aynı diziyi döndürür", () => {
    // Bu dal zaten tavanın ALTINDA; kırpma burada davranış değiştirmemeli ve
    // dizi KİMLİĞİ korunmalı (mevcut sözleşme: 0 düşen, seçim yok).
    const src = items(8);
    const out = selectKbForPrompt({ items: src, guestMessage: "Merhaba!", mode: "hybrid" });
    expect(out.evidence?.fb).toBe("small_kb");
    expect(out.items).toHaveLength(8);
    expect(out.items).toBe(src);
  });

  it("BAYRAK KAPALI yol KİMLİK olarak kalır (tavan legacy'yi kırpmaz)", () => {
    // 🚨 Legacy zaten DB'den 30 alıyor; burada kırpmak çift kırpma olurdu ve
    // "bayrak kapalı = aynı dizi referansı" pinini bozardı.
    const src = items(60);
    const out = selectKbForPrompt({ items: src, guestMessage: "Merhaba!", mode: "legacy" });
    expect(out.items).toBe(src);
    expect(out.items).toHaveLength(60);
    expect(out.evidence).toBeNull();
  });

  it("🚨 HATA DALI da tavana uyar (savunma yolu sessizce 200 kalem göndermez)", () => {
    // ⚠️ Bu dala ULAŞMAK İÇİN İMKÂNSIZ BİR SATIR gerekiyor: Prisma'da `content`
    // NOT NULL, yani üretimde buraya düşülmez. Yine de pinli — mutasyon turunda
    // bu dalın tavanı SESSİZCE kaldırılabiliyordu (M3 hayatta kalmıştı).
    const broken = items(80).map((it, i) =>
      i === 3 ? ({ ...it, content: null } as unknown as (typeof it)) : it,
    );
    const out = selectKbForPrompt({ items: broken, guestMessage: "Otopark var mı?", mode: "hybrid" });
    expect(out.evidence?.fb).toBe("error");
    expect(out.items.length).toBeLessThanOrEqual(KB_ITEM_CAP);
  });

  it("SEÇİM YAPILAN yol (retrieved) tavandan etkilenmez — o zaten ≤12 parça", () => {
    const src = items(100);
    const out = selectKbForPrompt({ items: src, guestMessage: "Konu 7 hakkında bilgi", mode: "hybrid" });
    expect(out.selection).toBe("retrieved");
    expect(out.items.length).toBeLessThanOrEqual(KB_ITEM_CAP);
  });
});
