import { describe, it, expect } from "vitest";
import { messageTemplateCapMessage, messageTemplateCapNotice } from "@/lib/template-cap";

// ---------------------------------------------------------------------------
// ŞABLON SINIRINA YAKLAŞINCA UYARI (kurucu 11-20 sabah Ş-2: "Evet, 450'de uyarı" — Şablonlar sayfasında "Özel şablon sınırına
// yaklaşıyorsunuz (450 / 500)." gibi bir satır). Eşik sınırın %90'ı, SINIRDAN türetilir (sınır plan tablosundan / acil frenden gelir; 450
// koda yazılmaz). Sınıra ulaşınca uyarı satırı yerine bugünkü sınır metni (tek satır).
// ---------------------------------------------------------------------------

describe("şablon sınırı satırı — %90 eşiği", () => {
  it("🚨 500'lük sınırda 449 şablonda satır YOK, 450'de uyarı VAR", () => {
    expect(messageTemplateCapNotice(449, 500)).toBeNull();
    expect(messageTemplateCapNotice(450, 500)).toBe("Özel şablon sınırına yaklaşıyorsunuz (450 / 500).");
    expect(messageTemplateCapNotice(452, 500)).toBe("Özel şablon sınırına yaklaşıyorsunuz (452 / 500).");
    expect(messageTemplateCapNotice(499, 500)).toBe("Özel şablon sınırına yaklaşıyorsunuz (499 / 500).");
  });

  it("🚨 sınırda ve sınırın ÜSTÜNDE (eski işletme) uyarı yerine bugünkü sınır metni", () => {
    expect(messageTemplateCapNotice(500, 500)).toBe(messageTemplateCapMessage(500));
    expect(messageTemplateCapNotice(640, 500)).toBe(messageTemplateCapMessage(500));
  });

  it("eşik sınırdan türetilir (450 sabit değil): 1.000'lik sınırda 899 yok, 900 var; sayılar Türkçe biçimde", () => {
    expect(messageTemplateCapNotice(899, 1_000)).toBeNull();
    expect(messageTemplateCapNotice(900, 1_000)).toBe("Özel şablon sınırına yaklaşıyorsunuz (900 / 1.000).");
    expect(messageTemplateCapNotice(450, 1_000)).toBeNull();
    expect(messageTemplateCapNotice(1_350, 1_500)).toBe("Özel şablon sınırına yaklaşıyorsunuz (1.350 / 1.500).");
  });

  it("eşik yukarı yuvarlanır: %90 tam sayı değilse uyarı ondan sonraki ilk sayıda başlar (sınırın altında kalır)", () => {
    expect(messageTemplateCapNotice(8, 9)).toBeNull(); // 9 × 0,9 = 8,1 → eşik 9 = sınır → doğrudan sınır metni
    expect(messageTemplateCapNotice(9, 9)).toBe(messageTemplateCapMessage(9));
    expect(messageTemplateCapNotice(17, 19)).toBeNull(); // 17,1 → 18
    expect(messageTemplateCapNotice(18, 19)).toBe("Özel şablon sınırına yaklaşıyorsunuz (18 / 19).");
  });

  it("KONTROL: hiç / az şablonda satır yok", () => {
    expect(messageTemplateCapNotice(0, 500)).toBeNull();
    expect(messageTemplateCapNotice(30, 500)).toBeNull();
  });
});
