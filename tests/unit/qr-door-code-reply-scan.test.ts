import { describe, it, expect } from "vitest";
import { qrReplyHasDoorCode, redactDoorCodes, REDACTED_DOOR_CODE, withoutQrSecretKbItems } from "@/lib/guest-chat";
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

  it("bilgi tabanında modele VERİLMİŞ sayı BAĞLAMSIZ kalıpta sızıntı sayılmaz; verilmemiş kod yine yakalanır", () => {
    expect(qrReplyHasDoorCode("Daire kodu 4590 olan kat 3'tedir.", ["Daire 4590, 3. kat."])).toBe(false);
    expect(qrReplyHasDoorCode("Kapı kodunuz 4590.", ["Daire 7, 3. kat."])).toBe(true);
  });

  it("🚨 KAPI BAĞLAMLI kalıpta bilgi tabanı muafiyeti YOK (kapı kodu Wi-Fi şifresiyle aynı rakamlar olabilir — Haiku 10-11)", () => {
    expect(qrReplyHasDoorCode("Kapı kodunuz 4590.", ["Daire 4590, 3. kat."])).toBe(true);
    expect(qrReplyHasDoorCode("Girişteki tuş paneline 4590 yazın.", ["Ağ LaleNet, şifre 4590"])).toBe(true);
  });

  it("🚨 Wi-Fi'ye bağlanmayan 'şifre + hane' sızıntıdır; Wi-Fi cümlesindeki değil", () => {
    expect(qrReplyHasDoorCode("Bina şifresi 4590.", [])).toBe(true);
    expect(qrReplyHasDoorCode("Çöp odasının şifresi: 7788", [])).toBe(true);
    expect(qrReplyHasDoorCode("Wi-Fi şifresi 45901234.", [])).toBe(false);
    expect(qrReplyHasDoorCode("Ağ adı LaleNet, şifre 45901234.", [])).toBe(false);
    // Wi-Fi adı önceki cümlede: bağ cümle sınırını GEÇMEZ.
    expect(qrReplyHasDoorCode("Wi-Fi ağı LaleNet. Kiler şifresi 4590.", [])).toBe(true);
    // 🚨 Haiku 10-11 #1: aynı cümlede Wi-Fi şifresinden SONRA gelen başka şifre — etiket "bina".
    expect(qrReplyHasDoorCode("Wi-Fi şifresi 12345678, bina şifresi 4590", [])).toBe(true);
    // Etiketsiz şifre Wi-Fi kartının devamıdır ("Wi-Fi adı: LaleNet. Şifre: 12345678").
    expect(qrReplyHasDoorCode("Wi-Fi adı: LaleNet. Şifre: 12345678", [])).toBe(false);
  });

  it("🚨 ayraçlı yazım ('4 5 9 0') da yakalanır; yıl eki / fiyat yanlış tutuş üretmez (devir çok olmasın)", () => {
    expect(qrReplyHasDoorCode("Kapı kodu 4 5 9 0.", [])).toBe(true);
    expect(qrReplyHasDoorCode("Kapı kodu 4-5-9-0.", [])).toBe(true);
    expect(qrReplyHasDoorCode("Giriş kapısı 2019'da yenilendi.", [])).toBe(false);
    expect(qrReplyHasDoorCode("Kapı 1500 TL.", [])).toBe(false);
  });

  it("değer ÖNCE yazılan kapı kodu yakalanır; rezervasyon / onay kodu kapı kodu değildir (Haiku 10-11 #7 / #8)", () => {
    expect(qrReplyHasDoorCode("4590 kapı kodudur.", [])).toBe(true);
    expect(qrReplyHasDoorCode("4590'ı kapı kodu olarak girin.", [])).toBe(true);
    expect(qrReplyHasDoorCode("Rezervasyon kodu: 12345678", [])).toBe(false);
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
      "Wi-Fi: LaleNet / gunes1907. Giriş 4590.", // iz sözcüğü YOK, yalnız KAPI KALIBI yakalar (giriş + bitişik 4–8 hane)
    ]) {
      expect(withoutQrSecretKbItems([kb("wifi", content)]), content).toEqual([]);
    }
  });

  it("🚨 Wi-Fi kalemindeki HER şifre değeri bir Wi-Fi adına bağlı olmalı (aynı cümle, önceki değerden sonra) — Haiku 10-11", () => {
    for (const content of [
      "Wi-Fi: LaleNet, şifre gunes1907. Bina şifresi: 4590",
      "Wi-Fi: gunes1907. Çöp odası şifresi 4590",
      "Wi-Fi: LaleNet, şifre gunes1907, depo şifresi 4590",
      "Wi-Fi şifresi gunes1907. Şifre: 4590",
      "Wi-Fi şifresi gunes1907. Otopark şifresi kirmizi gelincik", // etiket "otopark" → Wi-Fi'ye bağlı değil
      "Wi-Fi: LaleNet, çamaşır odası kodu: 4590", // etiket "çamaşır odası" (Haiku 10-11 #9)
      "Wi-Fi şifresi 12345678, bina şifresi 4590", // aynı cümlede ikinci şifre — etiket "bina" (Haiku 10-11 #1)
      "Wi-Fi şifresi 12345678 bina şifresi 4590", // virgülsüz: etiket bir önceki şifrenin DEĞERİNDEN sonra başlar
      "Wi-Fi ağı: LaleNet. Kiler şifresi 4590", // Wi-Fi adı ÖNCEKİ cümlede kaldı; "kiler" iz listesinde yok → yalnız cümle sınırı yakalar
    ]) {
      expect(withoutQrSecretKbItems([kb("wifi", content)]), content).toEqual([]);
    }
    for (const content of [
      "Ağ adı: LaleNet\nŞifre: gunes1907",
      "Wi-Fi şifresi: gunes1907 (şifre büyük-küçük harfe duyarlıdır)",
      "Wi-Fi 1: LaleNet şifre gunes1907. Wi-Fi 2: LaleNet5G şifre deniz2024",
      "Network: LaleHome / password: sunny2024",
      // Haiku 10-11 #2 / #3: gerçek kartlar düşmemeli (cümle sınırı, yer adı, "ağ anahtarı").
      "Wi-Fi adı: LaleNet. Şifre: gunes1907",
      "Wi-Fi ağı LaleNet; şifre gunes1907",
      "Wi-Fi adı LaleNet.\nŞifre: 12345678",
      "Lale Sitesi Wi-Fi: LaleNet, şifre: gunes1907",
      "Apartman Wi-Fi: LaleApt, şifre: deniz2024",
      "Ağ anahtarı: 12345678 (ağ adı LaleNet)",
    ]) {
      expect(withoutQrSecretKbItems([kb("wifi", content)]), content).toHaveLength(1);
    }
  });

  it("süre pini: Wi-Fi kalemi süzgeci 24k kötü niyetli girdide doğrusal (uzun boşluk / tekrarlı şifre sözcüğü)", () => {
    for (const content of [`şifre${" ".repeat(23_000)}x`, "şifre: 1 ".repeat(2_800), `Wi-Fi ${"kod ".repeat(5_000)}`, `${",".repeat(23_000)}şifre 1`]) {
      const t = performance.now();
      withoutQrSecretKbItems([kb("wifi", content)]);
      qrReplyHasDoorCode(content.slice(0, 23_000), []);
      expect(performance.now() - t, content.slice(0, 12)).toBeLessThan(1500);
    }
  });

  it("etiketsiz İLK şifre ancak ÖNCESİNDE bir Wi-Fi adı varsa Wi-Fi sayılır (başlık da metnin parçasıdır)", () => {
    expect(withoutQrSecretKbItems([{ category: "wifi", title: "Bilgi", content: "Şifre: 4590. Wi-Fi ağı LaleNet." }])).toEqual([]);
    expect(withoutQrSecretKbItems([{ category: "wifi", title: "Wi-Fi", content: "Şifre: gunes1907" }])).toHaveLength(1);
  });

  it("KONTROL: `wifi` DIŞINDAKİ kategoride Wi-Fi şifresi bugünkü gibi düşer (kategori olmadan kapı kodundan güvenle ayrılamaz)", () => {
    expect(withoutQrSecretKbItems([kb("general", "Wi-Fi şifresi: gunes1907"), kb("faq", "Çöp salı günü.")]).map((i) => i.category)).toEqual(["faq"]);
  });
});

