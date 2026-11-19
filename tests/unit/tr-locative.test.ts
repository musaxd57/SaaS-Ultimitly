import { describe, expect, it } from "vitest";
import { locativeSuffixTr } from "@/lib/tr-locative";

// ---------------------------------------------------------------------------
// Türkçe bulunma eki (UA-1 panel satırı: "Bu rezervasyon Lale 3 ve Lale 5'te görünüyor"). Ünlü uyumu + sert ünsüz; rakam okunuşuyla.
// ---------------------------------------------------------------------------

describe("locativeSuffixTr", () => {
  it("daire adları (görev örnekleri)", () => {
    expect(locativeSuffixTr("Lale 3")).toBe("'te");
    expect(locativeSuffixTr("Lale 5")).toBe("'te");
    expect(locativeSuffixTr("Lale 6")).toBe("'da");
    expect(locativeSuffixTr("Deniz")).toBe("'de");
    expect(locativeSuffixTr("Ada")).toBe("'da");
    expect(locativeSuffixTr("Kat 4")).toBe("'te");
  });

  it("rakam okunuşu: 0–10", () => {
    const expected: Record<string, string> = {
      "1": "'de", // bir
      "2": "'de", // iki
      "3": "'te", // üç
      "4": "'te", // dört
      "5": "'te", // beş
      "6": "'da", // altı
      "7": "'de", // yedi
      "8": "'de", // sekiz
      "9": "'da", // dokuz
      "0": "'da", // sıfır
      "10": "'da", // on
    };
    for (const [n, s] of Object.entries(expected)) expect(locativeSuffixTr(`Lale ${n}`), n).toBe(s);
  });

  it("çok basamaklı sayı: son okunan sözcük (onlar, yüz, bin, milyon)", () => {
    expect(locativeSuffixTr("Daire 12")).toBe("'de"); // on iki
    expect(locativeSuffixTr("Daire 13")).toBe("'te"); // on üç
    expect(locativeSuffixTr("Daire 20")).toBe("'de"); // yirmi
    expect(locativeSuffixTr("Daire 30")).toBe("'da"); // otuz
    expect(locativeSuffixTr("Daire 40")).toBe("'ta"); // kırk
    expect(locativeSuffixTr("Daire 60")).toBe("'ta"); // altmış
    expect(locativeSuffixTr("Daire 70")).toBe("'te"); // yetmiş
    expect(locativeSuffixTr("Daire 90")).toBe("'da"); // doksan
    expect(locativeSuffixTr("Daire 100")).toBe("'de"); // yüz
    expect(locativeSuffixTr("Daire 2000")).toBe("'de"); // iki bin
    expect(locativeSuffixTr("Daire 1000000")).toBe("'da"); // bir milyon
    expect(locativeSuffixTr("Daire 07")).toBe("'de"); // (sıfır) yedi
    expect(locativeSuffixTr("Daire 00")).toBe("'da"); // sıfır
  });

  it("harfle biten adlar: kalın / ince ünlü, sert / yumuşak ünsüz, Türkçe büyük harf", () => {
    expect(locativeSuffixTr("Loft")).toBe("'ta");
    expect(locativeSuffixTr("Suite")).toBe("'de");
    expect(locativeSuffixTr("Bahçe Ev")).toBe("'de");
    expect(locativeSuffixTr("Köşk")).toBe("'te");
    expect(locativeSuffixTr("Sahil Evi")).toBe("'de");
    expect(locativeSuffixTr("KUŞADASI")).toBe("'da"); // "I" → "ı" (Türkçe küçük harf)
    expect(locativeSuffixTr("İZMİR")).toBe("'de");
    expect(locativeSuffixTr("Blok 3A")).toBe("'da"); // son ses "a"
  });

  it("sondaki noktalama / boşluk atlanır; ünlüsüz kısaltma ve boş ad → 'de", () => {
    expect(locativeSuffixTr("Lale (Üst)")).toBe("'te");
    expect(locativeSuffixTr("Lale 6. ")).toBe("'da");
    expect(locativeSuffixTr("Blok B")).toBe("'de");
    expect(locativeSuffixTr("TRT")).toBe("'de");
    expect(locativeSuffixTr("")).toBe("'de");
    expect(locativeSuffixTr("—")).toBe("'de");
  });
});
