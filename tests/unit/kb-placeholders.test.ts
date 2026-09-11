import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  GUEST_NAME_FALLBACK,
  apartmentNumberOf,
  fillGuestPlaceholders,
  fillGuestPlaceholdersInItems,
  guestFirstNameOf,
  hasNamePlaceholder,
} from "@/lib/kb-placeholders";

// ---------------------------------------------------------------------------
// YER TUTUCU İKAMESİ — TEK KAYNAK (09-10).
//
// Ölçülen boşluk (ajan, kod-doğrulandı): `{isim}`/`{daire}` ikamesi ÜÇ yerde
// ayrı ayrı yazılmıştı (automation.ts göndericisi, inbox `ai-suggest` rotası,
// Gönderilenler önizlemesi) ve DÖRDÜNCÜ yüzeyde — halka açık QR asistanında —
// HİÇ YOKTU: host'un karşılama şablonu KB'de duruyorsa misafire ham "{isim}"
// gidebiliyordu. Bu modül saf ve DB'siz; dört yüzey de buradan geçer.
//
// 🚨 QR'DA GERÇEK AD KULLANILMAZ: QR bağlantısı daireye asılıdır ve cihaz
// bağlaması konaklama başınadır — sohbeti açan kişi rezervasyon sahibi
// OLMAYABİLİR (eş, arkadaş, temizlikçi). Rezervasyon sahibinin adını ona
// göstermek hem yanlış hitap hem PII sızıntısıdır → `GUEST_NAME_FALLBACK`.
// ---------------------------------------------------------------------------

