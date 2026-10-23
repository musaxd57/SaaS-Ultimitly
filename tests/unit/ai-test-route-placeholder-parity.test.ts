import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  apartmentNumberOf,
  fillGuestPlaceholdersInItems,
  GUEST_NAME_FALLBACK,
  guestFirstNameForPrompt,
  guestFirstNameOf,
} from "@/lib/kb-placeholders";
import { modelGuestFirstName } from "@/lib/ai/code-greeting";

// ---------------------------------------------------------------------------
// "AI'YI DENEYİN" KARTI ÜRETİMİ YANLIŞ TEMSİL EDİYORDU
// (Codex denetim raporu bulgu 17, 2026-09-11 — kodda doğrulandı ve İDDİA
// EDİLENDEN DAHA GENİŞ çıktı).
//
// 🚨 ÖLÇÜLEN KUSUR: `api/ai/test/route.ts` yer tutucuları KENDİ iki regex'iyle
// çözüyordu ve daire numarasını `name.match(/\d+/g)?.pop()` ile, yani adın SON
// SAYISINDAN alıyordu. Ortak modül (`kb-placeholders.ts`) bu kuralı 09-11'de
// ÖLÇEREK terk etmişti: etiket önceliği, sayaç freni, hane sınırı, belirsizde
// `null`. Dört ÜRETİM yüzeyi (oto-yanıt · inbox önerisi · QR · Gönderilenler)
// ortak modülü kullanıyordu; yalnız TEST kartı eski kuralda kalmıştı.
//
// ÖLÇÜM (yedi gerçekçi ilan adı): **7/7 AYRIŞIYOR**.
//   · "No:12 D:5 Kat:3"            → eski "3" (kat!)      / ortak "5"
//   · "DAİRE 5 - 2 Yatak Odalı"    → eski "2" (yatak!)    / ortak "5"
//   · "Trabzon 4 Kişilik Daire"    → eski "4" (kapasite!) / ortak null
//   · "2024 Yılı Dairesi"          → eski "2024" (yıl!)   / ortak null
//   · "Cozy Seaside Flat"          → eski MÜLK ADININ TAMAMI / ortak null
//
// Bedeli TEST KARTINA ÖZGÜ ve sinsi: host "AI'yı Deneyin"de doğru görünen bir
// cevap görüp özelliği AÇIYOR, üretim BAŞKA türlü davranıyor. Yani kart bir
// KALİTE ONAYI üretiyordu ve o onay dayanaksızdı.
//
// ⚠️ Bu davranış PİNSİZDİ — `ai-test-route.test.ts` ve `ai-test-autosend.test.ts`
// yer tutucu/daire hakkında tek iddia taşımıyor; düzeltme hiçbir testi kırmadı.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const ROUTE = "src/app/api/ai/test/route.ts";

/**
 * YORUMSUZ kaynak. 🚨 Bu helper olmadan iddialar KENDİ BELGELERİNE takılıyordu:
 * düzeltmenin yorumu eski kuralı ("`name.match(/\d+/g)?.pop()`") ADIYLA anlatmak
 * ZORUNDA — yoksa bir sonraki okuyucu neyin neden terk edildiğini bilemez — ve
 * ham metin taraması o açıklamayı kodun kendisi sanıyordu.
 */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");

/** Rotanın DÜZELTMEDEN ÖNCEKİ kuralı — yalnız kıyas için (ürün kodu değil). */
const legacyApartmentOf = (name: string) => name.match(/\d+/g)?.pop() ?? name;

