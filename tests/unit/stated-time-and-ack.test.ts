import { describe, it, expect } from "vitest";
import { timeStatedInMessage } from "@/lib/ai/stated-time";
import { isClosingAck, classifyFallback } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// İKİ DETERMİNİSTİK YARDIMCININ SESSİZ DELİKLERİ (derin denetim, 2026-08-01).
// Her iki bulgu da düzeltmeden ÖNCE ve SONRA gerçek fonksiyon çalıştırılarak
// ölçüldü — varsayımla değil.
//
// (31) `timeStatedInMessage` cümlecikleri yalnız `. ! ? \n` ile ayırıyordu.
//      Türkçede (ve konuşma dilinde İngilizcede) cümlecikler ağırlıkla VİRGÜLLE
//      bağlanır → "aynı cümlecikte olmalı" garantisi fiilen yoktu:
//        "Uçağımız 19:30'da, sabah 8 gibi çıkarız." → 19:30 KABUL
//        "Check-in 22:00, we will leave on Sunday" → 22:00 KABUL
//      Fonksiyonun TEK varlık sebebi bu halüsinasyon sınıfını durdurmaktı ve
//      misafirin hiç söylemediği saat rezervasyona KALICI yazılıyordu.
//      Ayrıca fiilin YÖNÜ hiç okunmuyordu: "11:00'de çıkmıyoruz" da kabuldü.
//
// (46) `isClosingAck` harf içermeyen mesajları KOŞULSUZ onay sayıyordu; tek
//      koruma 10 emojilik bir KARA LİSTEYDİ. Ölçüm: 🆘 🚨 🚑 ⚠️ dahil neredeyse
//      her emoji "kapanış onayı". Sonuç yalnız sessiz kayıp değil — inbox host'a
//      "Misafir sohbeti kapattı — cevap gerekmedi" YAZIYORDU.
// ---------------------------------------------------------------------------

describe("statedCheckoutTime kanıt kapısı — cümlecik sınırı", () => {
  const threats: [string, string][] = [
    ["18:00", "Dinner at 18:00. We leave tomorrow."],
    ["18:00", "Dinner at 18:00, we leave tomorrow"],
    ["19:30", "Uçağımız 19:30'da, sabah 8 gibi çıkarız."],
    ["21:00", "Rezervasyonumuz 21:00; yarın çıkış yapacağız"],
    ["22:00", "Check-in 22:00, we will leave on Sunday"],
    ["20:00", "Konser 20:00'de, ertesi gün çıkıyoruz"],
  ];
  for (const [time, msg] of threats) {
    it(`ÖDÜNÇ ALINAN saati reddeder: ${time} ← ${msg.slice(0, 34)}…`, () => {
      expect(timeStatedInMessage(time, msg)).toBe(false);
    });
  }

  // ⚠️ CÜMLE SINIRI AŞILAMAZ. İlk yazımda ileri-bakış TÜM ayırıcılar için
  // koşuyordu (`.` `!` `?` `\n` dahil) → düzeltmenin KENDİSİ, fonksiyonun varlık
  // sebebi olan halüsinasyon sınıfını ters yönden geri açmıştı. Bir denetim
  // ajanı ölçerek yakaladı; ileri-bakış artık YALNIZ aynı cümlenin içinde.
  const crossSentence: [string, string][] = [
    ["18:00", "We leave tomorrow. Dinner at 18:00."],
    ["19:30", "Yarın çıkıyoruz. Uçağımız 19:30'da."],
    ["23:00", "Çıkış yapacağız!\nGece 23:00'te arkadaşım gelecek."],
  ];
  for (const [time, msg] of crossSentence) {
    it(`CÜMLE sınırını aşarak saat ödünç ALMAZ: ${time} ← ${msg.slice(0, 30)}…`, () => {
      expect(timeStatedInMessage(time, msg)).toBe(false);
    });
  }

  const legit: [string, string][] = [
    ["08:00", "Uçağımız 19:30'da, sabah 8 gibi çıkarız."], // doğru saat AYNI cümlecikte
    ["10:00", "Yarın çıkıyoruz, saat 10:00 gibi"], // ipucu önce, saat SONRAKİ cümlecikte
    ["09:00", "Sabah erken ayrılacağız, 9 gibi"],
    ["11:00", "We'll be leaving, probably at 11:00"],
    ["18:00", "18:00'de çıkacağız"],
    ["18:00", "we'll leave around 6pm"],
    ["11:00", "check-out at 11:00"], // ⚠️ ASCII tire ayırıcıya EKLENEMEZ (pin)
  ];
  for (const [time, msg] of legit) {
    it(`MEŞRU beyanı korur: ${time} ← ${msg.slice(0, 34)}…`, () => {
      expect(timeStatedInMessage(time, msg)).toBe(true);
    });
  }
});

