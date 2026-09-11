import { describe, it, expect } from "vitest";
import {
  buildKbSuggestionsFromTemplates,
  templateBodyToKbContent,
  TEMPLATE_CATEGORY_TO_KB,
  TEMPLATE_SUGGESTION_MAX_CHARS,
  type TemplateSource,
} from "@/lib/kb-from-templates";
import { DEFAULT_TEMPLATES } from "@/lib/templates";

// ---------------------------------------------------------------------------
// ŞABLONLARDAN KB ÖNERİSİ — kurucu kararı 09-11.
//
// 🚨 KAPATILAN BOŞLUK: `MessageTemplate` misafire AYNEN gider ve MODELDEN HİÇ
// GEÇMEZ. Host "Wi-Fi bilgisi" şablonu yazmışsa bilgi sistemde VARDIR ama
// asistan onu kullanamaz — misafir sorunca ürün devreder. Kurucu kapı koymayı
// reddetti ("zorunlu olmasın"), doğrusu bilgiyi host'un zaten yazdığı yerden
// BULMAK. Bu dosya o bulmanın sözleşmesidir.
// ---------------------------------------------------------------------------

const PROPS = [
  { id: "p1", name: "Lale 1" },
  { id: "p2", name: "Lale 2" },
];

let n = 0;
function tpl(over: Partial<TemplateSource> = {}): TemplateSource {
  n += 1;
  return {
    id: `t${n}`,
    propertyId: "p1",
    category: "wifi",
    title: "Wi-Fi bilgisi",
    body: "Ağ adı LaleApt, şifre 12345678. Modem salonda.",
    language: "tr",
    isActive: true,
    ...over,
  };
}

describe("buildKbSuggestionsFromTemplates — temel sözleşme", () => {
  it("aktif, mülke bağlı şablon O MÜLK için öneri üretir", () => {
    const out = buildKbSuggestionsFromTemplates([tpl()], [], PROPS);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ propertyId: "p1", propertyName: "Lale 1", category: "wifi", fromOrgWide: false });
    expect(out[0].content).toContain("12345678");
  });

  it("PASİF şablon öneri üretmez", () => {
    expect(buildKbSuggestionsFromTemplates([tpl({ isActive: false })], [], PROPS)).toEqual([]);
  });

  it("boş gövde öneri üretmez", () => {
    expect(buildKbSuggestionsFromTemplates([tpl({ body: "   " })], [], PROPS)).toEqual([]);
  });

  it("boş girdi çökmez", () => {
    expect(buildKbSuggestionsFromTemplates([], [], [])).toEqual([]);
    expect(buildKbSuggestionsFromTemplates([tpl()], [], [])).toEqual([]);
  });

  it("uzun gövde KELİME SINIRINDA kırpılır (ortadan bölmez)", () => {
    // ⚠️ Bu satır önce yalnız uzunluk+"…" bakıyordu; kelime sınırı mantığı
    // silinse de yeşil kalıyordu (ölçüldü). Artık kesme NOKTASI pinli.
    const body = "A".repeat(TEMPLATE_SUGGESTION_MAX_CHARS - 5) + " kelimesonu KESILEN";
    const out = buildKbSuggestionsFromTemplates([tpl({ body })], [], PROPS);
    expect(out[0].content.length).toBeLessThanOrEqual(TEMPLATE_SUGGESTION_MAX_CHARS + 1);
    expect(out[0].content.endsWith("…")).toBe(true);
    expect(out[0].content, "kelime ortasından kesilmiş").not.toMatch(/kelimeso…$/);
    expect(out[0].content.endsWith("A…"), "boşluktan kesilmeli").toBe(true);
  });
});

