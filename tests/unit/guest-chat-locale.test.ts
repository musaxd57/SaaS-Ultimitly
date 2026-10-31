import { describe, it, expect } from "vitest";
import { GUEST_COPY, guestLocaleFromAcceptLanguage } from "@/components/guest-chat/guest-chat-copy";

// ---------------------------------------------------------------------------
// U2 (kurucu 10-22, "Evet önerin iyi"): misafir QR ekranı tarayıcı diline göre Türkçe / İngilizce. Türkçe ilk tercih değilse İngilizce;
// başlık yoksa / bozuksa Türkçe. U3: kodun adı her iki dilde "sohbet kodu / chat code" ve kapı kodu olmadığı yazılı.
// ---------------------------------------------------------------------------

describe("Accept-Language → ekran dili", () => {
  it.each([
    [null, "tr"],
    ["", "tr"],
    ["tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7", "tr"],
    ["tr", "tr"],
    ["en-GB,en;q=0.9", "en"],
    ["de-DE,de;q=0.9,en;q=0.8", "en"],
    ["ru,tr;q=0.9", "en"],
    // Ağırlık sırası başlık sırasından önce gelir.
    ["en;q=0.5,tr;q=0.9", "tr"],
    ["*", "tr"],
    ["en;q=0,tr;q=0.1", "tr"],
    ["garbage;;;", "tr"],
    // Büyük harfli / boşluklu ağırlık ve alt çizgili etiket (Haiku 10-22).
    ["en;Q=0.1,tr;q=0.9", "tr"],
    ["en; q = 0.2, tr;q=0.8", "tr"],
    ["tr_TR", "tr"],
  ])("%s → %s", (header, expected) => {
    expect(guestLocaleFromAcceptLanguage(header)).toBe(expected);
  });

  it("çok uzun başlık işi sınırlı (ilk 20 parça)", () => {
    const header = Array.from({ length: 5_000 }, () => "de;q=0.1").join(",") + ",tr;q=1";
    expect(guestLocaleFromAcceptLanguage(header)).toBe("en");
  });
});

describe("metin kümeleri", () => {
  it("iki dilde aynı anahtarlar, hepsi dolu", () => {
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(GUEST_COPY.en)).toEqual(keys(GUEST_COPY.tr));
    for (const lang of ["tr", "en"] as const) {
      for (const [k, v] of Object.entries(GUEST_COPY[lang])) {
        const text = typeof v === "function" ? (v as (n: number) => string)(3) : v;
        expect(String(text).trim().length, `${lang}.${k}`).toBeGreaterThan(0);
      }
    }
  });

  it("U3: kod 'sohbet kodu / chat code', kapı kodu olmadığı yazılı; 'giriş kodu / access code' geçmez", () => {
    expect(GUEST_COPY.tr.pinPlaceholder).toBe("Sohbet kodu");
    expect(GUEST_COPY.en.pinPlaceholder).toBe("Chat code");
    expect(GUEST_COPY.tr.pinNotDoorCode).toMatch(/kapı kodu değildir/);
    expect(GUEST_COPY.en.pinNotDoorCode).toMatch(/not the door code/);
    const all = JSON.stringify(GUEST_COPY);
    expect(all).not.toMatch(/giriş kodu|access code/i);
  });

  it("İngilizce metinde Türkçe harf yok (kopyala-yapıştır kaçağı)", () => {
    expect(JSON.stringify(GUEST_COPY.en)).not.toMatch(/[çğıöşüÇĞİÖŞÜ]/);
  });
});
