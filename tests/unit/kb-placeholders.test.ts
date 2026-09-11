import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  GUEST_NAME_FALLBACK,
  apartmentNumberOf,
  fillGuestPlaceholders,
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
    // Hane SINIRI ≤3: iki ve üç haneli çıplak numara hâlâ daire numarasıdır (kural yutmuyor).
    ["Nuve Teras 12", "12"],
    ["Kule 104", "104"],
    // Sayısız: mülk adının kendisi (uydurma numara yok)
    ["Deniz Manzara", "Deniz Manzara"],
    ["", ""],
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
    expect(fillGuestPlaceholders("Daire {daire}", { propertyName: "blok $&" })).toBe("Daire blok $&");
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
