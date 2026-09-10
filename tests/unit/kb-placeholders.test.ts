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

describe("apartmentNumberOf — daire numarası (mülk adının SON sayısı)", () => {
  it.each([
    ["nuve 3", "3"],
    ["nuve teras 4", "4"],
    ["Daire 1", "1"],
    ["Blok 2 Daire 15", "15"],
    ["Deniz Manzara", "Deniz Manzara"],
    ["", ""],
  ])("%s → %s", (name, expected) => {
    expect(apartmentNumberOf(name)).toBe(expected);
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

  it.each(SURFACES)("%s içinde ELLE yazılmış {isim}/{daire} regex'i KALMADI", (rel) => {
    const src = read(rel);
    // Yapısal pin: kopya regex geri gelirse burada yakalanır (davranışsal pinler ayrı dosyalarda).
    expect(src).not.toMatch(/\\\{\\s\*\(isim\|ad\|name\)/);
    expect(src).not.toMatch(/\\\{\\s\*\(daire\|apartment\|apt\)/);
  });
});
