import { describe, it, expect } from "vitest";
import { qrReplyHasDoorCode, withoutQrSecretKbItems } from "@/lib/guest-chat";
import { qrPropertyCeiling } from "@/lib/ai/daily-budget";

// ---------------------------------------------------------------------------
// QR: "KAPI KODU YOK, Wi-Fi VERİLSİN" + ÇIKTI TARAMASI (kurucu kararları 10-11, karar listesi 18 + Wi-Fi sorusu).
//  · `withoutQrSecretKbItems`: `wifi` kalemi kapı izi taşımıyorsa QR bağlamına girer; öteki kategoriler bugünkü TAM taramadan geçer.
//  · `qrReplyHasDoorCode`: model cevabında DEĞER taşıyan kapı / kutu / giriş kodu; Wi-Fi şifresi, posta kodu, telefon, saat, fiyat,
//    değersiz anış ve bilgi tabanında zaten verilmiş sayı sızıntı DEĞİL.
//  · `qrPropertyCeiling`: daire alt kotası = QR payının "eşit payın iki katı" (1–2 dairede sınır yok).
// ---------------------------------------------------------------------------

describe("qrReplyHasDoorCode — değer taşıyan kapı kodu yakalanır", () => {
  const leaks = [
    "Kapı kodunuz 4590.",
    "Kapı kodu: 4590, iyi konaklamalar.",
    "Bina kapısının şifresi 7788'dir.",
    "Anahtar kutusu kodu 9090.",
    "Kodunuz 4590, girişte tuş paneline yazın.",
    "Tuş paneline 6142 yazıp anahtar simgesine basın.",
    "6142 tuşlayın, kapı açılır.",
    "Kapı açma: 4590",
    "The door code is 4590.",
    "Your code is 4590.",
    "PIN: 4590",
    "KAPI KODU 4590", // büyük harf / Türkçe katlama
  ];
  for (const reply of leaks) it(`🚨 ${reply}`, () => expect(qrReplyHasDoorCode(reply, [])).toBe(true));
});

describe("qrReplyHasDoorCode — sızıntı OLMAYANLAR (cevap gitmeli, devir çok olmasın)", () => {
  const clean = [
    "Wi-Fi ağı LaleNet, şifresi gunes1907.",
    "Wi-Fi şifresi 12345678.",
    "Wi-Fi kodu: 12345678",
    "Kapı kodunu ev sahibiniz Airbnb mesajında iletir.",
    "Posta kodu 34710, Kadıköy.",
    "Giriş saati 15:00, çıkış 11:00.",
    "Kapıcı 0532 111 2233 numarasından ulaşılabilir.",
    "Kapı açma ücreti: 1500 TL.",
    "Bina 2024 yılında yenilendi.",
    "Çöp kutuları girişin solunda.",
    "",
  ];
  for (const reply of clean) it(`KONTROL: ${JSON.stringify(reply)}`, () => expect(qrReplyHasDoorCode(reply, [])).toBe(false));

  it("bilgi tabanında modele VERİLMİŞ sayı sızıntı sayılmaz (kapı süzgecinden geçmiş metin); verilmemiş kod yine yakalanır", () => {
    expect(qrReplyHasDoorCode("Daire kodu 4590 olan kat 3'tedir.", ["Daire 4590, 3. kat."])).toBe(false);
    expect(qrReplyHasDoorCode("Kapı kodunuz 4590.", ["Daire 7, 3. kat."])).toBe(true);
  });

  it("🚨 süre pini: 50.000 karakterlik kötü niyetli dizi doğrusal kalır (24k üstü fail-closed)", () => {
    const inputs = ["kapı kodu ".repeat(2_300), `kod${" ".repeat(23_000)}4590`, "4".repeat(23_900), `kapı açma ${"a ".repeat(11_000)}`];
    for (const s of inputs) {
      const t = performance.now();
      qrReplyHasDoorCode(s, []);
      expect(performance.now() - t, s.slice(0, 20)).toBeLessThan(1500);
    }
    expect(qrReplyHasDoorCode("a".repeat(30_000), [])).toBe(true); // doğrulanamayan → kod say
  });
});

describe("withoutQrSecretKbItems — Wi-Fi kalemi girer, kapı izi girmez", () => {
  const kb = (category: string, content: string) => ({ category, title: category, content });

  it("🚨 temiz `wifi` kalemi girer (ağ adı + şifre)", () => {
    const items = [kb("wifi", "Ağ adı: LaleNet / Şifre: gunes1907"), kb("wifi", "Wi-Fi password: sunny2024 (network LaleHome)")];
    expect(withoutQrSecretKbItems(items)).toHaveLength(2);
  });

  it("🚨 `wifi` kalemi kapı / kutu / kilit / PIN / kod izi taşıyorsa KOMPLE düşer (değer olmasa da)", () => {
    for (const content of [
      "Wi-Fi şifresi gunes1907. Kapı kodu 4590.",
      "Şifre gunes1907, modem kapının yanında.",
      "Ağ: LaleNet, şifre deniz2024. Anahtar kutusu girişte.",
      "Wi-Fi şifresi yildiz77, PIN 8812",
      "Wi-Fi şifresi yildiz77; bina kodu 1234",
      "Network key sunny2024, the door lock is on the left",
      "Wi-Fi'ye giriş şifresi: gunes1907", // "giriş şifresi" kapı kalıbı — fazla eleme güvenli yön
    ]) {
      expect(withoutQrSecretKbItems([kb("wifi", content)]), content).toEqual([]);
    }
  });

  it("KONTROL: `wifi` DIŞINDAKİ kategoride Wi-Fi şifresi bugünkü gibi düşer (kategori olmadan kapı kodundan güvenle ayrılamaz)", () => {
    expect(withoutQrSecretKbItems([kb("general", "Wi-Fi şifresi: gunes1907"), kb("faq", "Çöp salı günü.")]).map((i) => i.category)).toEqual(["faq"]);
  });
});

describe("qrPropertyCeiling — daire alt kotası (kurucu kararı 10-11)", () => {
  it("1–2 dairede sınır yok (pay zaten tamamı); 3+ dairede eşit payın iki katı, en az 1, en çok QR payı", () => {
    expect(qrPropertyCeiling(45, 1)).toBe(45);
    expect(qrPropertyCeiling(45, 2)).toBe(45);
    expect(qrPropertyCeiling(150, 7)).toBe(43); // Pro örneği
    expect(qrPropertyCeiling(450, 25)).toBe(36); // İşletme örneği
    expect(qrPropertyCeiling(10, 5)).toBe(4);
    expect(qrPropertyCeiling(1, 50)).toBe(1);
    expect(qrPropertyCeiling(45, 0)).toBe(45);
  });
});
