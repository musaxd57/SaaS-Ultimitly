import { describe, it, expect } from "vitest";
import { maskGuestIdentity } from "@/lib/ai/guest-identity-mask";

// ---------------------------------------------------------------------------
// MİSAFİR ADI MASKESİ — KURAL 09-30 (kurucu kararı): ad YALNIZ kimlik konumunda "[Misafir]" olur; anlamlı sözcük silinmez; TAM
// GİZLİLİK İDDİASI YOK. Doğrudan birim tablosu (uçtan uca kanıt `code-greeting-canary-flow` / `code-greeting-prompt`).
// ---------------------------------------------------------------------------

const ALEX = ["Alex Brown"];
const DENIZ = ["Deniz Kaya", "Deniz"];

describe("maskGuestIdentity — misafir metni", () => {
  it.each([
    ["Merhaba, benim adım Deniz. Deniz manzarası var mı?", DENIZ, "Merhaba, benim adım [Misafir]. Deniz manzarası var mı?"],
    ["Ben Deniz, yarın geliyoruz.", DENIZ, "Ben [Misafir], yarın geliyoruz."],
    ["Deniz Kaya olarak yazıyorum", DENIZ, "[Misafir] olarak yazıyorum"],
    ["Otopark var mı?\nTeşekkürler,\nDeniz", DENIZ, "Otopark var mı?\nTeşekkürler,\n[Misafir]"],
    ["Hi, I'm Alex! Is there parking?", ALEX, "Hi, I'm [Misafir]! Is there parking?"],
    // Tam kapı 09-30'da yakaladı: adın ARDINDAN gelen tanıtma ("Alex here") ve form biçimi.
    ["Hi, Alex here. We land at 8am.", ALEX, "Hi, [Misafir] here. We land at 8am."],
    ["Alex hier, wir kommen um 8.", ALEX, "[Misafir] hier, wir kommen um 8."],
    ["Name: Alex", ALEX, "Name: [Misafir]"],
    ["Guest name: Alex", ALEX, "Guest name: [Misafir]"],
    ["Hier ist Alex", ALEX, "Hier ist [Misafir]"],
    ["Ad: Deniz", DENIZ, "Ad: [Misafir]"],
    // Kimlik konumunda adın ardındaki ad sözcükleri de (kanal tam adı soyad önde yazsa da).
    ["ben Brown Alex, merhaba", ["Alex Brown", "Alex"], "ben [Misafir], merhaba"],
    // Tam ad iki DOĞAL sırada da her yerde (mutasyon 09-30): kanal adı önde saklıyorsa soyad önde yazılışı, soyad önde saklıyorsa
    // ad önde yazılışı. Ad bloğu kendi sırasını korur ("Mehmet Ali"); tam ters sıra ("Kaya Ali Mehmet") doğal bir yazılış değildir.
    ["Rezervasyon Kaya Mehmet Ali adına.", ["Mehmet Ali Kaya"], "Rezervasyon [Misafir] adına."],
    ["Rezervasyon Mehmet Ali Kaya adına.", ["Kaya Mehmet Ali"], "Rezervasyon [Misafir] adına."],
  ])("🚨 kimlik konumu maskelenir: %j", (text, names, expected) => {
    expect(maskGuestIdentity(text, names, "guest")).toBe(expected);
  });

  it.each([
    ["Deniz manzarası var mı?", DENIZ],
    ["15 Nisan'da gelebilir miyiz?", ["Nisan Er"]],
    ["Is the Alex river view nice?", ALEX],
    ["Hi Alex, here is my question", ALEX], // misafir birine "Alex" diye sesleniyor — kendi kimliği değil
    ["Denizde yüzebilir miyiz?", DENIZ],
  ])("anlamlı sözcük / kimlik dışı kullanım silinmez (bayt bayt aynı): %j", (text, names) => {
    expect(maskGuestIdentity(text, names, "guest")).toBe(text);
  });
});

describe("maskGuestIdentity — bizim metnimiz", () => {
  it("yalnız hitap: 'Merhaba Deniz,' / 'Deniz Hanım'; aynı sözcük içerikte kalır", () => {
    expect(maskGuestIdentity("Merhaba Deniz,\n\nDeniz manzaralı balkon mevcut.", DENIZ, "ours")).toBe(
      "Merhaba [Misafir],\n\nDeniz manzaralı balkon mevcut.",
    );
    expect(maskGuestIdentity("Deniz Hanım, giriş 15:00.", DENIZ, "ours")).toBe("[Misafir] Hanım, giriş 15:00.");
    // Misafir satırındaki kimlik kalıbı bizim metnimizde kimlik değildir ("Ben Deniz'e bakan odayı öneririm" gibi).
    expect(maskGuestIdentity("Name: Deniz manzaralı oda", DENIZ, "ours")).toBe("Name: Deniz manzaralı oda");
  });

  it("ad yoksa / sentinel ise metin bayt bayt aynı", () => {
    expect(maskGuestIdentity("Merhaba Deniz,", [], "ours")).toBe("Merhaba Deniz,");
    expect(maskGuestIdentity("Ben Eski misafir", ["Eski misafir"], "guest")).toBe("Ben Eski misafir");
  });
});
