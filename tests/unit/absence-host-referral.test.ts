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
