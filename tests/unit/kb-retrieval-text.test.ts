import { describe, it, expect } from "vitest";
import {
  contentStems,
  diceBigram,
  isStopword,
  normalizeForRetrieval,
  stem,
  tokenize,
} from "@/lib/ai/retrieval/text";
import { expandQuery, matchConcepts } from "@/lib/ai/retrieval/lexicon";

// ---------------------------------------------------------------------------
// RAG dilim 1 — metin katmanı. Sorgu ve bilgi tabanı AYNI katlamadan geçer;
// burada ölçülen şey iki tarafın aynı anahtara inip inmediğidir.
// ---------------------------------------------------------------------------

describe("normalizeForRetrieval", () => {
  it("Türkçe İ/I/ı ve ASCII katlama: her yazım aynı anahtara iner", () => {
    expect(normalizeForRetrieval("OTOPARK VAR MI")).toBe("otopark var mi");
    expect(normalizeForRetrieval("İyi günler, şifre")).toBe("iyi gunler, sifre");
    expect(normalizeForRetrieval("ÇIKIŞ")).toBe("cikis");
  });

  it("görünmez karakterler (Default_Ignorable + U+2800) silinir, tam genişlik NFKC ile iner", () => {
    expect(normalizeForRetrieval("oto\u00adpark")).toBe("otopark"); // SOFT HYPHEN
    expect(normalizeForRetrieval("oto\u200bpark")).toBe("otopark"); // ZWSP
    expect(normalizeForRetrieval("oto\u2800park")).toBe("otopark"); // BRAILLE BLANK
    expect(normalizeForRetrieval("\uff2f\uff54\uff4f\uff50\uff41\uff52\uff4b")).toBe("otopark"); // tam genişlik
  });

  it("kesme işareti kelime sınırıdır (CLAUDE.md kuralı)", () => {
    expect(tokenize("12:00'dir")).toEqual(["12:00", "dir"]);
    expect(tokenize("Ali’nin")).toEqual(["ali", "nin"]);
  });

  it("bileşik yazımlar tek anahtara iner (wi-fi / check in / check-out)", () => {
    expect(tokenize("Wi-Fi şifresi")).toEqual(["wifi", "sifresi"]);
    expect(tokenize("check in saati")).toEqual(["checkin", "saati"]);
    expect(tokenize("Check-out")).toEqual(["checkout"]);
  });

  it("saat belirteçleri SS:DD'ye normalize edilir (12.00 ve 9:30 dahil)", () => {
    expect(tokenize("çıkış 12.00 giriş 9:30")).toEqual(["cikis", "12:00", "giris", "09:30"]);
  });
});

describe("stem (Türkçe + İngilizce ek sökme, simetrik)", () => {
  const same = (a: string, b: string) => expect(stem(a)).toBe(stem(b));

  it("iyelik/hâl/çoğul ekleri sökülür", () => {
    same("otoparki", "otopark");
    same("otoparkta", "otopark");
    same("otoparklardan", "otopark");
    same("sifresi", "sifre");
    same("sifreyi", "sifre");
    same("copu", "cop");
    same("copleri", "cop");
    same("konteynere", "konteyner");
    same("saatte", "saat");
  });

  it("olumlu/olumsuz fiil biçimleri aynı köke iner (calismiyor ≡ calisiyor)", () => {
    same("calismiyor", "calisiyor");
    same("gelmiyor", "geliyor");
    same("akmiyor", "akiyor");
  });

  it("ünsüz yumuşaması geri alınır (yalnız ek söküldüyse): uçağa≡uçak, köpeğimi≡köpek, kitabı≡kitap; 'blog' dokunulmaz", () => {
    same("ucaga", "ucak");
    same("kopegimi", "kopek");
    same("kitabi", "kitap");
    expect(stem("blog")).toBe("blog");
  });

  it("dilim 2 ekleri: ütüleyebilir≡ütüle, ayrılmam≡ayrıl, ısıtabileceğim≡ısıt", () => {
    same("utuleyebilir", "utule");
    same("ayrilmam", "ayril");
    same("isitabilecegim", "isit");
  });

  it("İngilizce ekler: parking→park, towels→towel, keys→key", () => {
    same("parking", "park");
    same("towels", "towel");
    same("keys", "key");
  });

  it("kök en az MIN_STEM harf kalır (kısa kelime sökülmez) ve rakamlı belirteç DOKUNULMAZ", () => {
    expect(stem("bus")).toBe("bus");
    expect(stem("gas")).toBe("gas");
    expect(stem("12:00")).toBe("12:00");
    expect(stem("3")).toBe("3");
  });

  it("2. tekil 'sin/sun' eki BİLİNÇLİ yok — 'otobusun' 'otobu' olmaz", () => {
    expect(stem("otobusun")).toBe(stem("otobus"));
    expect(stem("otobusun")).not.toBe("otobu");
  });
});