describe("statedCheckoutTime — olumsuzlama vetosu", () => {
  const negations: [string, string][] = [
    ["11:00", "saat 11:00'de çıkmayacağız, kalmaya devam edeceğiz"],
    ["11:00", "11:00'de çıkmıyoruz"],
    ["11:00", "çıkış saatimizi 11:00 yapmayın lütfen"],
    ["11:00", "11:00'de ayrılmıyoruz"],
    ["18:00", "we will NOT leave at 18:00"],
    ["18:00", "we won't leave at 18:00"],
  ];
  for (const [time, msg] of negations) {
    it(`REDDEDİLEN saati yazmaz: ${msg.slice(0, 36)}…`, () => {
      expect(timeStatedInMessage(time, msg)).toBe(false);
    });
  }

  it("veto FİİLE ÇAPALI — meşru ifadeleri kırmaz (yanlış-pozitif pini)", () => {
    // ⚠️ İLK YAZIMIM FAZLA GENİŞTİ ve bir denetim ajanı ölçerek yakaladı:
    // Türkçede `-ma` hem OLUMSUZLUK hem FİİL-İSİM ekidir. `çıkmad` çapasız
    // yazılınca "çıkma-DAN"ı, `çıkmam` ise "çıkma-MIZ"ı yakalıyordu — ikisi de
    // TAMAMEN MEŞRU ve çok yaygın çıkış cümleleri. Aşağıdakiler o vakalar.
    expect(timeStatedInMessage("12:00", "12:00 gibi çıkarız, uygun mu")).toBe(true);
    expect(timeStatedInMessage("09:00", "sabah 9'da ayrılacağız")).toBe(true);
    expect(timeStatedInMessage("10:00", "10:00'da çıkmayı planlıyoruz")).toBe(true);
    expect(timeStatedInMessage("11:00", "Çıkmamız gereken saat 11:00 mi?")).toBe(true);
    expect(timeStatedInMessage("11:00", "11:00'de çıkmamız gerekiyor")).toBe(true);
    expect(
      timeStatedInMessage("11:00", "Çıkmadan önce anahtarı nereye bırakalım? Saat 11:00'de çıkıyoruz."),
    ).toBe(true);
    expect(
      timeStatedInMessage("10:00", "Ayrılmadan önce çöpü nereye atalım, 10:00'da ayrılıyoruz"),
    ).toBe(true);
  });

  // ⚠️ İKİNCİ TUR REGRESYONLARI (denetim ajanı ölçerek yakaladı).
  it("ULAÇ ipucu DEĞİLDİR: 'çıkmadan önce' başka eylemin saatini meşrulaştırmaz", () => {
    // `(?!an)` çapası olumsuzlama vetosunu doğru şekilde devreden çıkardı ama
    // "çıkmadan/ayrılmadan" HÂLÂ ipucu sayılıyordu → misafirin kahvaltı/kargo/
    // taksi saati rezervasyona ÇIKIŞ SAATİ diye yazılıyordu.
    expect(timeStatedInMessage("09:00", "Çıkmadan önce 09:00'da kahvaltı yapabilir miyiz")).toBe(false);
    expect(timeStatedInMessage("08:00", "Ayrılmadan önce 08:00'de market açık olur mu")).toBe(false);
    expect(timeStatedInMessage("14:00", "Çıkmadan önce 14:00'te kargo gelecek")).toBe(false);
    expect(timeStatedInMessage("07:00", "Çıkmadan 07:00'de taksi çağırabilir misiniz")).toBe(false);
  });

  it("GERİ ÇEKİLME: aynı mesajda beyanını geri alan misafirin saati yazılmaz", () => {
    // Olumsuzlamayı cümlecik seviyesine indirmek "temizlik yapmayın" vakasını
    // kurtardı ama GERİ ÇEKİLMEYİ kaybetti. Ayrılma fiilinin olumsuzu artık
    // MESAJ seviyesinde veto ediyor — nerede geçerse geçsin.
    expect(
      timeStatedInMessage("11:00", "Çıkışımız 11:00, ama planı değiştirdik çıkmayacağız"),
    ).toBe(false);
    expect(
      timeStatedInMessage("11:00", "Saat 11:00'de çıkıyoruz. Aslında çıkmayacağız."),
    ).toBe(false);
    expect(
      timeStatedInMessage("11:00", "We check out at 11:00; actually we won't leave"),
    ).toBe(false);
  });

  it("olumsuzlama CÜMLECİK seviyesinde — başka cümlecikteki 'yapmayın' beyanı düşürmez", () => {
    // Mesaj geneline uygulanan veto bu meşru beyanı da düşürüyordu (ölçüldü).
    expect(
      timeStatedInMessage("11:00", "11:00'de çıkacağız, lütfen sabah temizlik yapmayın"),
    ).toBe(true);
    // Ama ÇIKIŞA ilişkin olumsuzlama aynı cümlecikteyse yine reddedilir.
    expect(timeStatedInMessage("11:00", "çıkış saatimizi 11:00 yapmayın lütfen")).toBe(false);
  });
});

