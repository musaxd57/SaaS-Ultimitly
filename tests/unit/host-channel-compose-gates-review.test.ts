import { describe, it, expect } from "vitest";
import { apologizes, checkComposedGuestReply, hostMakesOwnPromise, mentionsOffPlatformChannel } from "@/lib/host-channel/compose-check";
import { namesPaymentMethodInProse } from "@/lib/payment-method-guard";

// ---------------------------------------------------------------------------
// Talimat biçimli ev sahibi cevabının kod kapıları — sert inceleme 10-31 bulguları (iki yön: KAÇAK ve HAKSIZ TUTMA). Örnekler incelemecilerin
// tsx ile yeniden ürettiği cümlelerdir. Kapılar yedektir: ev sahibi önizlemeyi görüp [Gönder]'e basar.
// ---------------------------------------------------------------------------

const check = (reply: string, hostAnswer: string) => checkComposedGuestReply({ reply, hostAnswer });

describe("akşam saati konumsal; gece 1–5 asla öğleden sonra olmaz", () => {
  it.each([
    ["You can check in until 14:00.", "Gece 2'ye kadar giriş yapabilirsiniz"],
    ["Sessizlik 13:00'ten sonra başlar.", "Sessizlik gece 1'den sonra"],
    ["Заезд возможен до 14:00.", "Заезд до 2 часов ночи"],
    ["Gece 2'den itibaren giriş yapabilirsiniz.", "Giriş 14:00'ten itibaren"],
    ["Yes, you can stay. Check-in is at 15:00.", "Evet, 3 gece kalabilirsiniz"],
    ["Sí. El check-in es a las 14:00.", "Sí, 2 noches"],
    ["Да, заезд в 14:00.", "Минимум 2 дня"],
    ["Llegaré a las 17:00.", "Llegaré 5 minutos tarde"],
    ["Check-in ab 20 Uhr.", "sabah 8den sonra"],
    ["Breakfast at 20:00.", "akşam 7, sabah 8"],
    ["You can check in after 8 am.", "20den sonra girebilir"],
  ])("KAÇAK KAPANDI: %s ← %s", (reply, host) => {
    expect(check(reply, host)).toBe("number_not_in_source");
  });
  it.each([
    ["Check-in ab 20 Uhr möglich.", "akşam 8den sonra girebilir"],
    ["Quiet hours start at 23:00.", "gece 11den sonra sessiz"],
    ["Заезд в 14:00.", "заезд в 2 часа дня"],
    ["Check-in from 20:00.", "check-in from 8pm"],
    ["Dinner at 20:00.", "dinner this evening at 8"],
    ["Between 20:00 and 21:00.", "akşam 8-9 arası"],
    ["Between 20:00 and 21:00.", "8-9 pm"],
    ["Quiet after 00:00.", "gece 12den sonra sessiz"],
    ["Giriş 20.30'dan sonra.", "giriş 20:30dan sonra"],
    ["Check-in from 20:30.", "akşam 8:30dan sonra"],
    ["You can check in after 8 pm.", "20den sonra girebilir"],
    ["Check-in is at 18:00.", "akşamüstü 6 gibi gelin"],
    ["Open until 20:00.", "akşamları 8'e kadar açık"],
  ])("GEÇER: %s ← %s", (reply, host) => {
    expect(check(reply, host)).toBeNull();
  });
});

describe("özür ve kusur kabulü", () => {
  it("konum / 'ne yazık ki' / 'aşağıda' / tuvalet özür sayılmaz; gerçek özür sayılır", () => {
    for (const t of ["You're right next to the beach.", "المصعد في الطابق الأسفل", "للأسف لا يوجد مصعد", "El excusado está a la derecha.", "Bedauerlicherweise ist kein Parkplatz frei."]) {
      expect(apologizes(t), t).toBe(false);
    }
    for (const t of ["آسف، الفني سيأتي غدا", "Wir bedauern die Unannehmlichkeiten.", "You're right, sorry about that.", "Toutes mes excuses pour la gêne.", "Je m'excuse.", "Please excuse the mess.", "Excuse us for the inconvenience.", "Очень сожалею об этом."]) {
      expect(apologizes(t), t).toBe(true);
    }
    for (const t of ["К сожалению, большую собаку нельзя.", "Excuse me, the lift is on the left."]) expect(apologizes(t), t).toBe(false);
  });
  it("özür isteği kusur kabulünü açmaz; 'özür dileme' özrü açmaz; açık istek açar", () => {
    expect(check("Haklısınız, teknisyen yarın geliyor.", "özür dileyerek yaz, teknisyen yarın gelecek")).toBe("apology");
    expect(check("Özür dileriz, teknisyen yarın geliyor.", "özür dileme, teknisyen yarın gelecek de")).toBe("apology");
    expect(check("Özür dileriz, teknisyen yarın geliyor.", "özür dileyerek yaz, teknisyen yarın gelecek")).toBeNull();
    expect(check("Haklısınız, teknisyen yarın geliyor.", "haklısınız de, teknisyen yarın gelecek")).toBeNull();
  });
});