describe("apartmentNumberOf — etiket > tek sayı > BELİRSİZ (null)", () => {
  it.each([
    // Etiketli: host niyetini açıkça yazmış
    ["Daire 1", "1"],
    ["Blok 2 Daire 15", "15"],
    ["Nuve no: 7", "7"],
    ["Apt 12 - Sahil", "12"],
    // Tek sayı: belirsizlik yok
    ["nuve 3", "3"],
    ["nuve teras 4", "4"],
    // ── İNCELEME TURU 3 (09-11, ölçüldü) ──
    // (a) `/i` Türkçe noktalı İ'yi KATLAMAZ → etiket dalına hiç girmiyordu, iki sayılı
    //     ada düşüp `null` dönüyordu (host açıkça "DAİRE 5" yazmışken).
    ["DAİRE 5 - 2 Yatak Odalı", "5"],
    ["DAİRE 5", "5"],
    // (b) Etiketlerin KELİME SINIRI yoktu → "no" başka kelimenin içinde yakalanıyordu.
    ["Milano 12 | Daire 3", "3"],
    ["Milano Residence Daire 7", "7"],
    // 🚨 KELİME SINIRINI İZOLE EDEN satırlar (inceleme turu 6): yukarıdaki ikisinde "güçlü
    // etiket önce" kuralı zaten doğru cevabı veriyor, yani lookbehind silinse de yeşil kalırlardı.
    ["Milano 12 | 2+1 Deniz", null],   // zayıf sınır: sınırsız regex "12" derdi
    ["Yenidaire 12 | 2+1", null],      // güçlü sınır: sınırsız regex "12" derdi
    // ZAYIF etiket dalını izole eden satır (adda İKİ sayı var → "tek sayı" dalı cevap veremez)
    ["Nuve Blok 2 no: 7", "7"],
    // `foldedForms`un STANDART katlama bacağı (noktasız ASCII I; tr katlama "daıre" verir)
    ["DAIRE 5 - 2 Yatak Odalı", "5"],
    // Hane SINIRI ≤3: iki ve üç haneli çıplak numara hâlâ daire numarasıdır (kural yutmuyor).
    ["Nuve Teras 12", "12"],
    ["Kule 104", "104"],
    // 🚨 SAYISIZ → null (inceleme turu 5): eskiden MÜLK ADININ TAMAMI dönüyordu ve ikame
    // doğrudan yapılıyordu — KB'deki "Kapı kodu: {daire}" satırı misafire
    // "Kapı kodu: Cozy Seaside Flat" olarak gidiyordu. Belirtecin görünür kalması yeğdir.
    ["Deniz Manzara", null],
    ["Cozy Seaside Flat", null],
    ["", null],
    // ETİKET ÖNCELİĞİ: "no/#" bina numarası da olabilir; güçlü etiket ("daire/D:") önce.
    ["No:12 D:5", "5"],
    ["No 7 Daire 3", "3"],
    // ── İNCELEME TURU 6 (09-11): SAYAÇ ve HANE kuralları ETİKETLİ yolda HİÇ çalışmıyordu ──
    // Etiket eşleşince anında dönülüyordu → kapasite/yıl misafire DAİRE NUMARASI diye gidiyordu.
    // Aynı adın etiketsiz hâli doğru davranıyordu; ölçülen asimetri.
    ["Sahilde Daire 6 Kişilik", null],
    ["Merkezi Daire 2 Odalı", null],
    ["Nuve Apt 6 Kişilik", null],
    ["Daire 3 Yatak Odalı", null],
    ["Daire 90 Metrekare", null],
    // ZAYIF etikette hane sınırı ("no/#" bina numarası da olabilir; yıl kabul edilmemeli)
    ["Nuve Rezidans No 2024", null],
    ["Kule No 1907", null],
    // 🚨 GÜÇLÜ etikette hane sınırı YOK (host niyeti açık): rezidans kapı numarası korunur
    ["Skyland Daire 4590", "4590"],
    // İNGİLİZCE sayaç sözcükleri: etiket dalı İngilizceyi kabul ediyordu, sayaç listesi TR-only'ydi
    ["Luxury 2 Bedroom Flat", null],
    ["Cozy Studio for 4 Guests", null],
    ["Beach House 6 Sleeps", null],
    ["Studio 35 sqm", null],
    ["Modern Apt 2 Bath", null],
    // 🚨 ÇAPA ŞARTI: sayaç YALNIZ sayıyı HEMEN izleyen sözcükte aranır — araya RAKAM girerse
    // bakılmaz. Çapasız arama bu satırı ("5" doğru) "yatak" yüzünden düşürürdü.
    ["Daire 5 - 2 Yatak Odalı", "5"],
  ])("%s → %s", (name, expected) => {
    expect(apartmentNumberOf(name)).toBe(expected);
  });

  it("🚨 BELİRSİZ → null: 'son sayı' kuralı Türkiye ilan adlarında YANLIŞ numara üretiyordu", () => {
    // Ölçüldü (inceleme 09-10): eski "son sayı" kuralı sırasıyla "1", "2", "2024" veriyordu.
    expect(apartmentNumberOf("Nuve 3 | 2+1 Deniz Manzaralı")).toBe(null);
    expect(apartmentNumberOf("Nuve 12 (2. kat)")).toBe(null);
    // 🚨 ÖNCEKİ TURUN PİNİ YANLIŞ BEKLENTİYİ KODLUYORDU (inceleme 09-11): "2024 Yılı
    // Dairesi" için "2024" DOĞRU sayılmıştı — oysa bu bir YIL, misafire uydurma daire
    // numarası söylüyordu. Türkiye'de daire numarası pratikte ≤3 hanedir.
    expect(apartmentNumberOf("2024 Yılı Dairesi")).toBe(null);
    // Aynı sınıf: sayıyı bir SAYAÇ sözcüğü izliyorsa o sayı kapasite/ölçüdür, daire değil.
    expect(apartmentNumberOf("Trabzon 4 Kişilik Daire")).toBe(null);
    expect(apartmentNumberOf("Bodrum 3 Yatak Odalı Ev")).toBe(null);
    expect(apartmentNumberOf("Çeşme 2 Katlı Villa")).toBe(null);
    // KARŞI YÖN: sayaç sözcüğü YOKSA tek sayı hâlâ daire numarasıdır (kural yutmuyor).
    expect(apartmentNumberOf("Bodrum Villa 8")).toBe("8");
    expect(apartmentNumberOf("Arnavutköy 5 numara")).toBe("5");
    // ETİKET belirsizliği ÇÖZER: iki sayı var ama host "Daire 5" demiş.
    expect(apartmentNumberOf("Daire 5 - 2 Yatak Odalı")).toBe("5");
  });

  it("belirsiz mülk adında {daire} DOKUNULMAZ (yanlış numara söylenmez)", () => {
    expect(fillGuestPlaceholders("Daire {daire}", { propertyName: "Nuve 3 | 2+1" })).toBe("Daire {daire}");
    expect(fillGuestPlaceholders("Daire {daire}", { propertyName: "Nuve 3" })).toBe("Daire 3");
  });
});

