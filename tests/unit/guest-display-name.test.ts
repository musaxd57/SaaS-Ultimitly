import { describe, it, expect } from "vitest";
import { normalizeGuestDisplayName, guestDisplayNameTooLong, GUEST_DISPLAY_NAME_MAX } from "@/lib/guest-display-name";

// ---------------------------------------------------------------------------
// U4 (kurucu 10-22): misafire görünen ad — QR başlığı. Kayıt ve okuma aynı kuralla: görünmez karakter / satır sonu / ardışık boşluk
// temizlenir, en fazla 60 karakter, boş → null (başlık yalnız marka).
// ---------------------------------------------------------------------------

describe("normalizeGuestDisplayName", () => {
  it("düz ad aynen kalır (kırpılır)", () => {
    expect(normalizeGuestDisplayName("  Deniz Manzaralı Daire  ")).toBe("Deniz Manzaralı Daire");
  });

  it("boş / yalnız boşluk / görünmez karakter / tip dışı → null", () => {
    for (const v of ["", "   ", "\u200b\u2060", "\u2800", null, undefined, 42, {}]) {
      expect(normalizeGuestDisplayName(v)).toBeNull();
    }
  });

  it("satır sonu ve denetim karakteri boşluk olur, görünmez karakter silinir, ardışık boşluk teke iner", () => {
    expect(normalizeGuestDisplayName("Lale\nDaire\t 3")).toBe("Lale Daire 3");
    expect(normalizeGuestDisplayName("La\u200ble\u202e Daire")).toBe("Lale Daire");
  });

  it("en fazla 60 karakter (harf bölünmez, sondaki boşluk atılır)", () => {
    const long = "a".repeat(59) + " bcdef";
    const out = normalizeGuestDisplayName(long)!;
    expect(Array.from(out).length).toBeLessThanOrEqual(GUEST_DISPLAY_NAME_MAX);
    expect(out).toBe("a".repeat(59));
    expect(Array.from(normalizeGuestDisplayName("🏖".repeat(80))!).length).toBe(GUEST_DISPLAY_NAME_MAX);
  });

  it("NFC: ayrık yazılmış aksan tek harfe birleşir", () => {
    expect(normalizeGuestDisplayName("Bahc\u0327e")).toBe("Bahçe");
  });

  it("uzunluk TEMİZLENMİŞ karakter sayısıyla ölçülür: 40 emoji ve görünmez karakterle şişirilmiş kısa ad geçer, 61 harf geçmez (Haiku 10-22)", () => {
    expect(guestDisplayNameTooLong("🏖".repeat(40))).toBe(false);
    expect(guestDisplayNameTooLong("Deniz" + "\u200b".repeat(56))).toBe(false);
    expect(guestDisplayNameTooLong("a".repeat(60))).toBe(false);
    expect(guestDisplayNameTooLong("a".repeat(61))).toBe(true);
  });

  it("emoji birleştiricisi korunur (aile emojisi bölünmez), yön çevirici silinir", () => {
    expect(normalizeGuestDisplayName("Aile Evi \u{1F468}\u200d\u{1F469}\u200d\u{1F467}")).toBe("Aile Evi \u{1F468}\u200d\u{1F469}\u200d\u{1F467}");
    expect(normalizeGuestDisplayName("Ev\u202e ilA")).toBe("Ev ilA");
  });
});
