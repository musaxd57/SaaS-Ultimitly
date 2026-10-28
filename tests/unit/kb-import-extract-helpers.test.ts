import { describe, it, expect } from "vitest";
import {
  decodeTextFile,
  detectMojibake,
  pdfItemsToPageText,
  repairTurkishMojibake,
  sniffDocumentKind,
  tableRowsToText,
  type PdfTextItem,
} from "@/lib/kb-import/extract-helpers";
import { normalizeDocText, planDocumentImport, splitDocument } from "@/lib/kb-import/document";

// ---------------------------------------------------------------------------
// DOSYADAN BİLGİ TABANI — ÇIKARMA YARDIMCILARI (S2; Opus 10-23 akşam R3). Sentetik pdf.js parçaları / tablo satırları; kurgusal "Lale".
// ---------------------------------------------------------------------------

/** pdf.js parçası: yazı boyu `size`, sol `x`, taban çizgisi `y`. */
const item = (str: string, x: number, y: number, size = 10): PdfTextItem => ({ str, transform: [size, 0, 0, size, x, y], height: size });

describe("PDF sayfa metni (pdf.js boş satır vermez)", () => {
  it("🚨 başlık ve paragraf sınırı geri gelir: büyük dikey boşluk ya da yazı boyu değişimi boş satır; aynı satırdaki parçalar soldan sağa", () => {
    const items = [
      item("Otopark:", 50, 700, 14),
      item("ücretsizdir;", 110, 680),
      item("Otopark", 50, 680),
      item("12 numaralı yer size ayrılmıştır.", 50, 668),
      item("Çöpler bina girişinin sağındaki konteynere atılır.", 50, 640),
    ];
    const text = pdfItemsToPageText(items);
    expect(text).toBe("Otopark:\n\nOtopark ücretsizdir;\n12 numaralı yer size ayrılmıştır.\n\nÇöpler bina girişinin sağındaki konteynere atılır.");
    // Uçtan uca: başlık bulunur, otopark ve çöp ayrı konular.
    const plan = planDocumentImport([{ page: 1, text }]);
    expect(plan.drafts.map((d) => [d.category, d.title])).toEqual([
      ["parking", "Otopark"],
      ["trash", "Çöp"],
    ]);
  });

  it("boş / bozuk parça listesi boş metin; boşluklar tekleşir", () => {
    expect(pdfItemsToPageText([])).toBe("");
    expect(pdfItemsToPageText([{ str: "x", transform: [1] }])).toBe("");
    expect(pdfItemsToPageText([item("Wi-Fi   ağı", 10, 100), item(" Lale_Ev", 80, 100)])).toBe("Wi-Fi ağı Lale_Ev");
  });

  it("süre: 50.000 parçalık sayfa doğrusala yakın", () => {
    const many = Array.from({ length: 50_000 }, (_, i) => item(`s${i}`, (i % 10) * 20, 10_000 - Math.floor(i / 10) * 12));
    const t0 = performance.now();
    pdfItemsToPageText(many);
    expect(performance.now() - t0).toBeLessThan(2_000);
  });
});

describe("Word tablosu", () => {
  it("🚨 iki hücreli satır 'etiket: değer' — değer etiketinin bloğunda kalır (Wi-Fi değeri 'Genel'e düşmez)", () => {
    const text = tableRowsToText([
      ["Wi-Fi", "Lale_Ev / şifre Lale2025"],
      ["Otopark:", "12 numaralı yer"],
      ["Çöp", "", "Bina önündeki konteyner"],
      ["", ""],
      ["Havuz", "09:00", "20:00"],
    ]);
    expect(text).toBe("Wi-Fi: Lale_Ev / şifre Lale2025\n\nOtopark: 12 numaralı yer\n\nÇöp: Bina önündeki konteyner\n\nHavuz · 09:00 · 20:00");
    const blocks = splitDocument([{ page: 1, text }]).blocks.map((b) => b.text);
    expect(blocks[0]).toBe("Wi-Fi: Lale_Ev / şifre Lale2025");
  });
});

describe("bozuk Türkçe karakter", () => {
  it("🚨 1252/1254 karışıklığı, çift UTF-8, eşlemesiz yazı tipi, U+FFFD bulunur; temiz Türkçe şüpheli değil", () => {
    expect(detectMojibake("Çöpler bina girişinin sağındaki konteynere atılır. Şifre: ılık")).toMatchObject({ suspicious: false, kinds: [] });
    expect(detectMojibake("Çýkýþ saati 11:00, aðaçlý bahçe")).toMatchObject({ suspicious: true, kinds: ["win1252_turkish"] });
    expect(detectMojibake("Ã‡Ä±kÄ±ÅŸ saati 11:00")).toMatchObject({ suspicious: true, kinds: ["double_utf8"] });
    expect(detectMojibake("(cid:12)(cid:45) saat 11:00").kinds).toContain("unmapped_font");
    expect(detectMojibake("Giri� saati").kinds).toContain("replacement_char");
  });

  it("önizleme onarımı Türkçe harfe döner; onarılamayan iz dokunulmaz", () => {
    expect(repairTurkishMojibake("Çýkýþ saati 11:00")).toBe("Çıkış saati 11:00");
    expect(repairTurkishMojibake("Ã‡Ä±kÄ±ÅŸ saati")).toBe("Çıkış saati");
    expect(repairTurkishMojibake("(cid:12) Giri�")).toBe("(cid:12) Giri�");
    expect(repairTurkishMojibake("Lale 3")).toBe("Lale 3");
  });

  it("süre: 200.000 karakter doğrusal", () => {
    const t0 = performance.now();
    detectMojibake("Ã".repeat(200_000));
    detectMojibake("(cid:1".repeat(30_000));
    repairTurkishMojibake("ýÃ".repeat(100_000));
    expect(performance.now() - t0).toBeLessThan(2_000);
  });
});

