import { describe, it, expect } from "vitest";
import { fillGuestPlaceholders, guestFirstNameOf } from "@/lib/kb-placeholders";
import { ANON_NAME } from "@/lib/data-retention";
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

  // 09-28 inceleme ajanı (çalıştırılarak doğrulandı, eski kodda kırmızı): noktalama ve boşluk artıkları.
  it.each([
    ["Welcome, {name}!", "Welcome!"], // eskiden "Welcome,!"
    ["Hi, {name}, welcome", "Hi, welcome"], // eskiden "Hi,, welcome"
    ["Thank you for booking with us, {name}. See you", "Thank you for booking with us. See you"],
    ["Merhaba, {isim}.", "Merhaba."],
    ["Merhaba , {isim}!", "Merhaba!"], // virgülden önceki boşluk da gider (mutasyon W13)
    ["Hoş geldiniz, {isim}!", "Hoş geldiniz!"],
    ["Здравствуйте, {name}!", "Здравствуйте!"],
    ["Merhaba, {isim} hoş geldiniz", "Merhaba, hoş geldiniz"],
    ["Merhaba {isim} 👋", "Merhaba 👋"], // eskiden "Merhaba👋"
    ["Merhaba {isim} – hoş geldiniz", "Merhaba – hoş geldiniz"],
    ["Merhaba {isim} (misafirimiz)", "Merhaba (misafirimiz)"],
    ["{isim}! Hoş geldiniz", "Hoş geldiniz"], // eskiden "! Hoş geldiniz"
    ["Line1\n{isim},\nLine3", "Line1\nLine3"], // boşalan satır da gider
    ["Line1\r\n  {isim},\r\nLine3", "Line1\r\nLine3"],
    ["{name},\n\nWelcome to Lale!", "\nWelcome to Lale!"], // gövde kurucusu ayrıca kırpar (↓ entegrasyon)
    ["Sevgili {isim}‘in odası", "Sevgili odası"], // kesme ailesinin tamamı ek sayılır
    ["Hola {name}´s room", "Hola room"],
    ["Merhaba\u00A0{isim}, bugün", "Merhaba, bugün"], // NBSP de boşluk
  ])("🚨 %j → %j", (input, expected) => {
    expect(nameless(input)).toBe(expected);
  });

  it("KONTROL — daire belirteci ve bitişik ad: sözcük arası tek boşluk kalır", () => {
    expect(nameless("Merhaba {isim} {daire} numaralı", "Lale 5")).toBe("Merhaba 5 numaralı"); // eskiden "Merhaba5"
    expect(nameless("{isim}{daire}", "Lale 5")).toBe("5");
    expect(nameless("{isim} {isim}")).toBe("");
  });

  it("idempotent: iki kez doldurmak sonucu değiştirmez", () => {
    for (const t of ["Welcome, {name}!", "Merhaba {isim} 👋", "Line1\n{isim},\nLine3", "Hi, {name}, welcome"]) {
      expect(nameless(nameless(t))).toBe(nameless(t));
    }
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

describe("saklama sentineli ad değildir", () => {
  it("🚨 'Eski misafir' → null (eskiden 'Eski' → 'Merhaba Eski,')", () => {
    expect(guestFirstNameOf(ANON_NAME)).toBeNull();
    expect(guestFirstNameOf("ESKİ MİSAFİR")).toBeNull();
    expect(guestFirstNameOf("  eski misafir ")).toBeNull();
  });
  it("KONTROL — 'Eski' ile başlayan gerçek ad korunur", () => {
    expect(guestFirstNameOf("Eskiz Kaya")).toBe("Eskiz");
  });
});

// ---------------------------------------------------------------------------
// KURUCU KARARI 09-30 — SAYGI HİTABI ADSIZ KALMAZ: ad bilinmezken "Sayın {isim}," → "Sayın misafirimiz,", "Dear {name}," →
// "Dear guest," (Türkçe "Sevgili" = Dear, aynı kural). Ad biliniyorsa değişmez; hitapsız / kısa mesaja yeni hitap EKLENMEZ.
// ---------------------------------------------------------------------------
describe("saygı hitabı (kurucu kararı 09-30)", () => {
  const nameless = (t: string) => fillGuestPlaceholders(t, { guestFirstName: null });
  const named = (t: string) => fillGuestPlaceholders(t, { guestFirstName: "Ada" });

  it.each([
    ["Sayın {isim},\n\nGirişiniz 15:00'te.", "Sayın misafirimiz,\n\nGirişiniz 15:00'te."],
    ["Dear {name},\nWelcome!", "Dear guest,\nWelcome!"],
    ["Dear {name}\nCheck-in is at 3pm.", "Dear guest\nCheck-in is at 3pm."],
    ["Sevgili {isim}, iyi tatiller", "Sevgili misafirimiz, iyi tatiller"],
    ["Değerli {isim},", "Değerli misafirimiz,"],
    ["SAYIN {isim},", "SAYIN misafirimiz,"],
  ])("🚨 ad bilinmiyor: %j → %j", (text, expected) => {
    expect(nameless(text)).toBe(expected);
  });

  it("ad biliniyorsa değişmez", () => {
    expect(named("Sayın {isim},")).toBe("Sayın Ada,");
    expect(named("Dear {name},")).toBe("Dear Ada,");
  });

  it("KONTROL — hitapsız / sıradan selam eski kuralla (yeni hitap eklenmez)", () => {
    expect(nameless("Merhaba {isim}, bugün")).toBe("Merhaba, bugün");
    expect(nameless("Hi {name}!")).toBe("Hi!");
    expect(nameless("Hoş geldiniz!")).toBe("Hoş geldiniz!");
    expect(nameless("{isim}, hoş geldiniz")).toBe("hoş geldiniz");
    // Sözcüğün PARÇASI hitap değildir.
    expect(nameless("Kaysayın {isim}, x")).toBe("Kaysayın, x");
    // Belirteçten sonra ek varsa ("{isim}'e") ya da hitapla belirteç arasında boşluk yoksa eski kural ("misafirimiz'e" /
    // "Sayınmisafirimiz" üretilmez).
    expect(nameless("Sayın {isim}'e teşekkürler")).toBe("Sayın teşekkürler");
    expect(nameless("Sayın{isim}, hoş geldiniz")).toBe("Sayın, hoş geldiniz");
    // Addan sonra saygı sözü varsa hitap zaten tam ("Sayın Bey," / "Sevgili Hanım,") — isim eklenmez.
    expect(nameless("Sayın {isim} Bey, hoş geldiniz")).toBe("Sayın Bey, hoş geldiniz");
    expect(nameless("Sevgili {isim} Hanım, hoş geldiniz")).toBe("Sevgili Hanım, hoş geldiniz");
  });
});
