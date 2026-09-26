import { describe, it, expect } from "vitest";
import { applyTemplateBody } from "@/lib/template-apply";

// ---------------------------------------------------------------------------
// ŞABLON UYGULAMA — inbox yazma alanına düşen metin.
//
// 🚨 ÖLÇÜLEN KUSUR (09-11): tek-parantez sınıfı YARIMDI. Kod yalnız
// `{isim}`/`{ad}` tanıyordu; `{name}`, `{daire}`, `{apartment}`, `{apt}` hiçbir
// yerde çözülmüyordu ve sondaki temizlik YALNIZ `{{…}}` sildiği için ham
// belirteç yazma alanına düşüyordu. Host fark etmezse misafire "Kapı kodu:
// {daire}" gidiyordu — QR yüzeyinde 09-10'da kapatılan sınıfın ta kendisi,
// inbox'ta açık kalmıştı.
// ---------------------------------------------------------------------------

const VARS = {
  guestName: "Ahmet Yılmaz",
  propertyName: "Lale 3",
  checkInTime: "15:00",
  checkOutTime: "11:00",
  wifiInfo: "SSID: Lale3_5G / Sifre: Yaz2026! - Kapi kodu: 4590",
};

describe("applyTemplateBody — şablon değişkenleri", () => {
  it("çift parantez değişkenleri dolar", () => {
    const out = applyTemplateBody("Merhaba {{guestName}}, {{propertyName}} girişi {{checkInTime}}.", VARS);
    expect(out).toBe("Merhaba Ahmet Yılmaz, Lale 3 girişi 15:00.");
  });

  it("değeri olmayan çift parantez belirteci SİLİNİR (misafir ham {{…}} görmez)", () => {
    expect(applyTemplateBody("Bilgi: {{wifiInfo}}", { guestName: "Ali" })).toBe("Bilgi:");
  });

  it("değişken verilmezse yalnız temizlik çalışır", () => {
    expect(applyTemplateBody("Merhaba {{guestName}}, hoş geldiniz.")).toBe("Merhaba , hoş geldiniz.");
  });
});

describe("🚨 TEK PARANTEZ SINIFI — ad/daire (kb-placeholders ile parite)", () => {
  it("{daire} mülk adından çözülür", () => {
    expect(applyTemplateBody("Kapı kodu için {daire} numaralı daire.", VARS)).toBe(
      "Kapı kodu için 3 numaralı daire.",
    );
  });

  it("{apartment} ve {apt} de çözülür (İngilizce yazan host)", () => {
    expect(applyTemplateBody("Flat {apartment} / {apt}", VARS)).toBe("Flat 3 / 3");
  });

  it("{isim} ve {ad} İLK ADA çözülür (diğer üç yüzeyin davranışı)", () => {
    expect(applyTemplateBody("Merhaba {isim}, sayın {ad}.", VARS)).toBe("Merhaba Ahmet, sayın Ahmet.");
  });

  it("{name} da ad sınıfındadır", () => {
    expect(applyTemplateBody("Hello {name},", VARS)).toBe("Hello Ahmet,");
  });

  it("büyük harfli ve boşluklu yazım da çözülür ({İSİM}, { daire })", () => {
    // `/i` bayrağı Türkçe noktalı İ'yi KATLAMAZ — anahtar iki katlamadan geçer.
    expect(applyTemplateBody("{İSİM} — { daire }", VARS)).toBe("Ahmet — 3");
  });
});