describe("ev sahibinin sözü", () => {
  it("İngilizce kısaltmada kesme işareti şart: 'well' / 'ill' söz değildir", () => {
    expect(hostMakesOwnPromise("well, towels are in the closet")).toBe(false);
    expect(hostMakesOwnPromise("we'll bring towels")).toBe(true);
  });
});

describe("başka uygulama", () => {
  it.each(["Gerekirse WP'den yazabilirsiniz.", "Feel free to DM us on Insta.", "Напишите нам в Вацап или Вайбер.", "راسلونا على فايبر أو انستغرام.", "راسلونا على تليجرام.", "You can reach us on KakaoTalk too.", "Write us on Whats-App.", "What​sApp us", "Add me on Snapchat"])(
    "TUTULUR: %s",
    (t) => expect(mentionsOffPlatformChannel(t)).toBe(true),
  );
  it.each(["The wifi signal is strong.", "Instant coffee is in the kitchen.", "Installation is complete.", "A messenger bag is in the closet.", "Instagram-worthy view from the balcony.", "online check-in", "Mutfakta kahve, çay ve kakao var.", "الإنترنت فايبر وسريع", "У входа есть телега для багажа."])(
    "GEÇER: %s",
    (t) => expect(mentionsOffPlatformChannel(t)).toBe(false),
  );
});

describe("ödeme (misafire yazılmış düz metin kipi)", () => {
  it.each([
    "La fianza se paga por transferencia bancaria antes de llegar.", "Bitte überweisen Sie die Kaution vorab auf unser Konto.",
    "Залог можно оплатить переводом на карту Сбербанка.", "يمكنكم دفع التأمين عن طريق تحويل بنكي.", "Vous pourrez régler la caution sur place.",
    "Puede pagar la fianza al llegar.", "La fianza se puede enviar por Bizum.", "Please pay the cleaning fee when you arrive.",
    "Temizlik ücretini geldiğinizde ödeyebilirsiniz.", "Depozitoyu kartıma gönderebilirsiniz.", "Cobramos 20 € al llegar.", "Kalan tutarı nakit ödeyebilirsiniz.",
  ])("TUTULUR: %s", (t) => expect(namesPaymentMethodInProse(t)).toBe(true));
  it.each([
    "Parking is free of charge and you can register in person at the desk.", "I will send the towels directly to your room.",
    "There is a cash machine next door.", "The airport transfer picks you up directly at arrivals.", "Otopark ücretsizdir, binanın önüne park edebilirsiniz.",
    "Посмотрите на карту района.", "Anahtar kapıdaki kutuda.", "There is no extra fee for early check-in. Just message us when you arrive.",
    "Ek ücret yok. Eve girerken ışıkları açın.", "Geç çıkış 300 TL. Geldiğinizde bize yazın.",
  ])("GEÇER: %s", (t) => expect(namesPaymentMethodInProse(t)).toBe(false));
});

describe("sıra: telefon numarası 'uydurulmuş sayı' değil, gerçek nedeniyle söylenir", () => {
  it("contact_value önce", () => {
    expect(check("Call me on +90 532 111 22 33.", "beni arasınlar")).toBe("contact_value");
  });
});

describe("süre (uzun metinde karesel iş yok)", () => {
  it("50.000 karakterlik boşluk / sayı / işaret dizisinde 1 sn altında", () => {
    const inputs = [" ".repeat(50_000), "8 ".repeat(25_000), "akşam ".repeat(8_000), "w-h-a-t-s ".repeat(5_000), "kapida ucret ".repeat(4_000)];
    for (const s of inputs) {
      const t0 = performance.now();
      check(s, s);
      namesPaymentMethodInProse(s);
      expect(performance.now() - t0).toBeLessThan(1_000);
    }
  });
});
