import { describe, it, expect } from "vitest";
import { admitsMissingKnowledge, refersGuestToHost } from "@/lib/ai/absence";
import { containsContactValue } from "@/lib/contact-redact";

// ---------------------------------------------------------------------------
// EV SAHİBİNE YÖNLENDİRME = BİLGİM YOK (kurucu 10-23 akşam 4.5, aynen: "ev sahibinize sorabilirsiniz yazamaz yasak onlar bilgisi yok
// sayılsın cevap tutulsun"). Misafiri bilgi için ev sahibine gönderen cümle gitmez; telefon / e-posta değeri veren ve olay koşullu
// talimat cümlesi hariç. Altı dil.
// ---------------------------------------------------------------------------

describe("ev sahibine yönlendirme", () => {
  it("🚨 Türkçe yönlendirmeler bilgisizlik sayılır (öğle raporu §4.5 örneği dahil)", () => {
    for (const t of [
      "Otopark için ev sahibinize sorabilirsiniz.",
      "Plaj servisi siteden kalkıyor; tam kalkış noktası için ev sahibinize sorabilirsiniz.",
      "Sauna konusunda ev sahibinizle iletişime geçebilirsiniz.",
      "Bu konuda ev sahibiniz size kesin bilgi verebilir.",
      "Ev sahibiniz, bu konuda size yardımcı olabilir.",
      "Net yol tarifi için ev sahibinizden bilgi alabilirsiniz.",
      "Kahvaltı saatini ev sahibinize danışın.",
      "Bu bilgiyi ev sahibinizden isteyebilirsiniz.",
      "Daha fazla bilgi isterseniz ev sahibinize sorabilirsiniz.",
      "EV SAHİBİNİZE SORABİLİRSİNİZ.",
    ]) {
      expect(refersGuestToHost(t), t).toBe(true);
      expect(admitsMissingKnowledge(t), t).toBe(true);
    }
  });

  it("🚨 İngilizce / Almanca / Fransızca / İspanyolca / Rusça", () => {
    for (const t of [
      "Please check with your host about the parking.",
      "Your host can confirm the exact time.",
      "Your host will be able to tell you more.",
      "Your host can provide more information about the sauna.",
      "Fragen Sie bitte Ihren Gastgeber nach dem Parkplatz.",
      "Ihr Gastgeber kann Ihnen das bestätigen.",
      "Demandez à votre hôte pour le parking.",
      "Votre hôte pourra vous confirmer l'heure.",
      "Pregunte a su anfitrión por el aparcamiento.",
      "Su anfitrión podrá confirmarle la hora.",
      "Уточните у хозяина, пожалуйста.",
      "Хозяин сможет подсказать точное время.",
    ]) {
      expect(refersGuestToHost(t), t).toBe(true);
    }
  });

  it("hariç: iletişim DEĞERİ veren cümle (sorulan bilgi), olay koşullu talimat, olgu, kural, teslim", () => {
    for (const t of [
      "Ev sahibinize 0532 123 45 67 numarasından ulaşabilirsiniz.",
      "You can contact your host at +90 532 123 45 67.",
      "Anahtarı kaybederseniz ev sahibinize ulaşın.",
      "Kombi arıza verirse ev sahibinizle iletişime geçin.",
      "If the Wi-Fi stops working, message your host.",
      "Ev sahibiniz sizi kapıda karşılayacak.",
      "Ev sahibiniz evde sigara içilmesini istemiyor.",
      "Your host can provide a baby cot on request.",
      "Your host will meet you at the entrance.",
      "Anahtarı çıkışta ev sahibinize teslim edin.",
      "Erken giriş için ev sahibinizden onay almanız gerekir.",
      "Wi-Fi şifresi Lale2025.",
    ]) {
      expect(refersGuestToHost(t), t).toBe(false);
    }
  });

  it("🚨 Haiku 10-23 akşam: konuş / görüş / yaz / ara / emir 'sorun'; e-posta / yazma; 'ask … if' tümleci; Almanca erfragen", () => {
    for (const t of [
      "Bu konuyu ev sahibinizle konuşabilirsiniz.",
      "Sauna için ev sahibinizle görüşebilirsiniz.",
      "Ev sahibinize yazabilirsiniz.",
      "Ev sahibinizi arayabilirsiniz.",
      "Ev sahibinize sorun.",
      "Ev sahibinize mesaj atabilirsiniz.",
      "Please ask your host if you can check out late.",
      "Your host can tell you if the parking is free.",
      "Please email your host about the pool.",
      "Please write to your host about the pool.",
      "Your host might be able to tell you about the sauna.",
      "Das können Sie bei Ihrem Gastgeber erfragen.",
      "Demandez à votre hôte si le parking est gratuit.",
    ]) {
      expect(refersGuestToHost(t), t).toBe(true);
    }
  });

  it("🚨 Haiku 10-23 akşam: yönlendirmenin OLUMSUZU yönlendirme değildir; ev sahibinin kendi eylemi değildir; acil durum talimatı", () => {
    for (const t of [
      "Ev sahibinize sormanıza gerek yok, kahvaltı 08:00'de başlar.",
      "Ev sahibinizle iletişime geçmenize gerek yok. Check-in 15:00.",
      "You don't need to contact your host, parking is free.",
      "There's no need to check with your host; check-in is at 15:00.",
      "Ev sahibiniz giriş saatinizi sorabilir.",
      "Ev sahibiniz sizi arayabilir.",
      "Ev sahibiniz sorun olmadığını belirtti.",
      "In an emergency, call your host.",
      "Acil bir durumda ev sahibinizi arayabilirsiniz.",
      "Contact your host if you lose the key.",
    ]) {
      expect(refersGuestToHost(t), t).toBe(false);
    }
    // Aynı cümlede başka bir şeyin "gerek yok"u yönlendirmeyi KALDIRMAZ (olumsuzluk fiile bitişik aranır).
    expect(refersGuestToHost("Havlu getirmenize gerek yok ama otopark için ev sahibinize sorabilirsiniz.")).toBe(true);
  });

  it("🚨 BİRİNCİ KİŞİ ('I'll check with the host … get back to you') misafiri ev sahibine göndermez — bekleme sözüdür, çıktı vetosunun işi", () => {
    for (const t of [
      "Thanks! I'll check with the host whether an early check-in is possible and get back to you.",
      "I will contact the host and update you shortly.",
      "Let me check with your host and come back to you.",
      "We'll ask the host and let you know.",
      "I'd be happy to ask the host for you.",
      "I'm going to message the host about the parking.",
      "I am also going to check with the owner.",
      "Ich werde bei Ihrem Gastgeber nachfragen und mich melden.",
    ]) {
      expect(refersGuestToHost(t), t).toBe(false);
    }
    // Öznesi misafir olan yönlendirme birinci kişi sözcüğü taşısa da yönlendirmedir; aynı cevaptaki ikinci cümle de sayılır.
    for (const t of [
      "I recommend you ask your host about the parking.",
      "I'd suggest that you contact the host directly.",
      "I'll check with the host. Meanwhile, you can ask your host directly.",
      // Haiku 10-23 akşam: "I'd / I would" tek başına koşullu tavsiyedir; "let's" misafiri de içine alır.
      "If I were you, I'd contact your host about early check-in.",
      "I would ask your host about the parking.",
      "Let's check with your host about early check-in.",
      "Ich empfehle, bei Ihrem Gastgeber nachzufragen. Sie können bei Ihrem Gastgeber nachfragen.",
    ]) {
      expect(refersGuestToHost(t), t).toBe(true);
    }
  });

  it("🚨 Opus 10-23 akşam A1: İHTİYAÇ / MERAK koşulu ('If you need …', 'ihtiyacınız varsa', 'merak ederseniz') muaf DEĞİL — yalnız olay / arıza / acil / varış talimatı", () => {
    for (const t of [
      "If you need parking, please ask your host.",
      "If you have any questions about the parking, contact your host.",
      "If you'd like to know more about the sauna, ask your host.",
      "Eğer otopark ihtiyacınız varsa ev sahibinize sorabilirsiniz.",
      "Merak ederseniz ev sahibinize sorabilirsiniz.",
      "Otopark konusunda ev sahibinize sorabilirsiniz, isterseniz size yardımcı olurlar.",
    ]) {
      expect(refersGuestToHost(t), t).toBe(true);
    }
    for (const t of [
      "Contact your host if you lose the key.",
      "If the Wi-Fi stops working, message your host.",
      "Kombi arıza verirse ev sahibinizi arayın.",
      "In an emergency, call your host.",
      // A4: varış talimatı bilgi isteği değil.
      "Please text your host when you arrive.",
      "Vardığınızda ev sahibinizi arayın, sizi kapıda karşılayacak.",
      "Lütfen girişten önce ev sahibinize tahmini varış saatinizi yazın.",
      "Please message your host with your arrival time.",
    ]) {
      expect(refersGuestToHost(t), t).toBe(false);
    }
  });

  it("🚨 Opus 10-23 akşam A2: eksik biçimler — İngilizce ulaç / 'should be able to' / 'would know' / çoğul / 'Airbnb host'; TR 'ilet-', 'hosta', 'mülk sahibi'; DE / FR / ES / RU mastar", () => {
    for (const t of [
      "I'd recommend contacting your host about the parking.",
      "Try asking your host about it.",
      "I suggest reaching out to your host for the details.",
      "Please consider messaging your host about it.",
      "Your host should be able to clarify this.",
      "Your host will be happy to help with that.",
      "Your host would know the exact time.",
      "Your host is the best person to ask about this.",
      "Please contact your hosts for more details.",
      "Please contact your Airbnb host.",
      "Bu sorunuzu ev sahibinize iletebilirsiniz.",
      "Hosta sorabilirsiniz.",
      "Mülk sahibinize sorabilirsiniz.",
      "Bitte setzen Sie sich mit Ihrem Gastgeber in Verbindung.",
      "Ihr Gastgeber kann Ihnen sicher weiterhelfen.",
      "N'hésitez pas à contacter votre hôte.",
      "Je vous invite à demander à votre hôte.",
      "Le recomiendo contactar con su anfitrión.",
      "No dude en consultar a su anfitrión.",
      "Рекомендую связаться с хозяином.",
      "Уточните, пожалуйста, у хозяина.",
    ]) {
      expect(refersGuestToHost(t), t).toBe(true);
    }
    // KONTROL: ev sahibinin hizmet olgusu / kendi eylemi yönlendirme değildir.
    for (const t of ["Your host can provide a baby cot.", "Ev sahibiniz sizi kapıda karşılayacak.", "Ihr Gastgeber holt Sie am Bahnhof ab."]) {
      expect(refersGuestToHost(t), t).toBe(false);
    }
  });

  it("🚨 Opus 10-23 akşam A3: iletişim değeri muafiyeti yalnız yönlendirmenin KENDİ yan cümlesinde — başka yan cümledeki numara / bağlantı kurtarmaz", () => {
    expect(refersGuestToHost("Kapı kodu 482913. Otopark için ev sahibinize sorabilirsiniz, dilerseniz 0532 123 45 67 numarasını arayabilirsiniz.")).toBe(true);
    expect(refersGuestToHost("Otopark için https://lale.example.com/rehber sayfasına bakabilir ya da ev sahibinize sorabilirsiniz.")).toBe(true);
    // KONTROL: sorulan iletişim değerini veren yönlendirme gider.
    expect(refersGuestToHost("Ev sahibinize 0532 123 45 67 numarasından ulaşabilirsiniz.")).toBe(false);
  });

  it("🚨 Opus 10-23 akşam A5: olumsuzluk EV SAHİBİNE bağlı — başka fiilin 'gerek yok'u yönlendirmeyi kaldırmaz", () => {
    expect(refersGuestToHost("Please ask your host about the parking; there is no need to call a taxi.")).toBe(true);
    expect(refersGuestToHost("Otopark için ev sahibinize sorabilirsiniz, taksi aramanıza gerek yok.")).toBe(true);
    // KONTROL: yönlendirmenin kendi olumsuzu yönlendirme değildir.
    expect(refersGuestToHost("No need to contact your host, check-in is self-service.")).toBe(false);
    expect(refersGuestToHost("Ev sahibinize sormanıza gerek yok, kahvaltı 08:00'de başlar.")).toBe(false);
  });

  it("🚨 Haiku 10-23 akşam: varış muafiyeti bilgi İSTEME fiilinde geçmez; soru koşulu olay sözcüğüyle de bilgi koşuludur; 've / and' yan cümle ayırır; cümle ortası satır sonu sınır değildir", () => {
    for (const t of [
      "Upon arrival, you can ask your host about the parking.",
      "Girişten önce ev sahibinize sorabilirsiniz.",
      "If you have any questions about the alarm, please ask your host.",
      "Taksi için 0532 123 45 67 numarasını arayın ve otopark için ev sahibinize sorabilirsiniz.",
      "Please contact\nyour host about the parking.",
    ]) {
      expect(refersGuestToHost(t), t).toBe(true);
    }
    // KONTROL: varış talimatı ("arayın / yazın") ve acil durum talimatı muaf kalır.
    expect(refersGuestToHost("Vardığınızda bir sorun olursa ev sahibinizi arayın.")).toBe(false);
    expect(refersGuestToHost("If the alarm goes off, call your host.")).toBe(false);
  });

  it("🚨 Opus 10-23 akşam A6: satır sonu cümle sınırıdır — başka satırdaki koşul / telefon yönlendirmeyi kurtarmaz", () => {
    expect(refersGuestToHost("- Otopark için ev sahibinize sorabilirsiniz\n- Anahtarı kaybederseniz ev sahibinizi arayın")).toBe(true);
    expect(refersGuestToHost("Otopark için ev sahibinize sorabilirsiniz\nResepsiyon 0212 555 66 77")).toBe(true);
    // KONTROL: koşul aynı satırdaysa olay talimatıdır.
    expect(refersGuestToHost("Wi-Fi şifresi: Lale2024\nAnahtarı kaybederseniz ev sahibinizi arayın")).toBe(false);
  });

  // ── Opus 10-23 akşam ikinci dilim kontrolü (R1–R5, R9) ─────────────────────────────────────────────────────────────────────────────
  it("🚨 R1: konulu bilgi yönlendirmesi varış sözcüğüyle muaf GEÇMEZ; konusuz varış talimatı muaf kalır", () => {
    for (const t of [
      "For parking, please contact your host before arrival.",
      "Regarding the parking, please message your host upon arrival.",
      "Please contact your host before arrival to confirm whether parking is available.",
      "Otopark konusunda varınca ev sahibinizle görüşebilirsiniz.",
      "Otopark için gelmeden önce ev sahibinize yazabilirsiniz.",
      "Bebek yatağı için varış saatinizle birlikte ev sahibinize yazabilirsiniz.",
    ]) {
      expect(refersGuestToHost(t), t).toBe(true);
    }
    for (const t of ["Please text your host when you arrive.", "Please message your host with your arrival time.", "Lütfen girişten önce ev sahibinize tahmini varış saatinizi yazın."]) {
      expect(refersGuestToHost(t), t).toBe(false);
    }
  });

  it("🚨 R2 / R9: olay ADI değil olay YÜKLEMİ — 'alarm şifresi / çalışma saatleri / acil çıkış / fire pit / Of course' muaf DEĞİL", () => {
    for (const t of [
      "Spor salonunun çalışma saatlerini öğrenmek isterseniz ev sahibinize sorabilirsiniz.",
      "Alarm şifresini öğrenmek isterseniz ev sahibinize sorabilirsiniz.",
      "If you need the alarm code, please ask your host.",
      "If you'd like to know whether there is a fire alarm, please ask your host.",
      "If you'd like to use the fire pit, check with your host.",
      "Acil çıkış kapısının yerini öğrenmek isterseniz ev sahibinize sorabilirsiniz.",
      "Of course, for the alarm code please ask your host.",
      "Perdone, si quiere saber el horario de la piscina, pregunte a su anfitrión.",
      "If you want to know about the lost and found, ask your host.",
      // Bilmek / öğrenmek sözcüğü OLMADAN da (mutasyon: "acil" adı, "lost and found", "Of course" koşul eki ayrı ayrı sınanır).
      "Acil çıkışı kullanmak isterseniz ev sahibinize sorabilirsiniz.",
      "If it's about the lost and found, please ask your host.",
      "Of course, please ask your host if the boiler is broken.",
    ]) {
      expect(refersGuestToHost(t), t).toBe(true);
    }
    for (const t of ["If the alarm goes off, call your host.", "Yangın çıkarsa ev sahibinizi arayın.", "Acil bir durumda ev sahibinizi arayın."]) {
      expect(refersGuestToHost(t), t).toBe(false);
    }
  });

  it("🚨 R3: gerçek olay / arıza talimatı GİDER (sorun / problem / goes wrong / kesilirse / -mazsa / -mıyorsa); 'sorunuz' (soru) tutulur", () => {
    for (const t of [
      "If you have a problem with the heating, call your host.",
      "Herhangi bir sorun olursa ev sahibinizi arayın.",
      "Bir sorun yaşarsanız ev sahibinizi arayabilirsiniz.",
      "If anything goes wrong during your stay, please contact your host.",
      "If there is any issue with the apartment, call your host.",
      "If the power goes out, contact your host.",
      "If the boiler breaks, call your host.",
      "Elektrikler kesilirse ev sahibinizi arayın.",
      "Kombi su akıtırsa ev sahibinizi arayın.",
      "Klima çalışmıyorsa ev sahibinize yazın.",
      "Wi-Fi çalışmazsa ev sahibinizi arayın.",
      "If you can't open the door, call your host.",
    ]) {
      expect(refersGuestToHost(t), t).toBe(false);
    }
    expect(refersGuestToHost("Sorunuz olursa ev sahibinize sorabilirsiniz.")).toBe(true);
  });

  it("🚨 R4: istenen telefonu veren konusuz cümle yan cümle / satır bölmesinden etkilenmez; konulu cümlede değer kendi yan cümlesinde olmalı", () => {
    for (const t of [
      "Ev sahibinize şu numaradan ulaşabilirsiniz:\n0532 123 45 67",
      "Ev sahibinize ulaşabilirsiniz, telefon: 0532 123 45 67",
      "You can call your host, the number is +90 532 123 4567.",
      "You can reach your host on WhatsApp, +90 532 123 45 67.",
      "Your host's number is +90 532 123 45 67 and you can call your host anytime.",
    ]) {
      expect(refersGuestToHost(t), t).toBe(false);
    }
    expect(refersGuestToHost("Taksi için 0532 123 45 67 numarasını arayın ve otopark için ev sahibinize sorabilirsiniz.")).toBe(true);
  });

  it("R5: satır sonu dizisi doğrusal (eski düzenli ifade 50.000 satır sonunda 10,5 sn)", () => {
    const t0 = performance.now();
    refersGuestToHost(`${"\n".repeat(50_000)}a`);
    refersGuestToHost(`ask your host ${"\n".repeat(50_000)}x`);
    expect(performance.now() - t0).toBeLessThan(1_000);
  });

  it("çok cümlede yalnız yönlendirme cümlesi sayılır; başka cümledeki koşul onu kurtarmaz", () => {
    expect(refersGuestToHost("Çöpler bina girişindeki konteynere atılır. Sauna için ev sahibinize sorabilirsiniz.")).toBe(true);
    expect(refersGuestToHost("Anahtarı kaybederseniz resepsiyona gidin. Otopark için ev sahibinize sorabilirsiniz.")).toBe(true);
    expect(refersGuestToHost("Çöpler bina girişindeki konteynere atılır. Ev sahibiniz sizi kapıda karşılayacak.")).toBe(false);
  });

  it("iletişim değeri: telefon (10–15 rakam), e-posta, bağlantı; saat / tarih / kapı kodu / fiyat değil", () => {
    for (const t of ["+90 532 123 45 67", "0532 123 45 67", "info@example.com", "https://example.com/x", "www.example.com", "bit.ly/3xYzAb", "t.me/lixusdestek", "airbnb.com/rooms/123"]) {
      expect(containsContactValue(t), t).toBe(true);
    }
    for (const t of ["15:00", "12.10.2026", "Kapı kodu 4590", "1.500 TL", "lixusai.com", "Fiyat 250 TL/gece", "15.00/16.00 arası", "a.m./p.m.", ""]) {
      expect(containsContactValue(t), t).toBe(false);
    }
  });

  it("süre: uzun tekrar / tek sözcük / boşluk dizisi doğrusal", () => {
    const t0 = performance.now();
    refersGuestToHost("ev sahibiniz ".repeat(4_000));
    refersGuestToHost(`${"a".repeat(50_000)} ev sahibinize`);
    refersGuestToHost(`your host ${" ".repeat(50_000)}can`);
    refersGuestToHost("your host can ".repeat(3_000));
    // Opus 10-23 akşam A3 / A5 / A6: yan cümle bölme, ev sahibine bağlı olumsuzluk, satır sonu (eski `\s*\n` 50.000 boşlukta 3,3 sn'ydi).
    refersGuestToHost("ev sahibinize sorabilirsiniz, ".repeat(3_000));
    refersGuestToHost(`${"ev sahibinize ".repeat(3_000)}sormanıza gerek yok`);
    refersGuestToHost(`ask your host${"\n ".repeat(25_000)}`);
    refersGuestToHost(`if you ${"e".repeat(50_000)} ask your host`);
    expect(performance.now() - t0).toBeLessThan(2_000);
  });
});
