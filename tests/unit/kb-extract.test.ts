import { describe, it, expect } from "vitest";
import { extractKbSuggestions, EXTRACT_MAX_CHARS } from "@/lib/kb-extract";

// ---------------------------------------------------------------------------
// A5 — host metninden TASLAK öneri çıkarma (09-08).
//
// 🚨 Dört değişmez burada ölçülüyor:
//  1. Hiçbir şey yazılmaz (fonksiyon saf — yan etkisi yok, DB'ye erişimi yok).
//  2. YER TUTUCU gerçeğe DÖNÜŞMEZ: `{isim}` / `[ŞİFRE]` içeren satır atlanır.
//  3. Mesaj şablonu mülk gerçeği değildir ama içindeki AÇIK bilgi öneri üretir.
//  4. ÇİFT KOPYA YASAK: giriş/çıkış saati KB kalemi olarak önerilmez.
// ---------------------------------------------------------------------------

describe("A5 — deterministik öneri çıkarımı", () => {
  it("boş metin hiçbir öneri üretmez", () => {
    const r = extractKbSuggestions("");
    expect(r.fields).toEqual([]);
    expect(r.items).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it("ÇIKIŞ SAATİ yapılandırılmış alan önerisi olur, KB kalemi OLMAZ", () => {
    const r = extractKbSuggestions("Çıkış saati 11:00'dir, anahtarı kutuya bırakabilirsiniz.");
    expect(r.fields).toEqual([
      {
        target: "checkOutTime",
        value: "11:00",
        line: 1,
        excerpt: "Çıkış saati 11:00'dir, anahtarı kutuya bırakabilirsiniz.",
      },
    ]);
    // 🚨 Aynı gerçeğin ikinci kopyası üretilmez — kolon ile KB ayrışırsa hangisinin
    // doğru olduğu belirsizleşir.
    expect(r.items).toEqual([]);
  });

  it("GİRİŞ SAATİ ayrı alan olarak tanınır ve normalize edilir (9.30 → 09:30)", () => {
    const r = extractKbSuggestions("Giriş saati 9.30 sonrasıdır.");
    expect(r.fields[0]).toMatchObject({ target: "checkInTime", value: "09:30" });
  });

  it("🚨 YER TUTUCULU satırdan öneri ÇIKMAZ ve atlandığı SÖYLENİR", () => {
    const r = extractKbSuggestions(
      "Sayın {isim}, hoş geldiniz.\nWi-Fi şifresi: [ŞİFRE]\nÇıkış saati [11:00]'dir.",
    );
    expect(r.fields).toEqual([]);
    expect(r.items).toEqual([]);
    expect(r.skipped.map((s) => s.reason)).toEqual(["placeholder", "placeholder", "placeholder"]);
    // Sessiz kayıp yok: host neyin neden atlandığını görür.
    expect(r.skipped[1].excerpt).toContain("Wi-Fi şifresi");
  });

  it("`<açı>` ve `___` de yer tutucudur", () => {
    const r = extractKbSuggestions("Adres: <ADRES>\nOtopark: ______");
    expect(r.items).toEqual([]);
    expect(r.skipped).toHaveLength(2);
  });

  it("ŞABLON METNİ kalem olmaz ama İÇİNDEKİ açık bilgi öneri üretir", () => {
    // Karşılama şablonu: yer tutuculu satır atlanır, gerçek bilgi taşıyan satır
    // öneriye dönüşür.
    const r = extractKbSuggestions(
      [
        "Merhaba {isim}, dairemize hoş geldiniz!",
        "Çıkış saati 11:00'dir.",
        "Çöpleri binanın yan sokağındaki konteynere bırakabilirsiniz.",
      ].join("\n"),
    );
    expect(r.skipped.map((s) => s.line)).toEqual([1]);
    expect(r.fields.map((f) => f.target)).toEqual(["checkOutTime"]);
    expect(r.items).toEqual([
      {
        category: "trash",
        title: "Çöp ve geri dönüşüm",
        content: "Çöpleri binanın yan sokağındaki konteynere bırakabilirsiniz.",
        lines: [3],
      },
    ]);
  });

  it("aynı kategorinin BİRDEN ÇOK satırı TEK öneride birleşir", () => {
    const r = extractKbSuggestions(
      "Otopark bina altındadır.\nOtopark ücretsizdir.\nDairede sigara içilmez.",
    );
    const parking = r.items.find((i) => i.category === "parking");
    expect(parking?.content).toBe("Otopark bina altındadır.\nOtopark ücretsizdir.");
    expect(parking?.lines).toEqual([1, 2]);
    expect(r.items.find((i) => i.category === "rules")?.content).toBe("Dairede sigara içilmez.");
  });

  it("ÇELİŞEN ikinci saat sessizce EZMEZ; atlanmış olarak bildirilir", () => {
    const r = extractKbSuggestions("Çıkış saati 11:00'dir.\nÇıkış saati 12:00 olarak değişti.");
    expect(r.fields).toHaveLength(1);
    expect(r.fields[0].value).toBe("11:00");
    expect(r.skipped).toEqual([
      { reason: "duplicate", line: 2, excerpt: "Çıkış saati 12:00 olarak değişti." },
    ]);
  });

  it("saat İÇEREN ama giriş/çıkış OLMAYAN satır alan önerisi üretmez", () => {
    const r = extractKbSuggestions("Kahvaltı 08:00'de servis edilir.");
    expect(r.fields).toEqual([]);
  });

  it("hiçbir kategoriye uymayan satır sessizce yok sayılır (uydurma kategori yok)", () => {
    const r = extractKbSuggestions("Balkondaki bitkileri sulamanıza gerek yok.");
    expect(r.items).toEqual([]);
    expect(r.fields).toEqual([]);
  });

  it("METİN TAVANI: aşan girdi kesilir ve KESİLDİĞİ söylenir", () => {
    const r = extractKbSuggestions("Otopark var.\n".repeat(5000));
    expect(r.truncated).toBe(true);
    expect(EXTRACT_MAX_CHARS).toBe(20_000);
  });

  it("aşırı uzun TEK satır atlanır (istem/kayıt şişmesin)", () => {
    const r = extractKbSuggestions(`Otopark ${"x".repeat(2000)}`);
    expect(r.items).toEqual([]);
    expect(r.skipped[0].reason).toBe("too_long");
    // Alıntı da kırpılır — host'a 2000 karakterlik satır gösterilmez.
    expect(r.skipped[0].excerpt.length).toBeLessThanOrEqual(160);
  });

  it("Türkçe büyük harf I/İ ayrımı sınıflandırmayı bozmaz", () => {
    const r = extractKbSuggestions("ÇIKIŞ SAATİ 11:00'DİR.\nOTOPARK BİNA ALTINDADIR.");
    expect(r.fields[0]?.target).toBe("checkOutTime");
    expect(r.items[0]?.category).toBe("parking");
  });
});
