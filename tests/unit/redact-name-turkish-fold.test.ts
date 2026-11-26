import { describe, it, expect } from "vitest";
import { redactNameFromBody } from "@/lib/data-retention";

// ---------------------------------------------------------------------------
// AD SİLME — TÜRKÇE HARF / BÜYÜK-KÜÇÜK HARF VE BOŞLUK (09-28 inceleme ajanları, çalıştırılarak doğrulandı). `redactNameFromBody`
// saklama süpürgesi, açık silme, anlam katmanları ve üslup özetleyicisinin ortak ad silicisidir. JS'in /i bayrağı "ı"yı "I"ya,
// "İ"yi "i"ye katlamaz → "İsmail"in "ISMAIL" / "ismail" yazımı, "Işıl"ın "IŞIL"ı silinmiyor; "Ayşe Yılmaz" büyük harfle yazılınca
// yalnız ilk sözcük silinip soyadı kalıyordu; klavyesiz yazım ("Ayse Yilmaz") ve adın çift boşlukla kaydı ("Mehmet  Ali") da.
// ---------------------------------------------------------------------------

describe("Türkçe harf ve büyük/küçük harf eşleşmesi", () => {
  it.each([
    ["Merhaba, ISMAIL ben.", ["İsmail Kaya"], "Merhaba, [Misafir] ben."],
    ["ismail burada", ["İsmail Kaya"], "[Misafir] burada"],
    ["AYŞE YILMAZ geldi", ["Ayşe Yılmaz"], "[Misafir] geldi"],
    ["ayse yilmaz geldi", ["Ayşe Yılmaz"], "[Misafir] geldi"],
    ["IŞIL geldi", ["Işıl Demir"], "[Misafir] geldi"],
    ["Merhaba Mehmet Ali,", ["Mehmet  Ali"], "Merhaba [Misafir],"],
    ["GÜL ÇİÇEK aradı", ["Gül Çiçek"], "[Misafir] aradı"],
    ["Merhaba Mehmet  Ali,", ["Mehmet Ali Kaya", "Mehmet Ali"], "Merhaba [Misafir],"], // metindeki çift boşluk (mutasyon F2)
    ["Merhaba Mehmet\nAli,", ["Mehmet Ali"], "Merhaba [Misafir],"],
  ])("🚨 %j (%j) → %j", (text, names, expected) => {
    expect(redactNameFromBody(text, names)).toBe(expected);
  });

  it("KONTROL — eski davranış korunur: tam sözcük, en uzun önce, ad yoksa metin bayt bayt aynı", () => {
    expect(redactNameFromBody("Merhaba Ayşe, Ayşegül değil.", ["Ayşe"])).toBe("Merhaba [Misafir], Ayşegül değil.");
    expect(redactNameFromBody("Dairede duman var", ["Ayşe Yılmaz"])).toBe("Dairede duman var");
    expect(redactNameFromBody("a.b (c) [d]", ["a.b"])).toBe("[Misafir] (c) [d]"); // düzenli ifade karakteri kaçışlı
    expect(redactNameFromBody("Al burada", ["Al"])).toBe("Al burada"); // 2 harfli ad anahtar değil (bugünkü kural)
  });

  it("doğrusal: uzun metinde süre sınırlı", () => {
    const t0 = performance.now();
    redactNameFromBody("ı".repeat(200_000) + " Ayşe", ["Işıl Yılmaz Çiçekçioğlu", "Ayşe Gül"]);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
