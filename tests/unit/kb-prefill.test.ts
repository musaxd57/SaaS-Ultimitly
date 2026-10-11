import { describe, it, expect } from "vitest";
import {
  cleanPrefillTitle,
  kbCategoryForMissingInfo,
  kbPrefillHref,
  KB_PREFILL_TITLE_MAX,
  localTipsPrefillHref,
  parseKbPrefill,
} from "@/lib/kb-prefill";

// ---------------------------------------------------------------------------
// B1 (kurucu 10-11, "ev sahibi döngüsü"): gelen kutusundaki "Eksik bilgi" → bilgi tabanı formu ön dolu. Adres kurma + adresten gelen
// değerin doğrulanması: yalnız kendi mülkü, otomatik gönderilen mesaj kategorisi önerilmez, başlık temizlenip kısaltılır.
// ---------------------------------------------------------------------------

describe("kbCategoryForMissingInfo — yer / çevre sorusu → Yerel Tavsiye", () => {
  it.each([
    "Yakındaki kahvaltı yerleri",
    "En yakın eczane",
    "Çevredeki restoranlar",
    "Gezilecek yerler",
    "YAKINDAKİ MARKET",
    "Nearby restaurants",
    "Closest pharmacy",
    "Plaja uzaklık",
  ])("%s → local_tips", (t) => expect(kbCategoryForMissingInfo(t)).toBe("local_tips"));
  it.each(["Otopark bilgisi", "Çamaşır makinesi kullanımı", "Müsaitlik bilgisi", "Evcil hayvan kuralı", "Kapı kodu", ""])(
    "KONTROL: %s → general",
    (t) => expect(kbCategoryForMissingInfo(t)).toBe("general"),
  );
});

describe("cleanPrefillTitle", () => {
  it("kontrol / görünmez karakterler atılır, boşluk teke iner, tavana kısaltılır", () => {
    expect(cleanPrefillTitle("  Yakındaki\u0000  kahvaltı​\nyerleri  ")).toBe("Yakındaki kahvaltı yerleri");
    expect(cleanPrefillTitle("a".repeat(500))).toHaveLength(KB_PREFILL_TITLE_MAX);
  });
});

describe("kbPrefillHref / localTipsPrefillHref", () => {
  it("mülk + kategori + başlık sorgu parametresi (kodlanmış)", () => {
    const href = kbPrefillHref("prop-1", "Yakındaki kahvaltı yerleri & kafeler");
    expect(href.startsWith("/knowledge?")).toBe(true);
    const sp = new URLSearchParams(href.slice("/knowledge?".length));
    expect(sp.get("property")).toBe("prop-1");
    expect(sp.get("category")).toBe("local_tips");
    expect(sp.get("title")).toBe("Yakındaki kahvaltı yerleri & kafeler");
  });
  it("mülk sayfası hatırlatması → Yerel Tavsiye ön dolu", () => {
    const sp = new URLSearchParams(localTipsPrefillHref("prop-9").split("?")[1]);
    expect(Object.fromEntries(sp)).toEqual({ property: "prop-9", category: "local_tips", title: "Yakındaki yerler" });
  });
});

describe("parseKbPrefill — adresten gelen değer doğrulanır", () => {
  const own = ["p1", "p2"];
  it("kendi mülkü → ön doldurma", () => {
    expect(parseKbPrefill({ property: "p2", category: "local_tips", title: "Kahvaltı" }, own)).toEqual({
      propertyId: "p2",
      category: "local_tips",
      title: "Kahvaltı",
    });
  });
  it("🚨 yabancı / bilinmeyen mülk → hiç ön doldurma yok", () => {
    expect(parseKbPrefill({ property: "baska-org-mulku", category: "local_tips", title: "x" }, own)).toBeNull();
    expect(parseKbPrefill({ category: "local_tips" }, own)).toBeNull();
    expect(parseKbPrefill(undefined, own)).toBeNull();
  });
  it("🚨 otomatik gönderilen mesaj kategorisi (karşılama / giriş / çıkış) ve bilinmeyen kategori → Genel", () => {
    for (const category of ["welcome", "checkin", "checkout", "uydurma", ""]) {
      expect(parseKbPrefill({ property: "p1", category, title: "t" }, own)?.category).toBe("general");
    }
    expect(parseKbPrefill({ property: "p1", category: "wifi", title: "t" }, own)?.category).toBe("wifi");
  });
  it("dizi değerlerde ilki; başlık temizlenir ve kısaltılır", () => {
    const p = parseKbPrefill({ property: ["p1", "p2"], category: ["local_tips"], title: [`  ${"b".repeat(400)}\u0007`] }, own);
    expect(p?.propertyId).toBe("p1");
    expect(p?.title).toBe("b".repeat(KB_PREFILL_TITLE_MAX));
  });
});