describe("qrPropertyCeiling — daire alt kotası (kurucu kararı 10-11)", () => {
  it("1–2 dairede sınır yok (pay zaten tamamı); 3+ dairede eşit payın iki katı, en az 1, en çok QR payı", () => {
    expect(qrPropertyCeiling(45, 1)).toBe(45);
    expect(qrPropertyCeiling(45, 2)).toBe(45);
    expect(qrPropertyCeiling(45, 3)).toBe(30);
    expect(qrPropertyCeiling(150, 7)).toBe(43); // Pro örneği
    expect(qrPropertyCeiling(450, 25)).toBe(36); // İşletme örneği
    expect(qrPropertyCeiling(10, 5)).toBe(4);
    expect(qrPropertyCeiling(1, 50)).toBe(1);
    expect(qrPropertyCeiling(45, 0)).toBe(45);
  });
});

describe("redactDoorCodes — geçmişte kapı kodu modele gitmez (kurucu kararı 10-11)", () => {
  it("🚨 kapı kodunun DEĞERİ gizlenir, mesajın geri kalanı (Wi-Fi dahil) aynı kalır", () => {
    expect(redactDoorCodes("Kapı kodunuz 4590, Wi-Fi şifresi gunes1907.")).toBe(`Kapı kodunuz ${REDACTED_DOOR_CODE}, Wi-Fi şifresi gunes1907.`);
    expect(redactDoorCodes("Tuş paneline 6142 yazıp girin.")).toBe(`Tuş paneline ${REDACTED_DOOR_CODE} yazıp girin.`);
    expect(redactDoorCodes("Kapı kodu 4 5 9 0")).toBe(`Kapı kodu ${REDACTED_DOOR_CODE}`);
  });
  it("KONTROL: kod taşımayan metin değişmez (Wi-Fi kartının etiketsiz şifresi dahil)", () => {
    for (const t of ["Giriş saati 15:00.", "Kapıcı 0532 111 2233.", "Wi-Fi şifresi 12345678.", "Wi-Fi adı: LaleNet. Şifre: 12345678", ""]) {
      expect(redactDoorCodes(t)).toBe(t);
    }
  });
  it("🚨 Wi-Fi şifresiyle aynı cümledeki ikinci (kapı) şifresi gizlenir, Wi-Fi şifresi kalır; tarama sınırının üstü fail-closed", () => {
    expect(redactDoorCodes("Wi-Fi şifresi 12345678, bina şifresi 4590")).toBe(`Wi-Fi şifresi 12345678, bina şifresi ${REDACTED_DOOR_CODE}`);
    expect(redactDoorCodes("4590 kapı kodudur")).toBe(`${REDACTED_DOOR_CODE} kapı kodudur`);
    expect(redactDoorCodes(`${"a ".repeat(13_000)}4590`)).toContain(REDACTED_DOOR_CODE);
  });
});
