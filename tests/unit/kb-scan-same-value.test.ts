import { describe, it, expect } from "vitest";
import { labeledValues, sameValueAcrossProperties } from "@/lib/kb-scan/same-value";

// ---------------------------------------------------------------------------
// BİLGİ TABANI TARAMASI T6 — aynı otopark yeri / giriş kodu iki farklı dairede (kurucu etiket notu 10-23 "yanlis-numara": "aynı numarada
// farklı daireler için varsa hemen kbden farkedilip hosta sorulsun"). Yalnız aday bulur; ev sahibine soru ikinci aşama. Fikstür "Lale".
// ---------------------------------------------------------------------------

describe("etiketli değer", () => {
  it("otopark yeri: '12 numaralı yer' · 'no: 12' · 'B-14' · 'spot 7' · 'park yeri 3'", () => {
    expect(labeledValues("Otopark ücretsizdir; 12 numaralı yer size ayrılmıştır.")).toEqual([{ kind: "parking_spot", value: "12" }]);
    expect(labeledValues("Otopark: no 12, bina arkasında.")).toEqual([{ kind: "parking_spot", value: "12" }]);
    expect(labeledValues("Parking spot B-14 is yours.")).toEqual([{ kind: "parking_spot", value: "B14" }]);
    expect(labeledValues("Parking: spot 7 in the garage.")).toEqual([{ kind: "parking_spot", value: "7" }]);
    expect(labeledValues("Park yeri 3 numaralıdır.")).toEqual([{ kind: "parking_spot", value: "3" }]);
  });

  it("giriş kodu: kapı kodu / anahtar kutusu şifresi / door code; Unicode rakam ASCII'ye iner", () => {
    expect(labeledValues("Kapı kodu: 4590.")).toEqual([{ kind: "access_code", value: "4590" }]);
    expect(labeledValues("Anahtar kutusu kapının solunda, şifresi 1234.")).toEqual([{ kind: "access_code", value: "1234" }]);
    expect(labeledValues("Door code 778899")).toEqual([{ kind: "access_code", value: "778899" }]);
    expect(labeledValues("Kapı kodu: ٤٥٩٠")).toEqual([{ kind: "access_code", value: "4590" }]);
  });

  it("Haiku 10-23 öğle: 'giriş kapısı şifresi', 'bahçe kapısı kodu', 'kapının kodu', 'parking number', 'otopark numaramız' okunur", () => {
    expect(labeledValues("Giriş kapısı şifresi 1234.")).toEqual([{ kind: "access_code", value: "1234" }]);
    expect(labeledValues("Bahçe kapısı kodu 4590")).toEqual([{ kind: "access_code", value: "4590" }]);
    expect(labeledValues("Kapının kodu 4590")).toEqual([{ kind: "access_code", value: "4590" }]);
    expect(labeledValues("Parking number 7")).toEqual([{ kind: "parking_spot", value: "7" }]);
    expect(labeledValues("Otopark numaramız 12")).toEqual([{ kind: "parking_spot", value: "12" }]);
    expect(labeledValues("Otopark no. 12")).toEqual([{ kind: "parking_spot", value: "12" }]);
  });

  it("🚨 etiketsiz sayı, saat, tutar, süre, kat, araç sayısı, telefon değer DEĞİLDİR", () => {
    for (const t of [
      "Otopark ücreti günlük 300 TL.",
      "Otopark 12:00'ye kadar açık.",
      "Otopark -2. katta.",
      "Otopark 2 araçlık.",
      "Otoparka 5 dakika yürüme mesafesi.",
      "Daire 12 numaralı binada.",
      "Anahtar kutusu için 0532 123 45 67 numarasını arayın.",
      "Kapı kodu mesajla gönderilir.",
      "Wi-Fi şifresi Lale2025.",
      // Haiku 10-23 öğle: alan ölçüsü ve sonraki cümledeki başka bir şifre değer değildir.
      "Otopark alanı 150 m2.",
      "Otopark alanı 40 m².",
      "Anahtar kutusu girişte. Wi-Fi şifresi 12345678.",
    ]) {
      expect(labeledValues(t), t).toEqual([]);
    }
  });
});

describe("aynı değer iki farklı dairede", () => {
  const items = [
    { id: "a", organizationId: "org-1", propertyId: "lale-1", title: "Otopark", content: "Otopark ücretsizdir; 12 numaralı yer size ayrılmıştır." },
    { id: "b", organizationId: "org-1", propertyId: "lale-2", title: "Otopark", content: "Otopark: no 12, bina arkasında." },
    { id: "c", organizationId: "org-1", propertyId: "lale-2", title: "Giriş", content: "Kapı kodu 4590." },
    { id: "d", organizationId: "org-1", propertyId: "lale-2", title: "Giriş (yedek)", content: "Kapı kodu 4590, pil biterse anahtar resepsiyonda." },
    { id: "e", organizationId: "org-1", propertyId: "lale-3", title: "Otopark", content: "Otopark: 14 numaralı yer." },
  ];

  it("🚨 iki dairede aynı otopark numarası bulgu; aynı dairedeki tekrar (kapı kodu iki kalemde) bulgu DEĞİL; farklı numara bulgu değil", () => {
    expect(sameValueAcrossProperties(items)).toEqual([
      {
        kind: "parking_spot",
        value: "12",
        items: [
          { propertyId: "lale-1", itemId: "a" },
          { propertyId: "lale-2", itemId: "b" },
        ],
      },
    ]);
  });

  it("aynı giriş kodu iki dairede bulgu (ortak bina kapısı olabilir — soru ev sahibine, karar onun)", () => {
    const shared = [...items, { id: "f", organizationId: "org-1", propertyId: "lale-3", title: "Bina", content: "Bina kapısı kodu 4590." }];
    expect(sameValueAcrossProperties(shared).map((f) => [f.kind, f.value, f.items.map((i) => i.propertyId)])).toEqual([
      ["access_code", "4590", ["lale-2", "lale-2", "lale-3"]],
      ["parking_spot", "12", ["lale-1", "lale-2"]],
    ]);
  });

  it("🚨 Opus 10-23 akşam R8: iki işletmenin kalemi birlikte gelirse karşılaştırma YAPILMAZ (hata) — kapı kodu kiracılar arası eşleşmez", () => {
    expect(() => sameValueAcrossProperties([...items, { id: "x", organizationId: "org-2", propertyId: "lale-9", title: "Giriş", content: "Kapı kodu 4590." }])).toThrow(
      /more than one organization/,
    );
    expect(sameValueAcrossProperties([])).toEqual([]);
  });

  it("süre: uzun etiket tekrarı / rakam dizisi doğrusal", () => {
    const t0 = performance.now();
    labeledValues("otopark ".repeat(3_000));
    labeledValues(`${"kapı kodu ".repeat(2_400)}${"1".repeat(5_000)}`);
    labeledValues("park yeri no ".repeat(1_800));
    expect(performance.now() - t0).toBeLessThan(2_000);
  });
});