describe("guestFirstNameOf — yer tutucu adlar GERÇEK ad değildir", () => {
  it("gerçek ad ilk kelimeye iner; 'Rezervasyon'/'Misafir' ve boş null döner", () => {
    expect(guestFirstNameOf("Ayşe Yılmaz")).toBe("Ayşe");
    expect(guestFirstNameOf("  Mehmet  ")).toBe("Mehmet");
    expect(guestFirstNameOf("Rezervasyon 12345")).toBeNull();
    expect(guestFirstNameOf("Misafir")).toBeNull();
    expect(guestFirstNameOf("   ")).toBeNull();
  });

  it("BÜYÜK/KÜÇÜK HARFE DUYARSIZ (Türkçe katlama): 'rezervasyon 12345' / 'MİSAFİR' de yer tutucudur; 'Misafir Ahmet' GERÇEK addır", () => {
    for (const n of ["rezervasyon 12345", "REZERVASYON 12345", "misafir", "MİSAFİR", "Misafir"]) {
      expect(guestFirstNameOf(n), n).toBeNull();
    }
    // TAM eşleşme şartı: türetilmiş/gerçek adlar korunur.
    expect(guestFirstNameOf("Misafirhan Yılmaz")).toBe("Misafirhan");
    expect(guestFirstNameOf("Rezervasyonu Ali")).toBe("Rezervasyonu");
  });
});

describe("fillGuestPlaceholders — tek geçiş, harfi harfine ikame", () => {
  it("{isim}/{ad}/{name} ve {daire}/{apartment}/{apt} biçimleri (boşluklu + büyük harfli) çözülür", () => {
    const t = "Merhaba { isim }, {ad} {NAME} — {daire} / {APARTMENT} / { apt }";
    expect(fillGuestPlaceholders(t, { guestFirstName: "Ayşe", propertyName: "nuve 3" })).toBe(
      "Merhaba Ayşe, Ayşe Ayşe — 3 / 3 / 3",
    );
  });

  it("🚨 TÜRKÇE BÜYÜK HARF: {İSİM} ve {ISIM} de çözülür — `/i` bayrağı noktalı İ'yi KATLAMAZ (ölçüldü: eski regex bunu kaçırıyordu)", () => {
    for (const token of ["{İSİM}", "{ISIM}", "{İsim}", "{Isim}"]) {
      expect(fillGuestPlaceholders(`Merhaba ${token}!`, { guestFirstName: "Ayşe" }), token).toBe("Merhaba Ayşe!");
      expect(hasNamePlaceholder(`Merhaba ${token}!`), token).toBe(true);
    }
    expect(fillGuestPlaceholders("Daire {DAİRE}", { propertyName: "nuve 3" })).toBe("Daire 3");
  });

  it("🚨 ad/daire değerindeki `$` kalıpları HARFİ HARFİNE girer (replace callback; string ikame misafirin mesajını bozardı)", () => {
    expect(fillGuestPlaceholders("Merhaba {isim}!", { guestFirstName: "$& $1 $` $$" })).toBe("Merhaba $& $1 $` $$!");
    // 🚨 Mülk adı artık sayısızsa `null` döner (ikame yok) → `$` kalıbı SAYIYLA sınanır:
    // etiketli ad "Daire $& 7" numarayı verir ve değer harfi harfine girer.
    expect(fillGuestPlaceholders("Kapı {daire}", { propertyName: "Daire 7 $& blok" })).toBe("Kapı 7");
    expect(fillGuestPlaceholders("Kapı {daire}", { propertyName: "blok $&" })).toBe("Kapı {daire}");
  });

  it("🚨 guestFirstNameOf İKİ katlamadan geçer: ASCII büyük harf yazım da yer tutucudur", () => {
    // Tek `toLocaleLowerCase("tr")` kaçırıyordu: "MISAFIR" → tr katlamada "mısafır" (eşleşmez)
    // → misafire "Merhaba MISAFIR," gidiyordu (ölçüldü, inceleme turu 6).
    for (const g of ["MİSAFİR", "MISAFIR", "misafir", "REZERVASYON 12345", "rezervasyon 9"]) {
      expect(guestFirstNameOf(g), g).toBeNull();
    }
    // KARŞI YÖN: gerçek ad KORUNUR (TAM eşleşme şartı).
    expect(guestFirstNameOf("Misafirhan")).toBe("Misafirhan");
    expect(guestFirstNameOf("Misafir Ahmet")).toBeNull(); // ilk sözcük tam eşleşiyor
  });

  it("🚨 BAŞLIK da çözülür: `packKnowledgeBase` başlığı isteme YAZIYOR (ham {isim} modele gidiyordu)", () => {
    const [out] = fillGuestPlaceholdersInItems(
      [{ title: "Hoş geldiniz {isim} — {daire}", content: "Kapı: {daire}" }],
      { guestFirstName: GUEST_NAME_FALLBACK, propertyName: "Daire 7" },
    );
    expect(out.title).toBe(`Hoş geldiniz ${GUEST_NAME_FALLBACK} — 7`);
    expect(out.content).toBe("Kapı: 7");
    // Başlığı OLMAYAN kalem de bozulmaz (alan opsiyonel).
    expect(fillGuestPlaceholdersInItems([{ content: "Kapı: {daire}" }], { propertyName: "Daire 7" })[0])
      .toEqual({ content: "Kapı: 7" });
  });

  it("mülk adı verilmezse {daire} DOKUNULMAZ (uydurma değer yok); ad verilmezse {isim} dokunulmaz", () => {
    expect(fillGuestPlaceholders("Daire {daire}", { guestFirstName: "Ayşe" })).toBe("Daire {daire}");
    expect(fillGuestPlaceholders("Merhaba {isim}", { propertyName: "nuve 3" })).toBe("Merhaba {isim}");
  });

  it("yer tutucusuz metin AYNEN döner; başka süslü parantez ({kod}) dokunulmaz", () => {
    expect(fillGuestPlaceholders("Wi-Fi şifresi: nuve2024", { guestFirstName: "Ayşe", propertyName: "nuve 3" })).toBe(
      "Wi-Fi şifresi: nuve2024",
    );
    expect(fillGuestPlaceholders("Kod {kod}", { guestFirstName: "Ayşe", propertyName: "nuve 3" })).toBe("Kod {kod}");
  });

  it("hasNamePlaceholder ardışık çağrıda kararlı (global bayrak yok → lastIndex tuzağı yok) ve YALNIZ ad belirtecine bakar", () => {
    const s = "Merhaba {isim}, hoş geldiniz.";
    expect(hasNamePlaceholder(s)).toBe(true);
    expect(hasNamePlaceholder(s)).toBe(true);
    expect(hasNamePlaceholder("Merhaba, hoş geldiniz.")).toBe(false);
    // 🚨 BELİRTEÇ VAR ama AD DEĞİL: "her süslü parantez ad sayılır" mutantını yakalayan satır.
    // (Bu yüklem karşılama gövdesini seçer: true → host'un şablonu AYNEN gider, false → "Merhaba X,"
    // öneki + imza eklenir. Yanlış true, imzayı ve selamlamayı sessizce düşürür.)
    expect(hasNamePlaceholder("Daire {daire} numaralı dairedesiniz.")).toBe(false);
    expect(hasNamePlaceholder("Kapı kodu {kod}.")).toBe(false);
  });

  it("GUEST_NAME_FALLBACK gerçek bir ada BENZEMEZ (QR'da bunu kullanıyoruz)", () => {
    expect(GUEST_NAME_FALLBACK).toBe("misafirimiz");
  });
});

