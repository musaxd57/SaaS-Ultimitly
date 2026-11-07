import { describe, it, expect } from "vitest";
import { unsupportedCourtesyMessage, unsupportedCourtesyTokens } from "@/lib/courtesy-text";
import { hasUnfilledPlaceholders, unfilledPlaceholderTokens } from "@/lib/auto-messages/render";

// Tur 7 (kurucu onayı 11-05): nezaket metni KAYITTA denetlenir — gönderim kapısıyla aynı alan kuralı.
describe("nezaket metni — desteklenmeyen alan", () => {
  it("desteklenen alanlar ve düz metin kabul", () => {
    for (const t of ["", "Rica ederiz!", "Rica ederiz {isim}, keyifli konaklamalar!", "Daire {daire} sizi bekliyor", "Hi {name} 😊"]) {
      expect(unsupportedCourtesyTokens(t)).toEqual([]);
    }
  });

  it("🚨 desteklenmeyen alanlar listelenir; ev sahibi metni onaylı biçimde", () => {
    expect(unsupportedCourtesyTokens("Rica ederiz! Adres: [ADRES]")).toEqual(["[ADRES]"]);
    expect(unsupportedCourtesyTokens("Rica ederiz {{guestName}}")).toEqual(["{{guestName}}"]);
    expect(unsupportedCourtesyTokens("Kod: %KOD%")).toEqual(["%KOD%"]);
    expect(unsupportedCourtesyMessage(["[ADRES]"])).toBe("[ADRES] desteklenmiyor. Kullanılabilir alanlar: {isim}, {daire}.");
  });

  it("alan listesi gönderim kapısıyla AYNI kural (liste boş ⇔ kapı geçer)", () => {
    const samples = [
      "Merhaba Ayşe",
      "Adres: [AÇIK ADRES]",
      "{{wifiInfo}}",
      "Şifre {sifre}",
      "%KOD% girin",
      "<KAPI KODU>",
      "{daire}",
      "Rica ederiz 😊 [not]",
      "Konum: https://www.google.com/maps/place/B%C3%BCy%C3%BCkada",
      "Tamam {{",
    ];
    for (const s of samples) expect(unfilledPlaceholderTokens(s).length > 0).toBe(hasUnfilledPlaceholders(s));
  });
});

describe("alan taraması — karesel iş yok (ReDoS kuralı)", () => {
  it("50.000 karakterlik '{{{{…' dizisi hızlı taranır", () => {
    const t0 = performance.now();
    unfilledPlaceholderTokens("{".repeat(50_000));
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

