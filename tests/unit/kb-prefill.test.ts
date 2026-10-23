import { describe, it, expect, afterEach, vi } from "vitest";
import {
  cleanPrefillTitle,
  kbCategoryForMissingInfo,
  kbPrefillHref,
  KB_PREFILL_TITLE_MAX,
  localTipsPrefillHref,
  parseKbPrefill,
  rememberKbPrefillTitle,
  takeKbPrefillTitle,
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
    expect(cleanPrefillTitle("  Yakındaki\u0000  kahvaltı\u200B\nyerleri  ")).toBe("Yakındaki kahvaltı yerleri");
    expect(cleanPrefillTitle("a".repeat(500))).toHaveLength(KB_PREFILL_TITLE_MAX);
  });
});

describe("kbPrefillHref / localTipsPrefillHref", () => {
  it("🚨 adres YALNIZ mülk + kategori taşır — modelin özeti (misafir adı olabilir) adrese girmez (Haiku 2. tur)", () => {
    const href = kbPrefillHref("prop-1", "Ayşe Hanım'ın sorduğu yakındaki kahvaltı yerleri");
    expect(href.startsWith("/knowledge?")).toBe(true);
    const sp = new URLSearchParams(href.slice("/knowledge?".length));
    expect(Object.fromEntries(sp)).toEqual({ property: "prop-1", category: "local_tips" });
    expect(href).not.toMatch(/Ay%C5%9Fe|Ayşe|title/);
  });
  it("mülk sayfası hatırlatması → Yerel Tavsiye ön dolu", () => {
    const sp = new URLSearchParams(localTipsPrefillHref("prop-9").split("?")[1]);
    expect(Object.fromEntries(sp)).toEqual({ property: "prop-9", category: "local_tips", title: "Yakındaki yerler" });
  });
});

describe("rememberKbPrefillTitle / takeKbPrefillTitle — başlık sekmenin oturum belleğinde, bir kez", () => {
  const store = new Map<string, string>();
  const fake = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });

  it("aynı mülk + 10 dakika içinde → başlık; okununca silinir", () => {
    vi.stubGlobal("window", { sessionStorage: fake });
    rememberKbPrefillTitle("p1", "  Yakındaki   kahvaltı yerleri ", 1_000);
    expect(takeKbPrefillTitle("p1", 1_000 + 60_000)).toBe("Yakındaki kahvaltı yerleri");
    expect(takeKbPrefillTitle("p1", 1_000 + 60_000)).toBe("");
  });
  it("KONTROL: başka mülk / 10 dakikadan eski / geleceğe tarihli / bozuk kayıt → boş (ve silinir)", () => {
    vi.stubGlobal("window", { sessionStorage: fake });
    rememberKbPrefillTitle("p1", "Kahvaltı", 0);
    expect(takeKbPrefillTitle("p2", 1)).toBe("");
    expect(store.size).toBe(0);
    rememberKbPrefillTitle("p1", "Kahvaltı", 0);
    expect(takeKbPrefillTitle("p1", 10 * 60_000 + 1)).toBe("");
    rememberKbPrefillTitle("p1", "Kahvaltı", 5_000);
    expect(takeKbPrefillTitle("p1", 1_000)).toBe("");
    store.set("lixus.kbPrefillTitle", "{bozuk");
    expect(takeKbPrefillTitle("p1", 1)).toBe("");
  });
  it("depolama yoksa (sunucu / engelli) sessizce boş", () => {
    vi.stubGlobal("window", undefined);
    expect(() => rememberKbPrefillTitle("p1", "x")).not.toThrow();
    expect(takeKbPrefillTitle("p1")).toBe("");
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