describe("🚨 ŞABLON DEĞİŞKENLERİ (`{{…}}`) KB'ye OLDUĞU GİBİ TAŞINMAZ", () => {
  it("{{wifiInfo}} taşıyan şablon REDDEDİLİR (kendine atıf yapan kalem)", () => {
    // ÖLÇÜLDÜ (inceleme ajanı 09-11): `kbPlaceholderTokens` yalnız [ ] < > ___
    // sınıfını tanır, `{{…}}` HİÇBİR kapıya takılmaz. Düzeltmeden önce ürün
    // "Wi-Fi bilgileriniz: {{wifiInfo}}" metnini ONAYLI BİLGİ yapıyordu ve
    // `{{wifiInfo}}` tam olarak KB'nin wifi kalemine işaret ediyor.
    const out = buildKbSuggestionsFromTemplates(
      [tpl({ body: "Merhaba,\n\nWi-Fi bilgileriniz:\n{{wifiInfo}}\n\nİyi konaklamalar." })],
      [],
      PROPS,
    );
    expect(out).toEqual([]);
  });

  it("{{checkInTime}} / {{propertyName}} de reddedilir (mülk ALANINA işaretçi)", () => {
    for (const body of ["Girişiniz {{checkInTime}} sonrası.", "{{propertyName}} kurallarımız: sigara yok."]) {
      expect(buildKbSuggestionsFromTemplates([tpl({ category: "rules", body })], [], PROPS), body).toEqual([]);
    }
  });

  it("{{guestName}} {isim}'e ÇEVRİLİR — bilgi kaybı yok, karşılığı var", () => {
    const out = buildKbSuggestionsFromTemplates(
      [tpl({ body: "Merhaba {{guestName}}, ağ adı LaleApt, şifre 12345678." })],
      [],
      PROPS,
    );
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("Merhaba {isim}, ağ adı LaleApt, şifre 12345678.");
    expect(out[0].content).not.toContain("{{");
  });

  it("🚨 VARSAYILAN ŞABLONLARIN HİÇBİRİ öneriye dönüşemez", () => {
    // Anti-vakumluk: varsayılanlar zaten DB'ye yazılmaz, ama biri onları seed
    // etse bile hepsi `{{…}}` iskelesi olduğu için bu bacak onları REDDEDER.
    const asSources = DEFAULT_TEMPLATES.map((t, i) => ({
      id: `d${i}`,
      propertyId: "p1",
      category: t.category,
      title: t.title,
      body: t.body,
      language: t.language,
      isActive: true,
    }));
    expect(asSources.length, "fikstür boşsa test hiçbir şey ölçmez").toBeGreaterThan(10);
    // 🚨 ANTI-VAKUMLUK: kararı KATEGORİ kapısının vermediğini göster —
    // allowlist'teki (wifi/rules) varsayılanlar da düşmeli, yani reddi
    // `{{…}}` kuralı veriyor.
    const allowed = asSources.filter((t) => t.category === "wifi" || t.category === "rules");
    expect(allowed.length, "allowlist kategorisinde varsayılan yoksa ölçüm boş").toBeGreaterThan(0);
    expect(buildKbSuggestionsFromTemplates(allowed, [], PROPS)).toEqual([]);
    expect(buildKbSuggestionsFromTemplates(asSources, [], PROPS)).toEqual([]);
  });

  it("templateBodyToKbContent: değişkensiz gövde AYNEN döner", () => {
    expect(templateBodyToKbContent("Sigara içilmez.")).toBe("Sigara içilmez.");
  });
});

describe("🚨 ÇİFT KOPYA ÜRETİLMEZ", () => {
  it("mülkte O KATEGORİDE zaten kalem varsa ÖNERİLMEZ", () => {
    const out = buildKbSuggestionsFromTemplates([tpl()], [{ propertyId: "p1", category: "wifi" }], PROPS);
    expect(out, "ürün host'a bildiği şeyi tekrar sormaz").toEqual([]);
  });

  it("BAŞKA kategoride kalem olması engellemez", () => {
    const out = buildKbSuggestionsFromTemplates([tpl({ category: "rules" })], [{ propertyId: "p1", category: "wifi" }], PROPS);
    expect(out).toHaveLength(1);
  });

  it("BAŞKA mülkte kalem olması engellemez", () => {
    const out = buildKbSuggestionsFromTemplates([tpl()], [{ propertyId: "p2", category: "wifi" }], PROPS);
    expect(out.map((s) => s.propertyId)).toEqual(["p1"]);
  });

  it("🚨 AYNI mülk+kategoriye düşen İKİNCİ şablon ÖNERİLMEZ (TR/EN çifti)", () => {
    // Ürün TR+EN çiftleriyle geliyor ve editörde dil alanı var. İkisini birden
    // önermek host'a aynı bilgiden İKİ kalem yaptırırdı; çelişirlerse
    // retrieval'ın çelişki koruması misafire HİÇBİR ŞEY söylemez.
    const out = buildKbSuggestionsFromTemplates(
      [
        tpl({ id: "en", language: "en", body: "Network LaleApt, password 12345678." }),
        tpl({ id: "tr", language: "tr", body: "Ağ LaleApt, şifre 12345678." }),
      ],
      [],
      PROPS,
    );
    expect(out).toHaveLength(1);
    expect(out[0].sourceTemplateId, "org dili tercih edilir").toBe("tr");
  });

  it("org dili İngilizce ise İngilizce şablon kazanır", () => {
    const out = buildKbSuggestionsFromTemplates(
      [
        tpl({ id: "tr", language: "tr", body: "Ağ LaleApt, şifre 12345678." }),
        tpl({ id: "en", language: "en", body: "Network LaleApt, password 12345678." }),
      ],
      [],
      PROPS,
      { preferredLanguage: "en" },
    );
    expect(out.map((s) => s.sourceTemplateId)).toEqual(["en"]);
  });
});

describe("🚨 ORG GENELİ şablon BOŞLUĞU DOLDURUR, doluya dokunmaz", () => {
  it("org geneli şablon yalnız O KATEGORİYİ EKSİK mülklere önerilir", () => {
    const out = buildKbSuggestionsFromTemplates(
      [tpl({ propertyId: null })],
      [{ propertyId: "p1", category: "wifi" }], // p1'de zaten var
      PROPS,
    );
    expect(out).toHaveLength(1);
    expect(out[0].propertyId).toBe("p2");
    expect(out[0].fromOrgWide, "host bunun org şablonundan geldiğini görmeli").toBe(true);
  });

  it("hiçbir mülkte yoksa HEPSİNE önerilir", () => {
    const out = buildKbSuggestionsFromTemplates([tpl({ propertyId: null })], [], PROPS);
    expect(out.map((s) => s.propertyId).sort()).toEqual(["p1", "p2"]);
  });
});

