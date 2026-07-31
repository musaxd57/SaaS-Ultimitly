import { describe, it, expect } from "vitest";
import { packKnowledgeBase, countGuestAsks, KB_ITEM_CAP } from "@/lib/ai/prompts";

// ---------------------------------------------------------------------------
// ADET TAVANI SESSİZ DÜŞÜRMESİN (denetim, 07-31).
//
// Adet tavanı (`KB_ITEM_CAP`) SQL'de uygulanıyor, yani `packKnowledgeBase` düşen
// kalemleri GÖREMİYOR ve `omitted` 0 kalıyordu. Sonuç sessiz ve pahalıydı:
// İşletme planı daire başına 60 kayıt satıyor, AI bir yanıtta 30 okuyor → diğer
// 30 iz bırakmadan düşüyor ve model, host'un GERÇEKTEN yazdığı bir konuda
// kendinden emin "bilgim yok" diyebiliyordu. Ürünün kuralı bunun tersi:
// bilmiyorsan insana devret.
// ---------------------------------------------------------------------------
describe("bilgi tabanı kesmesi modele SÖYLENİR", () => {
  const item = (i: number) => ({ category: "general", title: `k${i}`, content: `içerik ${i}` });

  it("sorguda düşen kalemler nota yansır (eskiden sessizce kaybolurdu)", () => {
    const packed = packKnowledgeBase([item(1), item(2)], 28);
    expect(packed.omitted).toBe(28);
    expect(packed.text).toContain("28 kalemi");
    // Kritik cümle: model "bilgi yok" DEMEMELİ, devretmeli.
    expect(packed.text).toContain("insana devret");
  });

  it("kesme YOKSA not da yok (temiz istem, gereksiz gürültü yok)", () => {
    const packed = packKnowledgeBase([item(1), item(2)], 0);
    expect(packed.omitted).toBe(0);
    expect(packed.text).not.toContain("insana devret");
  });

  it("karakter bütçesi kesmesi ile adet kesmesi TOPLANIR (ikisi de sayılır)", () => {
    // Tek kalem karakter bütçesini tek başına aşacak kadar uzun olsun.
    const huge = { category: "general", title: "uzun", content: "A".repeat(20_000) };
    const packed = packKnowledgeBase([huge, huge, huge], 5);
    // 5 adet-kesmesi + karakter bütçesinde düşenler.
    expect(packed.omitted).toBeGreaterThan(5);
  });

  it("liste BOŞ ama sorguda kesme VARSA yine devir notu gider", () => {
    // "bilgi tabanı boş" demek burada YALAN olurdu — kayıt var, istemde yok.
    const packed = packKnowledgeBase([], 12);
    expect(packed.text).toContain("insana devret");
    expect(packed.text).not.toContain("bilgi tabanı boş");
    expect(packed.omitted).toBe(12);
  });

  it("gerçekten boş bilgi tabanı hâlâ 'boş' der (regresyon pini)", () => {
    const packed = packKnowledgeBase([], 0);
    expect(packed.text).toContain("bilgi tabanı boş");
    expect(packed.omitted).toBe(0);
  });

  it("KB_ITEM_CAP tek kaynak ve makul bir sayı", () => {
    expect(KB_ITEM_CAP).toBeGreaterThan(0);
    expect(KB_ITEM_CAP).toBeLessThanOrEqual(60);
  });
});

// ---------------------------------------------------------------------------
// SORU SAYACI — vurgu için tekrarlanan noktalama TEK soru sayılır.
// ---------------------------------------------------------------------------
describe("countGuestAsks yanlış pozitifleri", () => {
  it("'Nasılsınız??' iki soru DEĞİLDİR", () => {
    expect(countGuestAsks("Nasılsınız??")).toBe(1);
  });

  it("'Gerçekten mi?!?' tek soru", () => {
    expect(countGuestAsks("Gerçekten mi?!?")).toBe(1);
  });

  it("ayrı ayrı sorulan iki gerçek soru YİNE 2 sayılır (aşırı düzeltme yok)", () => {
    expect(countGuestAsks("Wifi şifresi ne? Çöp nereye?")).toBe(2);
  });

  it("kullanıcının gerçek örneği bozulmadı", () => {
    expect(countGuestAsks("saat kaçta çıkış var\nnasılsınız\nçöp nerde")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// SATIR ≠ İSTEK (denetim, 07-31).
//
// Ham satır saymak, Booking/Airbnb'de çok yaygın olan "selamlama + gövde +
// imza" biçimini "3 ayrı soru" sanıyordu. Çok-soru dalı anti-spam kurallarını
// (Bölüm 11 — "tek konu, tek mesaj"; gerekçesi: platformlar gereksiz mesajı
// spam sayıp cezalandırır) KAPATTIĞI için, sıradan bir şikayete gereksiz uzun
// cevap yazdırıyordu.
// ---------------------------------------------------------------------------
describe("countGuestAsks — selamlama/imza satırları istek DEĞİLDİR", () => {
  it("selamlama + gövde + imza TEK istek sayılır", () => {
    expect(countGuestAsks("Merhaba,\n\nDün gece klima çalışmadı.\n\nTeşekkürler")).toBe(1);
  });

  it("İngilizce selamlama/kapanış de elenir", () => {
    expect(countGuestAsks("Hi\n\nThe shower is not draining.\n\nThanks")).toBe(1);
  });

  it("noktalama ile biten selamlama da elenir", () => {
    expect(countGuestAsks("Merhaba!\nKlima çalışmıyor.\nSaygılar,")).toBe(1);
  });

  it("ama kullanıcının GERÇEK çok-soru örneği hâlâ 3 sayılır", () => {
    // "nasılsınız" burada tek başına bir satır ve misafir gerçekten soruyor;
    // 2+ kelimeli değil ama... kullanıcı bunun yanıtlanmasını istiyor.
    expect(countGuestAsks("saat kaçta çıkış var\nnasılsınız\nçöp nerde")).toBe(3);
  });

  it("gerçekten çok konulu bir mesaj hâlâ çok-soru sayılır", () => {
    expect(
      countGuestAsks("Merhaba\nÇıkış saati kaçta\nÇöpü nereye atalım\nOtopark var mı\nTeşekkürler"),
    ).toBe(3);
  });

  it("tek satır + birden fazla soru işareti yine çok-soru", () => {
    expect(countGuestAsks("Çıkış saati kaçta? Çöp nereye? Otopark var mı?")).toBe(3);
  });
});
