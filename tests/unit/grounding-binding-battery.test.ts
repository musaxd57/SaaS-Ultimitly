import { describe, it, expect } from "vitest";
import { sentenceGroundedInKb } from "@/lib/ai/no-instruction-filler";

// ---------------------------------------------------------------------------
// DAYANAK KONTROLÜ — BAĞ BATARYASI (kurucu 10-21; tasarım `docs/TASARIM-2026-10-21-anlama-olcumu.md` §6). Model yok.
//
// Kurucu: "İki kaydın sözcüklerini ve sayılarını bir arada aramak bu yanlış cevabı geçirebilir. Kontrol bilginin hangi yere, işleme ve
// koşula ait olduğunu da korumalı … 'iki saat önce haber verin' ile 'iki saat kullanabilirsiniz' aynı bilgi değildir."
//
// Bu dosya bugünkü sözcük + sayı örtüşmesi kontrolünün (`sentenceGroundedInKb`, "talimat yok" silicisinden sonra kalan cümle için) davranışını
// BELGELER: (1) korunan durum — tek kalem kuralı komşu tesisin değerini reddeder; (2) önerilen "iki kaydı birleştir" adımının o korumayı
// kaldırdığı; (3) BİLİNEN SINIRLAR — TEK kalemin içinde ilişki türü / ücret / koşul değişimi örtüşmeyle ayırt edilmez. (3)'teki `true`lar
// istenen davranış DEĞİL, bugünkü davranıştır: iddia bağı kontrolü (konu + ilişki + değer + koşul, tek cümleden) gelince ters döner ve bu
// dosya o değişiklikle birlikte güncellenir.
// ---------------------------------------------------------------------------

const POOL = "Açık havuz her gün 09:00–20:00 arası kullanılabilir.";
const GYM = "Spor salonu -1. kattadır ve 07:00–22:00 arası açıktır.";
const SAUNA = "Sauna yalnız rezervasyonla kullanılır: en az 2 saat önceden resepsiyona haber verin. Her rezervasyon 1 saatliktir.";
const PARKING = "Kapalı otopark ilk araç için ücretsizdir. İkinci araç için günlük 200 TL ücret alınır.";
const LATE = "7 gece ve üzeri konaklamalarda 13:00'e kadar ücretsiz geç çıkış verilebilir; diğer konaklamalarda geç çıkış ev sahibinin onayına bağlıdır.";

describe("korunan: tek kalem kuralı komşu tesisin değerini reddeder", () => {
  it("havuza spor salonunun saati (iki ayrı kalem) dayanaksız", () => {
    expect(sentenceGroundedInKb("Havuz 07:00–22:00 arası açıktır.", [POOL, GYM])).toBe(false);
  });
  it("kalemin kendi ifadesi dayanaklı", () => {
    expect(sentenceGroundedInKb("Açık havuz 09:00–20:00 arası kullanılabilir.", [POOL, GYM])).toBe(true);
  });
});

describe("önerilen birleştirme bu korumayı kaldırır (uygulanmadı — kurucu 10-21 reddi)", () => {
  it("iki kalem tek metin gibi aranırsa havuz + 07:00–22:00 geçer", () => {
    expect(sentenceGroundedInKb("Havuz 07:00–22:00 arası açıktır.", [`${POOL} ${GYM}`])).toBe(true);
  });
});

describe("BİLİNEN SINIR (öteki yön): doğru anlamlı açıklama sözcük farkıyla reddedilir (gereksiz tutma)", () => {
  it("'Havuz her gün 20:00'ye kadar kullanılabilir' — 'kadar' kalemde yok → dayanaksız", () => {
    expect(sentenceGroundedInKb("Havuz her gün 20:00'ye kadar kullanılabilir.", [POOL, GYM])).toBe(false);
  });
});

describe("BİLİNEN SINIR: tek kalemin içinde anlam değişimi örtüşmeyle ayırt edilmez (bugünkü davranış)", () => {
  it("'2 saat önceden haber verin' → '2 saat kullanabilirsiniz' (ilişki türü değişti) geçer", () => {
    expect(sentenceGroundedInKb("Saunayı 2 saat kullanabilirsiniz.", [SAUNA])).toBe(true);
  });
  it("ikinci araç ücretli → 'ikinci araç ücretsiz' (ücret ↔ ücretsiz) geçer", () => {
    expect(sentenceGroundedInKb("İkinci araç için otopark ücretsizdir.", [PARKING])).toBe(true);
  });
  it("koşullu izin koşulsuz söylenince (7 gece şartı düştü) geçer", () => {
    expect(sentenceGroundedInKb("13:00'e kadar ücretsiz geç çıkış verilebilir.", [LATE])).toBe(true);
  });
});