describe("AI test rotası — yer tutucu kaynağı", () => {
  it("🚨 kendi daire-numarası çıkarımını TAŞIMAZ (ortak modülü çağırır)", () => {
    const s = code(ROUTE);
    // Anti-vakum: yorum soyma rotayı boşaltmadıysa iddia gerçekten bir şey ölçer.
    expect(s.length, "yorum soyma dosyayı boşaltmış").toBeGreaterThan(2000);
    expect(s, "eski son-sayı kuralı geri gelmiş").not.toMatch(/match\(\/\\d\+\/g\)\?\.pop\(\)/);
    // #189 (09-26): ikame seçimden SONRA, ortak girişin içinde (`retrieveKbForPrompt` `placeholders` → `fillGuestPlaceholdersInItems`).
    // Davranış (modele giden metin çözülmüş mü) `tests/integration/ai-test-route-placeholder-behavior.test.ts`te.
    expect(s).toMatch(/placeholders:\s*kbPlaceholders/);
    // Ad kaynağı ortak modül (K10-o "D", 09-28): rota `modelGuestFirstName`i (`code-greeting.ts`) çağırır; o da `kb-placeholders`in
    // kuralına düşer (anahtar kapalıyken birebir — ↓ "hitap ÜRETİMLE aynı kaynaktan").
    expect(s).toContain('from "@/lib/ai/code-greeting"');
    expect(code("src/lib/ai/code-greeting.ts")).toContain('from "@/lib/kb-placeholders"');
  });

  it("🚨 kendi belirteç regex'lerini TAŞIMAZ", () => {
    const s = code(ROUTE);
    // İkisi de ortak modülün TOKEN kuralının elle yazılmış, eksik kopyasıydı.
    expect(s).not.toMatch(/\\\{\\s\*\(isim\|ad\|name\)/);
    expect(s).not.toMatch(/\\\{\\s\*\(daire\|apartment\|apt\)/);
  });

  it("anti-vakum: ortak modül GERÇEKTEN farklı sonuç veriyor (kusur kurgusal değil)", () => {
    // Bu satır olmasaydı yukarıdaki iddialar "iki kural zaten aynıydı, taşımak
    // kozmetikti" diye okunabilirdi.
    const names = [
      "Lale 3 | 2+1 Deniz Manzaralı",
      "Lale 12 (2. kat)",
      "No:12 D:5 Kat:3",
      "Trabzon 4 Kişilik Daire",
      "2024 Yılı Dairesi",
      "Cozy Seaside Flat",
      "DAİRE 5 - 2 Yatak Odalı",
    ];
    const diverging = names.filter((n) => legacyApartmentOf(n) !== apartmentNumberOf(n));
    expect(diverging.length, "hiçbir ad ayrışmıyorsa ölçüm yanlıştı").toBe(names.length);
  });

  it("🚨 ölçülen üç YANLIŞ NUMARA artık üretilmiyor", () => {
    // Kat / yatak sayısı / kapasite daire numarası DEĞİLDİR.
    expect(legacyApartmentOf("No:12 D:5 Kat:3")).toBe("3");
    expect(apartmentNumberOf("No:12 D:5 Kat:3")).toBe("5");

    expect(legacyApartmentOf("DAİRE 5 - 2 Yatak Odalı")).toBe("2");
    expect(apartmentNumberOf("DAİRE 5 - 2 Yatak Odalı")).toBe("5");

    expect(legacyApartmentOf("Trabzon 4 Kişilik Daire")).toBe("4");
    expect(apartmentNumberOf("Trabzon 4 Kişilik Daire")).toBeNull();
  });

  it("🚨 sayısız adda MÜLK ADININ TAMAMI misafire basılmıyor", () => {
    // Eski dalın `?? property.name` düşüşü: "Kapı kodu: Cozy Seaside Flat".
    expect(legacyApartmentOf("Cozy Seaside Flat")).toBe("Cozy Seaside Flat");
    expect(apartmentNumberOf("Cozy Seaside Flat")).toBeNull();
    // `null` → uydurma değer yazılmaz; kurucu kararı 09-30: modele doldurulmamış işaret "[DAİRE NO]" gider (istem "DOLDURULMAMIŞ
    // YER TUTUCU" notu yazar, cevapta kalırsa çıktı vetosu tutar).
    const [item] = fillGuestPlaceholdersInItems([{ content: "Kapı kodu: {daire}" }], {
      propertyName: "Cozy Seaside Flat",
    });
    expect(item.content).toBe("Kapı kodu: [DAİRE NO]");
    expect(item.content).not.toContain("Cozy");
  });

  it("🚨 BAŞLIK da çözülür (eski dal yalnız `content` map'liyordu)", () => {
    // `packKnowledgeBase` isteme `- [KATEGORİ] ${title}: ${content}` yazar →
    // başlık MODELE gider. Eski test rotasında başlıktaki belirteç ham kalıyordu.
    const [item] = fillGuestPlaceholdersInItems(
      [{ title: "Hoş geldiniz {isim}", content: "Daire {daire}" }],
      { guestFirstName: "Test", propertyName: "Lale Daire 7" },
    );
    expect(item.title).toBe("Hoş geldiniz Test");
    expect(item.content).toBe("Daire 7");
  });

  it("🚨 noktalı İ taşıyan belirteç çözülür (eski `/gi` katlamıyordu)", () => {
    const [item] = fillGuestPlaceholdersInItems([{ content: "Merhaba {İSİM}" }], {
      guestFirstName: "Test",
      propertyName: "Lale Daire 7",
    });
    expect(item.content).toBe("Merhaba Test");
  });

  it("hitap ÜRETİMLE aynı kaynaktan (rota kendi sabitini yazmaz)", () => {
    const s = code(ROUTE);
    // Rota `suggestReply`a bir misafir adı veriyor; yer tutucu da AYNI addan
    // türemeli, yoksa kart kendi içinde tutarsız olur. Kaynak = üretimin MODELE giden
    // ad kuralı — 09-28'den beri TEK giriş `modelGuestFirstName` (`code-greeting.ts`: adsız yapay zekâ anahtarı
    // kapalıyken `guestFirstNameForPrompt ?? GUEST_NAME_FALLBACK`, açıkken "misafirimiz") — iki üretim yüzeyi de aynısını kullanır.
    expect(s).toContain("modelGuestFirstName(TEST_GUEST_NAME)");
    for (const prod of ["src/lib/automation.ts", "src/app/api/conversations/[id]/ai-suggest/route.ts"]) {
      expect(code(prod), prod).toContain("modelGuestFirstName(conversation.guestIdentifier)");
    }
    expect(s).not.toMatch(/replace\([^)]*\)\s*\.replace\(/);
    // Anti-vakum: o ad gerçekten bir ilk ada çözülüyor (ve iki kural gerçek adda aynı).
    expect(guestFirstNameForPrompt("Test Misafir")).toBe("Test");
    expect(guestFirstNameOf("Test Misafir")).toBe("Test");
  });

  it("🚨 anahtar KAPALIYKEN tek giriş bugünkü kuralın BİREBİR aynısı (yer tutucu / gerçek ad / boş)", () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "");
    for (const n of ["Test Misafir", "Rezervasyon HM4K2", "Misafir", "M.Ali Kaya", "K.V.S.Lakshmi", "", null, undefined]) {
      expect([n, modelGuestFirstName(n)]).toEqual([n, guestFirstNameForPrompt(n) ?? GUEST_NAME_FALLBACK]);
    }
    // Anti-vakum: yer tutucu adda gerçekten yedeğe düşülüyor (iki dal da sınanıyor).
    expect(modelGuestFirstName("Rezervasyon HM4K2")).toBe(GUEST_NAME_FALLBACK);
    expect(modelGuestFirstName("Test Misafir")).toBe("Test");
  });
});

afterEach(() => vi.unstubAllEnvs());