describe("🚨 UYDURMA DEĞER YOK — çözülemeyen belirteç DOKUNULMAZ", () => {
  it("tanınmayan tek-parantez belirteci ({kod}) aynen kalır", () => {
    // Host'un kendi metni olabilir; silmek bilgiyi yok eder, uydurmak yalan söyler.
    expect(applyTemplateBody("Kapı kodu: {kod}", VARS)).toBe("Kapı kodu: {kod}");
  });

  it("belirsiz daire numarasında {daire} aynen kalır", () => {
    const out = applyTemplateBody("Daire {daire}", { ...VARS, propertyName: "Lale 3 | 2+1 Deniz Manzaralı" });
    expect(out, "iki sayı varsa hangisinin daire olduğu bilinmez").toBe("Daire {daire}");
  });

  it("yer tutucu ad (adsız rezervasyon) {isim}'i çözmez", () => {
    const out = applyTemplateBody("Merhaba {isim},", { ...VARS, guestName: "Rezervasyon 12345" });
    expect(out, '"Merhaba Rezervasyon," yazılmamalı').toBe("Merhaba {isim},");
  });

  it("mülk adı yoksa {daire} aynen kalır", () => {
    expect(applyTemplateBody("Daire {daire}", { guestName: "Ahmet" })).toBe("Daire {daire}");
  });
});

describe("🚨 TEK GEÇİŞ — misafir kontrolündeki değer YENİDEN TARANMAZ", () => {
  it("misafir adı {{wifiInfo}} ise wifi kalemi SIZMAZ", () => {
    // Denetim 08-07 (5): `guestName` sağlayıcıdan gelir ve misafirin kontrolündedir.
    const out = applyTemplateBody("Merhaba {{guestName}}, hoş geldiniz.", {
      ...VARS,
      guestName: "{{wifiInfo}}",
    });
    expect(out).not.toContain("Yaz2026");
    expect(out).not.toContain("4590");
  });

  it("misafir adı {daire} ise daire numarası ÜRETİLMEZ", () => {
    // Yeni tek-parantez dalının aynı geçişte olmasının sebebi: ikinci bir geçiş
    // olsaydı misafirin yazdığı metinden belirteç doğardı.
    const out = applyTemplateBody("Merhaba {{guestName}}.", { ...VARS, guestName: "{daire}" });
    expect(out).toBe("Merhaba {daire}.");
  });

  it("🚨 {{constructor}} / {{toString}} PROTOTİP üyesine çözülmez", () => {
    // Düz indekslemede `vars["constructor"]` bir FONKSİYON döner ve truthy
    // olduğu için yazma alanına "function Object() { … }" basılırdı.
    const out = applyTemplateBody("A {{constructor}} B {{toString}} C {{hasOwnProperty}}", VARS);
    expect(out).not.toContain("function");
    expect(out).not.toContain("native code");
    expect(out, "tanınmayan çift parantez belirteci temizlikte düşer").toBe("A  B  C");
  });

  it("değerdeki $& gibi kalıplar HARFİ HARFİNE kalır", () => {
    const out = applyTemplateBody("Merhaba {{guestName}}.", { ...VARS, guestName: "A$&B$1C" });
    expect(out).toBe("Merhaba A$&B$1C.");
  });
});

describe("temizlik", () => {
  it("üç ve daha fazla boş satır ikiye iner, kenarlar trimlenir", () => {
    expect(applyTemplateBody("  A\n\n\n\nB  ", VARS)).toBe("A\n\nB");
  });
});

describe("🚨 TEMİZLİK HOST'UN METNİNİ YUTMAZ (inceleme ajanı 09-11)", () => {
  it("misafir adı `Ali{{` ise şablonun geri kalanı SİLİNMEZ", () => {
    // ÖLÇÜLDÜ: geniş temizlik kalıbı (`\{\{[^}]+\}\}`) misafir kontrolündeki
    // değerin içinden başlayıp şablonun İLERİDEKİ `}}`sine kadar her şeyi
    // yutuyordu → yazma alanında yalnız "Merhaba Ali" kalıyor, host'un kendi
    // metni (kapı kodu dahil) sessizce kayboluyordu.
    const out = applyTemplateBody("Merhaba {{guestName}}, kapı kodu 1234. {{wifiInfo}}", {
      ...VARS,
      guestName: "Ali{{",
      wifiInfo: "", // mülkte wifi kalemi yok — çok yaygın
    });
    expect(out, "host'un metni yutuldu").toContain("kapı kodu 1234");
    expect(out).toContain("Ali{{");
    expect(out, "doldurulmamış {{wifiInfo}} yine de temizlenmeli").not.toContain("wifiInfo");
  });
});