describe("contentStems / stopwords", () => {
  it("durak kelimeler elenir; 'var' ve 'yok' BİLGİ taşır, elenmez", () => {
    expect(contentStems("Otopark var mı?")).toEqual(["otopark", "var"]);
    expect(contentStems("Sıcak su yok")).toEqual(["sicak", "su", "yok"]);
    expect(isStopword("mi")).toBe(true);
    expect(isStopword("var")).toBe(false);
  });

  it("soru zarfları durak: nesne adı kalır", () => {
    expect(contentStems("Çöpü nereye bırakayım?")).toEqual(["cop", "birak"]);
    expect(contentStems("Where is the trash?")).toEqual(["trash"]);
  });

  it("selamlaşma/nezaket içerik kökü ÜRETMEZ (hibrit geri çekilme sinyali)", () => {
    expect(contentStems("Merhaba, iyi akşamlar!")).toEqual([]);
    expect(contentStems("Teşekkürler")).toEqual([]);
  });
});

describe("lexicon", () => {
  it("'araba' ve 'car' otopark kavramına düşer, kategori ipucu parking", () => {
    for (const q of ["arabayı nereye koyabilirim", "where can I park my car", "Otopark var mı"]) {
      const m = matchConcepts(contentStems(q));
      expect(m.map((x) => x.concept.id), q).toContain("parking");
      const e = expandQuery(contentStems(q));
      expect(e.categoryHints.get("parking"), q).toBeGreaterThan(0);
    }
  });

  it("genişletme SORGUNUN KENDİ köklerini yeniden eklemez ve 0.5 ağırlık taşır", () => {
    const e = expandQuery(contentStems("otopark var mı"));
    expect(e.expansion.has("otopark")).toBe(false);
    expect(e.expansion.get("garaj")).toBe(0.5);
    expect(e.expansion.get("park")).toBe(0.5);
  });

  it("çok kelimelik terim yalnız TESPİT eder ('sıcak su' → hot_water), 'su' tek başına kavram değil", () => {
    expect(matchConcepts(contentStems("sıcak su gelmiyor")).map((m) => m.concept.id)).toContain("hot_water");
    expect(matchConcepts(contentStems("su kesintisi var mı")).map((m) => m.concept.id)).not.toContain("hot_water");
  });

  it("'kapı şifresi' wifi'ye DEĞİL kimlik-bilgisi kavramına düşer (kategori ipucu yok)", () => {
    const e = expandQuery(contentStems("kapı şifresi nedir"));
    expect(e.matched.map((m) => m.concept.id)).toContain("credentials");
    expect(e.categoryHints.get("wifi")).toBeUndefined();
  });
});

describe("diceBigram", () => {
  it("yazım hatası yüksek benzerlik, ilgisiz kelime düşük", () => {
    expect(diceBigram("otopakr", "otopark")).toBeGreaterThan(0.6);
    expect(diceBigram("otopark", "konteyner")).toBeLessThan(0.2);
    expect(diceBigram("ab", "ab")).toBe(1);
    expect(diceBigram("a", "ab")).toBe(0);
  });
});
