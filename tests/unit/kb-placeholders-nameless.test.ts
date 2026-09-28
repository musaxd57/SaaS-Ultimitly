import { describe, it, expect } from "vitest";
import { fillGuestPlaceholders } from "@/lib/kb-placeholders";
import { suggestReplyFallback } from "@/lib/ai/fallback";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// AD BİLİNMİYORSA "Merhaba," (kurucu kararı 09-28). Sağlayıcı adı vermeyen rezervasyonu "Rezervasyon HM4K2" / "Misafir" diye
// kaydediyoruz; karşılama / giriş / çıkış mesajı bunu ad sanıp "Merhaba Rezervasyon HM4K2," yazıyordu, yedek şablon da
// "Merhaba Rezervasyon,". Artık ad bilinmiyorsa belirteç yanındaki boşluk / virgülle birlikte kalkar.
// ---------------------------------------------------------------------------

const nameless = (text: string, propertyName?: string) =>
  fillGuestPlaceholders(text, { guestFirstName: null, ...(propertyName ? { propertyName } : {}) });

describe("ad bilinmiyorken `{isim}` boşluğuyla kalkar", () => {
  it.each([
    ["Merhaba {isim}, bugün çıkış günü.", "Merhaba, bugün çıkış günü."],
    ["Hi {name}!", "Hi!"],
    ["Hoş geldin {isim}.", "Hoş geldin."],
    ["Hallo {name},\nwillkommen.", "Hallo,\nwillkommen."],
    ["Merhaba {isim}\nBugün çıkış günü.", "Merhaba\nBugün çıkış günü."],
    ["Sevgili {isim} Hanım, hoş geldiniz", "Sevgili Hanım, hoş geldiniz"],
    ["{isim}, hoş geldiniz!", "hoş geldiniz!"],
    ["Merhaba {isim}'cim, hoş geldin", "Merhaba, hoş geldin"],
    ["Merhaba { İSİM }, kapı kodu 1234.", "Merhaba, kapı kodu 1234."],
    ["مرحبا {name}، أهلا بك", "مرحبا، أهلا بك"],
    // Satır başında virgül belirteçle birlikte gider — Arapça virgül (U+060C) de virgüldür.
    ["{name}، أهلا بك", "أهلا بك"],
    ["  {isim}, hoş geldiniz", "  hoş geldiniz"],
    ["Merhaba\n{isim}, hoş geldiniz", "Merhaba\nhoş geldiniz"],
    ["Merhaba\t{ad}  ,  bugün", "Merhaba,  bugün"],
  ])("%j → %j", (input, expected) => {
    expect(nameless(input)).toBe(expected);
  });

  it("ad dışı belirteç her zamanki gibi çözülür; tanınmayan belirteç dokunulmaz", () => {
    expect(nameless("Merhaba {isim}, daire {daire} hazır. {kod}", "Lale 5")).toBe("Merhaba, daire 5 hazır. {kod}");
  });

  it("KONTROL — ad bilinince ve ad verilmeyince davranış aynı", () => {
    expect(fillGuestPlaceholders("Merhaba {isim}, bugün çıkış günü.", { guestFirstName: "Ayşe" })).toBe(
      "Merhaba Ayşe, bugün çıkış günü.",
    );
    expect(fillGuestPlaceholders("Merhaba {isim}", {})).toBe("Merhaba {isim}");
  });

  it("🚨 doğrusal: uzun boşluk / belirteç / ayraç dizisinde süre sınırlı (ReDoS kuralı)", () => {
    const inputs = [
      " ".repeat(200_000) + "{isim}",
      "{isim}" + " ".repeat(200_000) + "x",
      "a {isim}, ".repeat(20_000),
      "{".repeat(100_000),
      " \t".repeat(100_000) + "{isim}'" + "a".repeat(100_000),
    ];
    for (const input of inputs) {
      const t0 = performance.now();
      nameless(input);
      expect(performance.now() - t0).toBeLessThan(250);
    }
  });
});

function fallbackInput(guestName: string, guestMessage: string): SuggestReplyInput {
  return {
    guestMessage,
    property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00", address: null, city: null },
    reservation: { guestName, arrivalDate: new Date(), departureDate: new Date(), status: "confirmed" },
    knowledgeBase: [],
    tone: "warm",
    language: "tr",
  };
}

describe("yedek şablon (model çalışmazken) selamı", () => {
  it("🚨 yer tutucu adda ad parçası yazılmaz: 'Merhaba,' / 'Hi,'", () => {
    expect(suggestReplyFallback(fallbackInput("Rezervasyon HM4K2", "Giriş saati nedir?")).reply).toMatch(/^Merhaba,/);
    expect(suggestReplyFallback(fallbackInput("Misafir", "Giriş saati nedir?")).reply).toMatch(/^Merhaba,/);
    expect(suggestReplyFallback(fallbackInput("Rezervasyon HM4K2", "What time is check-in?")).reply).toMatch(/^Hi,/);
  });

  it("KONTROL — gerçek adda ilk ad", () => {
    expect(suggestReplyFallback(fallbackInput("Ayşe Yılmaz", "Giriş saati nedir?")).reply).toMatch(/^Merhaba Ayşe,/);
    expect(suggestReplyFallback(fallbackInput("John Smith", "What time is check-in?")).reply).toMatch(/^Hi John,/);
  });
});