describe("🚨 DOLDURULMAMIŞ YER TUTUCU — E4 sınıfı KB'ye GİRMEZ", () => {
  it("[ŞİFRE] / <adres> / ___ taşıyan şablon ÖNERİLMEZ", () => {
    // Gerçek koşuda ölçülen sınıf: yer tutucu KB'ye girerse asistan onu GERÇEK
    // sanar ve misafire "[ŞİFRE]" gönderir.
    for (const body of [
      "Ağ adı: [AĞ ADI]\nŞifre: [ŞİFRE]",
      "Adresimiz <adres> olarak kayıtlı.",
      "Kapı kodu: ______",
    ]) {
      expect(buildKbSuggestionsFromTemplates([tpl({ body })], [], PROPS), body).toEqual([]);
    }
  });

  it("⚠️ AMA {isim}/{daire} ENGELLEMEZ — onlar çalışan ikame katmanının girdisi", () => {
    const out = buildKbSuggestionsFromTemplates(
      [tpl({ body: "Merhaba {isim}, {daire} numaralı dairemize hoş geldiniz. Ağ: LaleApt, şifre 12345678." })],
      [],
      PROPS,
    );
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain("{isim}");
  });
});

describe("🚨 KATEGORİ ALLOWLIST — dışarıda kalanların ÖLÇÜLMÜŞ gerekçesi var", () => {
  it("allowlist tam olarak iki kategori", () => {
    expect(Object.keys(TEMPLATE_CATEGORY_TO_KB).sort()).toEqual(["rules", "wifi"]);
  });

  it("şikâyet yanıtı ÖNERİLMEZ (bilgi değil, tek misafire verilen karar)", () => {
    expect(buildKbSuggestionsFromTemplates([tpl({ category: "complaint_response" })], [], PROPS)).toEqual([]);
  });

  it("🚨 giriş/çıkış şablonu ÖNERİLMEZ — saat MÜLK ALANIDIR, çift kopya çelişki yaratır", () => {
    // Gerçek koşuda E7 ölçüldü: iki kaynak çelişince ürün kesin saat SÖYLEMEZ ve
    // devreder. Çift kopya çıkarmak VAR OLMAYAN bir çelişki yaratıp ürünü
    // kötüleştirirdi. (Giriş TALİMATI ayrı bir tur — saat cümlesi ayıklanmalı.)
    for (const category of ["checkin", "checkout"]) {
      expect(buildKbSuggestionsFromTemplates([tpl({ category })], [], PROPS), category).toEqual([]);
    }
  });

  it("🚨 karşılama şablonu ÖNERİLMEZ — QR sır kapısının KATEGORİ bacağını zayıflatır", () => {
    // Aynı metin `wifi`/`checkin` kategorisindeyken QR'da İKİ bacaktan elenir
    // (`QR_SECRET_CATEGORIES` + içerik sezgiseli); `welcome`de yalnız BİR.
    const out = buildKbSuggestionsFromTemplates(
      [tpl({ category: "welcome", body: "Hoş geldiniz. Kapı kodu 4590, ağ LaleApt." })],
      [],
      PROPS,
    );
    expect(out).toEqual([]);
  });

  it("🚨 genel şablon ÖNERİLMEZ — nezaket iskelesi + makbuzsuz söz sınıfı", () => {
    // "Talebinizi aldım, en kısa sürede dönüş yapacağım" KB'ye girerse model
    // MAKBUZSUZ SÖZÜ onaylı bilgi olarak okur; 09-09'da `prompts.ts`ten tam bu
    // sınıf silinmişti, KB üzerinden geri girmesi arka kapıdır.
    const out = buildKbSuggestionsFromTemplates(
      [tpl({ category: "general", body: "Mesajınızı aldım, en kısa sürede dönüş yapacağım." })],
      [],
      PROPS,
    );
    expect(out).toEqual([]);
  });

  it("tanınmayan kategori sessizce düşer (fail-closed)", () => {
    expect(buildKbSuggestionsFromTemplates([tpl({ category: "bilinmeyen_kategori" })], [], PROPS)).toEqual([]);
  });
});

describe("kiracı/kapsam", () => {
  it("mülke bağlı şablonun mülkü listede yoksa öneri üretilmez", () => {
    // Rota org-kapsamlı sorgu atar; bu satır modülün kendi savunmasıdır.
    const out = buildKbSuggestionsFromTemplates([tpl({ propertyId: "baska-org-mulku" })], [], PROPS);
    expect(out).toEqual([]);
  });

  it("iz taşınır: kaynak şablon kimliği", () => {
    const out = buildKbSuggestionsFromTemplates([tpl({ id: "tpl-42" })], [], PROPS);
    expect(out[0].sourceTemplateId).toBe("tpl-42");
  });
});