describe("TEK KAYNAK PİNİ — dört yüzey de bu modülü kullanır, kendi regex'ini YAZMAZ", () => {
  const read = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");
  const SURFACES = [
    "src/lib/automation.ts",
    "src/app/api/conversations/[id]/ai-suggest/route.ts",
    "src/app/(app)/sent/page.tsx",
    "src/lib/guest-chat.ts",
  ];

  it.each(SURFACES)("%s modülü import eder", (rel) => {
    expect(read(rel)).toMatch(/from "@\/lib\/kb-placeholders"/);
  });

  it.each(SURFACES)("%s içinde ELLE yazılmış yer tutucu belirteci KALMADI (bayt-birebir DEĞİL, sınıf taraması)", (rel) => {
    const src = read(rel);
    // 🚨 İlk yazım BAYT-BİREBİRDİ (`\\\{\\s\*\(isim\|ad\|name\)`) ve ölçüldü: on varyantın SEKİZİ
    // kaçıyordu (`\s*` yok · `{` kaçışsız · alternatif sırası değişik · `(?:…)` · `replaceAll` ·
    // `split/join`…). Artık SINIF taranır: kaynakta bir yer tutucu ADI geçen herhangi bir
    // regex/replace/split literali. Davranışsal pinler ↑ (dört yüzey de modülü import eder) ve
    // `qr-kb-placeholder-parity.test.ts`.
    const lines = src.split("\n").filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"));
    for (const line of lines) {
      const usesToken = /(isim|daire|apartment|apt)\b/.test(line) && /[\\{]\s*\\?\{|replace|split\(|RegExp/.test(line);
      // Modülün kendi import satırı ve fonksiyon çağrıları serbest; yasak olan ikame MEKANİZMASI.
      const isSubstitution = /\.replace\s*\(|\.replaceAll\s*\(|new RegExp|\.split\s*\(\s*["'/]/.test(line);
      expect(usesToken && isSubstitution, `${rel}: ${line.trim()}`).toBe(false);
    }
  });
});
