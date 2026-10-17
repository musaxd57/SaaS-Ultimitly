import { describe, it, expect } from "vitest";
import { attributeEdit, EDIT_LIGHT_MAX_RATIO, MAX_DIFF_TOKENS, splitSentences, tokenize } from "@/lib/host-history/attribution";

// ---------------------------------------------------------------------------
// L4 (kurucu 10-17, "%40'tan az değişim") — taslak ↔ gönderilen farkı (Dilim 0, çağıranı yok). Kurucu eşiği, değer düzeltmesi, cümle
// atfı (taslaktan AYNEN kalan cümle asla ev sahibi kanıtı değil), yalnız harf / noktalama / selam farkı değişiklik değil.
// ---------------------------------------------------------------------------

describe("belirteçleyici", () => {
  it("saat tek belirteç; Türkçe harf katlanır; kesme ayırır", () => {
    const t = tokenize("Çıkış saatimiz 11:00'dir. Kahvaltı 9.30'da.");
    expect(t.map((x) => x.text)).toEqual(["Çıkış", "saatimiz", "11:00", "dir", "Kahvaltı", "9:30", "da"]);
    expect(t.map((x) => x.kind)).toEqual(["word", "word", "time", "word", "word", "time", "word"]);
    expect(t[0]!.folded).toBe("cikis");
    expect(t.map((x) => x.sentence)).toEqual([0, 0, 0, 0, 1, 1, 1]);
  });
  it("cümle sınırı: nokta + boşluk / son; ondalık ve alan adı bölünmez", () => {
    expect(splitSentences("Fiyat 1.5 TL. Site lixusai.com adresinde! Tamam").map((s) => s.text)).toEqual([
      "Fiyat 1.5 TL.",
      "Site lixusai.com adresinde!",
      "Tamam",
    ]);
  });
});

describe("attributeEdit", () => {
  it("🚨 kurucunun örneği: 11:00 → 12:00 (8 belirteçte 1) = %12,5 düzeltme; değer düzeltmesi parçası; yalnız o cümle ev sahibinin", () => {
    const r = attributeEdit(
      "Merhaba, çıkış saatimiz 11:00'dir. İyi yolculuklar dileriz.",
      "Merhaba, çıkış saatimiz 12:00'dir. İyi yolculuklar dileriz.",
    );
    expect(r.class).toBe("light");
    expect(r.ratio).toBeCloseTo(0.125, 5);
    expect(r.parts).toEqual([{ op: "replace", kind: "value_fix", from: "11:00", to: "12:00" }]);
    expect(r.hostSentences).toEqual(["Merhaba, çıkış saatimiz 12:00'dir."]);
  });

  it("aynen gönderim / yalnız büyük-küçük harf, noktalama ya da Türkçe harf farkı → değişiklik YOK, kanıt yok", () => {
    for (const sent of ["Çıkış saatimiz 11:00'dir.", "cikis saatimiz 11:00 dir", "ÇIKIŞ SAATİMİZ 11:00'DİR!!"]) {
      const r = attributeEdit("Çıkış saatimiz 11:00'dir.", sent);
      expect(r).toMatchObject({ class: "unchanged", ratio: 0, parts: [], hostSentences: [] });
    }
  });

  it("🚨 taslak cümlesi silindi → KALAN cümle ev sahibi kanıtı DEĞİL (yapay zekânın sözü aynen kaldı)", () => {
    const r = attributeEdit("Havuz 7/24 açıktır. Havlular dolapta.", "Havlular dolapta.");
    expect(r.parts).toEqual([{ op: "delete", kind: "deletion", from: "Havuz 7 24 açıktır", to: "" }]);
    expect(r.hostSentences).toEqual([]);
  });

  it("ev sahibinin EKLEDİĞİ cümle onun kanıtı; aynen kalan taslak cümlesi değil", () => {
    const r = attributeEdit("Otopark bina arkasında.", "Otopark bina arkasında. Giriş kartını resepsiyondan alabilirsiniz.");
    expect(r.parts).toEqual([{ op: "insert", kind: "insertion", from: "", to: "Giriş kartını resepsiyondan alabilirsiniz" }]);
    expect(r.hostSentences).toEqual(["Giriş kartını resepsiyondan alabilirsiniz."]);
    expect(r.class).toBe("rewrite"); // 4 / 7 ≥ %40 — ev sahibinin kendi cevabı (düzeltme değil)
  });

  it("yalnız selam / kapanış değişikliği (style) cümleyi dokunulmuş YAPMAZ", () => {
    const r = attributeEdit("Merhaba, Wi-Fi şifresi kutunun üstünde.", "Selam, Wi-Fi şifresi kutunun üstünde.");
    expect(r.parts).toEqual([{ op: "replace", kind: "style", from: "Merhaba", to: "Selam" }]);
    expect(r.hostSentences).toEqual([]);
    expect(r.class).toBe("light");
  });

  it("🚨 kurucu eşiği sınırları: %39,x düzeltme, tam %40 kendi cevabı", () => {
    expect(EDIT_LIGHT_MAX_RATIO).toBe(0.4);
    const ten = "bir iki üç dört beş altı yedi sekiz dokuz on";
    // 10 belirteçten 4'ü değişti → 0,40 → rewrite
    expect(attributeEdit(ten, "x1 x2 x3 x4 beş altı yedi sekiz dokuz on").class).toBe("rewrite");
    // 3'ü değişti → 0,30 → light
    expect(attributeEdit(ten, "x1 x2 x3 dört beş altı yedi sekiz dokuz on").class).toBe("light");
    // 100 belirteçten 39'u → light (sınırın hemen altı)
    const hundred = Array.from({ length: 100 }, (_, i) => `k${i}`);
    const edited = hundred.map((w, i) => (i < 39 ? `z${i}` : w));
    expect(attributeEdit(hundred.join(" "), edited.join(" ")).class).toBe("light");
    edited[39] = "z39";
    expect(attributeEdit(hundred.join(" "), edited.join(" ")).class).toBe("rewrite");
  });

  it("cümle İÇİ silme o cümleyi dokunulmuş sayar; tamamen yeni metin rewrite", () => {
    const r = attributeEdit("Havuz 09:00 ile 20:00 arası ve sauna 10:00 ile 18:00 arası açıktır.", "Havuz 09:00 ile 20:00 arası açıktır.");
    expect(r.hostSentences).toEqual(["Havuz 09:00 ile 20:00 arası açıktır."]);
    expect(attributeEdit("Otopark ücretsizdir.", "Kusura bakmayın, bu hafta otopark kapalı.").class).toBe("rewrite");
  });

  it("tavanı aşan metin: fark çıkarılmaz (parça / cümle yok), sınıf torba ölçüsüyle", () => {
    const long = Array.from({ length: MAX_DIFF_TOKENS + 5 }, (_, i) => `w${i}`).join(" ");
    expect(attributeEdit(long, long)).toMatchObject({ class: "unchanged", capped: true, parts: [], hostSentences: [] });
    const r = attributeEdit(long, `${long} ek bir cümle`);
    expect(r).toMatchObject({ class: "light", capped: true, parts: [], hostSentences: [] });
  });

  it("boş metinler patlamaz", () => {
    expect(attributeEdit("", "")).toMatchObject({ class: "unchanged", ratio: 0 });
    expect(attributeEdit("", "Yeni cevap.")).toMatchObject({ class: "rewrite", hostSentences: ["Yeni cevap."] });
  });
});
