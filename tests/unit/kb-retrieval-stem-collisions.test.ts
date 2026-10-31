import { describe, it, expect } from "vitest";
import { contentStems, stem } from "@/lib/ai/retrieval/text";
import { CONCEPTS, matchConcepts } from "@/lib/ai/retrieval/lexicon";

// ---------------------------------------------------------------------------
// #208 KAVRAMLAR ARASI KÖK ÇAKIŞMASI (09-27, hata ayıklama ajanı ölçtü). "havlu" ve "hava" ikisi de "hav"a iniyordu (havalimanı
// kavramındaki "havas" da) → her Türkçe havlu sorusu HAVALİMANI kavramını, "Hava nasıl?" havlu + havalimanı kavramlarını tetikliyordu;
// "fırın" ve "fire" ikisi de "fir" → fırın sorusu YANGIN kavramını. Kural: sözlükte iki FARKLI kavramın tek sözcüklü terimi aynı köke
// inmez — bilerek paylaşılanlar ("heat": ısıtmak / ısıtma, "kombi": ısıtma / sıcak su) açık listede.
// ---------------------------------------------------------------------------

const concepts = (s: string) => matchConcepts(contentStems(s)).map((m) => m.concept.id);

describe("sözlük: kavramlar arası kök çakışması yok", () => {
  it("🚨 iki farklı kavramın terimi aynı köke inmez (bilerek paylaşılanlar hariç)", () => {
    const INTENDED = new Set(["heat", "komp"]);
    const by = new Map<string, Set<string>>();
    for (const c of CONCEPTS) {
      for (const t of c.terms) {
        if (t.includes(" ")) continue;
        const s = stem(t);
        const set = by.get(s) ?? new Set<string>();
        set.add(c.id);
        by.set(s, set);
      }
    }
    const shared = [...by.entries()].filter(([s, ids]) => ids.size > 1 && !INTENDED.has(s)).map(([s, ids]) => `${s}: ${[...ids].join(", ")}`);
    expect(shared).toEqual([]);
    // Anti-vakum: bilerek paylaşılanlar hâlâ paylaşılıyor (tarama gerçekten çalışıyor).
    expect([...INTENDED].every((s) => (by.get(s)?.size ?? 0) > 1)).toBe(true);
  });
});

describe("havlu ↔ hava ↔ havalimanı", () => {
  it("havlunun her çekimi YALNIZ havlu kavramı (havalimanı değil)", () => {
    for (const w of ["havlu", "havlular", "havluları", "havluyu", "havlusu", "havluda", "havlunuz", "havlumuz", "Havlu var mı?", "Ekstra havlu alabilir miyiz?"]) {
      expect(concepts(w), w).toEqual(["towels"]);
    }
  });
  it("'hava / havası / havasız' ne havlu ne havalimanı", () => {
    for (const w of ["Hava nasıl?", "Odanın havası ağır.", "Oda çok havasız.", "Yarın hava güzel mi?"]) {
      expect(concepts(w), w).not.toContain("towels");
      expect(concepts(w), w).not.toContain("airport");
    }
  });
  it("KONTROL — havalimanı sorusu havalimanı kavramını tetiklemeye devam eder", () => {
    expect(concepts("Havalimanına nasıl giderim?")).toContain("airport");
    expect(concepts("Is there an airport shuttle?")).toContain("airport");
  });
});

describe("fırın ↔ fire", () => {
  it("fırının her çekimi YALNIZ fırın/ocak kavramı (yangın değil)", () => {
    for (const w of ["fırın", "fırında", "fırını", "fırının", "fırına", "fırından", "fırınımız", "Fırın nasıl çalışıyor?"]) {
      expect(concepts(w), w).toEqual(["stove"]);
    }
  });
  it("KONTROL — yangın sorusu yangın kavramını tetiklemeye devam eder", () => {
    expect(concepts("Is there a fire extinguisher?")).toContain("fire");
    expect(concepts("fire alarm")).toContain("fire");
  });
});

describe("İngilizce çoğul ↔ Türkçe ünsüz yumuşaması", () => {
  it("🚨 'Are dogs allowed?' evcil hayvan kavramını bulur ('dogs' eskiden 'dok' oluyordu)", () => {
    expect(concepts("Are dogs allowed?")).toEqual(["pets"]);
    expect(stem("dogs")).toBe("dog");
    expect(stem("bags")).toBe("bag");
  });
  it("KONTROL — Türkçe ekten sonra yumuşama geri alınmaya devam eder", () => {
    expect(stem("kopegimi")).toBe("kopek");
    expect(stem("kitabi")).toBe("kitap");
    expect(concepts("Köpeğimi getirebilir miyim?")).toContain("pets");
    expect(concepts("uçağa yetişmem lazım")).toContain("airport");
  });
});

describe("para ↔ parti, see ↔ sea", () => {
  it("'para' (ödeme) gürültü / parti kavramı değil; 'parti' öyle", () => {
    expect(concepts("Kalan tutarı (para) 20:00'ye kadar ödeyin.")).not.toContain("noise");
    expect(concepts("Parayı nakit ödeyebilir miyim?")).not.toContain("noise");
    expect(concepts("Dairede parti yasaktır.")).toContain("noise");
    expect(concepts("No parties please.")).toContain("noise");
  });
  it("'see' plaj değil; 'sea' plaj", () => {
    expect(concepts("See you at 3 pm!")).not.toContain("beach");
    expect(concepts("You'll see the sign on the door.")).not.toContain("beach");
    expect(concepts("Is the sea close?")).toContain("beach");
    expect(concepts("sea view")).toContain("beach");
  });
});