describe("isClosingAck — harf içermeyen mesaj artık BEYAZ LİSTE", () => {
  const threats = ["🆘", "🚨", "🔥🔥", "😭", "⚠️", "🚑", "💀", "🐛🐛", "💧💧", "🚽", "🤒"];
  for (const emoji of threats) {
    it(`imdat/şikayet emojisini onay SAYMAZ: ${emoji}`, () => {
      expect(isClosingAck(emoji)).toBe(false);
    });
  }

  it("yalnız noktalama da onay değildir (misafirin '…' yazması kapanış demek değil)", () => {
    expect(isClosingAck("!!!")).toBe(false);
    expect(isClosingAck("...")).toBe(false);
    expect(isClosingAck("-")).toBe(false);
  });

  const intended = ["👍", "🙏", "❤️", "😊", "👌", "🙂", "👏", "🤝", "✅"];
  for (const emoji of intended) {
    it(`gerçek onayı korur: ${emoji}`, () => {
      expect(isClosingAck(emoji)).toBe(true);
    });
  }

  it("karışık mesajda beyaz liste DIŞI bir emoji varsa onay düşer", () => {
    expect(isClosingAck("👍🆘")).toBe(false);
  });

  it("metinli kapanışlar aynen çalışır (regresyon pini)", () => {
    expect(isClosingAck("tamam teşekkürler")).toBe(true);
    expect(isClosingAck("ok thanks")).toBe(true);
    expect(isClosingAck("Tamam, teşekkürler! 👍")).toBe(true);
  });

  it("mevcut olumsuz-emoji koruması bozulmadı", () => {
    expect(isClosingAck("👎")).toBe(false);
    expect(isClosingAck("😡")).toBe(false);
    expect(isClosingAck("❌")).toBe(false);
  });

  it("KAPI: imdat emojisi artık 'cevap gerekmedi' dalına düşmez", () => {
    // `classifyFallback` bunu şikayet saymıyor (deterministik yol emoji okumaz),
    // ama artık `closing_ack` de DEĞİL → konuşma damgalanmaz, host'a "kapattı"
    // denmez ve mesaj model yoluna girer.
    expect(isClosingAck("🆘")).toBe(false);
    expect(classifyFallback("🆘").intent).toBe("general");
  });
});
