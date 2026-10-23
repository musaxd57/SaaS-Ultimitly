import { describe, it, expect } from "vitest";
import { redactNameFromBody } from "@/lib/data-retention";
import { redactNameInCodeGreetingLine } from "@/lib/ai/code-greeting";

// ---------------------------------------------------------------------------
// KURUCU KARARI 09-30 — KISA ADLARIN SAKLAMA TEMİZLİĞİ. 2 harfli adlar ("Su", "Al") çakışma riski yüzünden gövdede HİÇ aranmıyordu:
// kodun / karşılama mesajının ilk satırı "Merhaba Su," saklama süresi dolsa da adı kalıcı taşıyordu. Şimdi YALNIZ o satır — tablodaki
// adlı selamla BİREBİR aynıysa — temizlenir; "Su gelmiyor" gibi şikâyet metnine dokunulmaz (körlemesine silme yok).
// ---------------------------------------------------------------------------

describe("kısa ad — yalnız kodun selam satırı", () => {
  it("🚨 'Merhaba Su,' temizlenir, 'Su gelmiyor' şikâyeti korunur", () => {
    expect(redactNameFromBody("Merhaba Su,\n\nSu gelmiyor mu? Ekibimiz bakıyor.", ["Su Kaya", "Su"])).toBe(
      "Merhaba [Misafir],\n\nSu gelmiyor mu? Ekibimiz bakıyor.",
    );
  });

  it("🚨 tablodaki diğer dillerin adlı selamı da (Hello Al, / Здравствуйте, Al!)", () => {
    expect(redactNameFromBody("Hello Al,\n\nCheck-in is at 3pm.", ["Al"])).toBe("Hello [Misafir],\n\nCheck-in is at 3pm.");
    expect(redactNameFromBody("Здравствуйте, Al!\n\nЗаезд в 15:00.", ["Al"])).toBe("Здравствуйте, [Misafir]!\n\nЗаезд в 15:00.");
  });

  it("KONTROL — selam satırı yoksa ya da başka biçimdeyse kısa ada hiç dokunulmaz", () => {
    expect(redactNameFromBody("Su gelmiyor, tesisatçı yolda.", ["Su"])).toBe("Su gelmiyor, tesisatçı yolda.");
    expect(redactNameFromBody("Merhaba,\n\nSu var.", ["Su"])).toBe("Merhaba,\n\nSu var.");
    expect(redactNameFromBody("Sevgili Su, hoş geldin.", ["Su"])).toBe("Sevgili Su, hoş geldin.");
  });

  it("KONTROL — uzun adlar eskisi gibi her yerde temizlenir", () => {
    expect(redactNameFromBody("Merhaba Ayşe,\n\nAyşe Hanım, giriş 15:00.", ["Ayşe Yılmaz", "Ayşe"])).toBe(
      "Merhaba [Misafir],\n\n[Misafir] Hanım, giriş 15:00.",
    );
  });

  it("yardımcı: yalnız İLK satır, birebir eşleşme; eşleşme yoksa bayt bayt aynı", () => {
    expect(redactNameInCodeGreetingLine("  Merhaba Su,\nSu", "Su", "[M]")).toBe("  Merhaba [M],\nSu");
    expect(redactNameInCodeGreetingLine("Metin\nMerhaba Su,", "Su", "[M]")).toBe("Metin\nMerhaba Su,");
    expect(redactNameInCodeGreetingLine("Merhaba Su, nasılsınız", "Su", "[M]")).toBe("Merhaba Su, nasılsınız");
  });
});