describe("dosya türü ve metin dosyası", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  it("🚨 tür ilk baytlardan: PDF, zip (Word adayı), metin; ikili / boş reddedilir (uzantıya güvenilmez)", () => {
    expect(sniffDocumentKind(enc("%PDF-1.7\n..."))).toBe("pdf");
    expect(sniffDocumentKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]))).toBe("docx");
    expect(sniffDocumentKind(enc("Wi-Fi: Lale_Ev"))).toBe("txt");
    expect(sniffDocumentKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))).toBeNull();
    expect(sniffDocumentKind(new Uint8Array([]))).toBeNull();
  });

  it("🚨 UTF-8 değilse Türkçe kod sayfası 1254 (ğ ş ı doğru gelir; 1252 'ð þ ý' üretirdi); BOM silinir", () => {
    expect(decodeTextFile(enc("﻿Çıkış 11:00"))).toEqual({ text: "Çıkış 11:00", encoding: "utf-8" });
    // "ğış" Windows-1254 baytlarıyla: ğ=0xF0, ı=0xFD, ş=0xFE.
    expect(decodeTextFile(new Uint8Array([0xf0, 0xfd, 0xfe]))).toEqual({ text: "ğış", encoding: "windows-1254" });
  });
});

// ---------------------------------------------------------------------------
// R28 (Opus 10-28 ikinci dilim, ölçüldü): çift UTF-8 "à" girdisi düz boşlukla yazılmıştı (meşru metni bozuyordu) · Latin-1 okunmuş ş ğ Ş Ğ
// Ç Ü Ö (C1 denetim karakterli ikinci bayt) onarılmıyordu · sonundaki tek yarım bayt bütün UTF-8 dosyayı 1254'e çeviriyordu · RTF düz metin
// sanılıyordu · normalizasyon C1 denetim karakterlerini silmiyordu.
// ---------------------------------------------------------------------------
describe("R28 — çıkarma yardımcıları", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  /** UTF-8 baytlarını Latin-1 (ISO-8859-1) diye okuyan bozulma. */
  const latin1 = (s: string) => String.fromCharCode(...enc(s));

  it("🚨 meşru 'Ã' + düz boşluk bozulma DEĞİL (Portekizce 'MAÇÃ É'); gerçek çift UTF-8 'à' (Ã + bölünmez boşluk) onarılır", () => {
    expect(repairTurkishMojibake("MAÇÃ É BOM")).toBe("MAÇÃ É BOM");
    expect(detectMojibake("MAÇÃ É BOM")).toMatchObject({ suspicious: false, kinds: [] });
    expect(repairTurkishMojibake(latin1("à la carte"))).toBe("à la carte");
  });

  it("🚨 Latin-1 okunmuş Türkçe (ikinci bayt C1 denetim karakteri) bulunur ve onarılır", () => {
    const bozuk = latin1("Şişli ağır ığdır ĞÇÜÖ çüö");
    expect(detectMojibake(bozuk).kinds).toContain("double_utf8");
    expect(repairTurkishMojibake(bozuk)).toBe("Şişli ağır ığdır ĞÇÜÖ çüö");
  });

  it("🚨 geçerli UTF-8 dosyanın SONUNDAKİ yarım karakter atılır, dosya UTF-8 kalır (iki ve üç baytlık yarım dizi)", () => {
    expect(decodeTextFile(new Uint8Array([...enc("Merhaba Şişli "), 0xc5]))).toEqual({ text: "Merhaba Şişli ", encoding: "utf-8" });
    expect(decodeTextFile(new Uint8Array([...enc("Kahve "), 0xe2, 0x82]))).toEqual({ text: "Kahve ", encoding: "utf-8" });
  });

  it("aşırı-uygulama: ORTADA bozuk bayt varsa eskisi gibi 1254; tam son karakter kesilmez", () => {
    expect(decodeTextFile(new Uint8Array([...enc("Şiş"), 0xfd, ...enc("li"), 0xc5])).encoding).toBe("windows-1254");
    expect(decodeTextFile(enc("Çıkış ş"))).toEqual({ text: "Çıkış ş", encoding: "utf-8" });
  });

  it("🚨 RTF reddedilir (denetim sözcükleri taslağa girmesin); süslü parantezle başlayan düz metin metindir", () => {
    expect(sniffDocumentKind(enc("{\\rtf1\\ansi Lale}"))).toBeNull();
    expect(sniffDocumentKind(enc("{ Lale notları }"))).toBe("txt");
  });

  it("normalizasyon C1 denetim karakterlerini siler", () => {
    expect(normalizeDocText("a\u0085b\u009fc")).toBe("abc");
  });
});
