import { describe, it, expect } from "vitest";
import { analyzeHostContact, isSafetyWarningSentence } from "@/lib/ai/host-contact-filler";
import { hostContactKindOf } from "@/lib/ai/absence";
import { topicsWithSymptomsOf } from "@/lib/conversation-items/relation";

// ---------------------------------------------------------------------------
// K-1029-A v4 (10-30) — v3'ün çekişmeli yeniden incelemesinin 33 bulgusu (kaçak biçimler LEAK-01…08, aklama LAUNDER-01…03, veto aklaması
// VETO-1, fazla silme fp-01…fp-11, güvenlik SAFE-1…6, "gerekirse / isterseniz" kapanışı SETTLE-01). Kırmızı-önce: v3 (98b5d838) bu
// tabloda 199 vakanın çoğunu kaçırıyordu (ölçüm `docs/INCELEME-2026-10-28-gece-dongusu.md` v4 bölümü).
// ---------------------------------------------------------------------------

/** Tek cümle: yakalanmalı. */
const DETECT: string[] = [
  // LEAK-01
  "Please check this with your host.", "Please confirm the time with your host.", "Please verify the details with your host.",
  "Please double-check the time with your host.", "I'd suggest arranging this with your host.", "I recommend coordinating directly with your host.",
  "Please report any issues with the heating to your host.", "Please arrange the details of your arrival directly with your host.",
  "You can request a late checkout from your host.", "Please keep your host updated on your arrival time.",
  "For early check-in, please confirm availability with your host.", "I'd recommend confirming this with your host before you arrive.",
  "It's best to double-check the parking details with your host.", "You may want to check this directly with your host.",
  "Late checkout may be possible; please confirm it with your host.", "I suggest checking this with your host.",
  "You can request early check-in from your host.", "Please keep your host informed.", "Please keep your host posted on your arrival time.",
  "I'd suggest coordinating with your host.", "Please coordinate the exact time of the key handover with your host.",
  "Bitte klären Sie die genaue Uhrzeit mit Ihrem Gastgeber.",
  // LEAK-02
  "If you're arriving after midnight, please also let your host know.", "If something breaks, take a photo and then notify your host.",
  "Please also inform your host.", "If the heater stops working, then alert your host.", "If you lose the key, please also notify your host.",
  // LEAK-03
  "Bir sorun olursa haber verin.", "Herhangi bir sorun olursa lütfen haber verin.", "Bir şeye ihtiyacınız olursa haber vermeniz yeterli.",
  "Başka bir sorunuz olursa lütfen bildirin.", "Ek bir talebiniz olursa iletebilirsiniz.", "Başka bir isteğiniz varsa çekinmeden iletin.",
  "Sorularınız varsa bana iletebilirsiniz.", "Herhangi bir sorunuz olursa buradan yazabilirsiniz.", "Bir sorun olursa bu sohbetten yazabilirsiniz.",
  "Lütfen ev sahibinizi önceden haberdar edin.", "Erken giriş için ev sahibinizden rica edebilirsiniz.", "Bu durumu ev sahibinize aktarabilirsiniz.",
  // LEAK-04
  "If you need anything, please contact our team.", "Feel free to contact our team if you need anything.", "Please message your co-host.",
  "Please contact the co-host.", "Bei Fragen wenden Sie sich gerne an unser Team.", "N'hésitez pas à contacter notre équipe.",
  "No dude en contactar a nuestro equipo.", "Herhangi bir sorunuz olursa ekibimize ulaşabilirsiniz.",
  // LEAK-05
  "Bei Fragen können Sie sich gerne bei uns melden.", "Bei Fragen können Sie sich gerne melden.", "Melden Sie sich gerne jederzeit, wenn Sie Fragen haben.",
  "Sagen Sie einfach Bescheid, wenn Sie noch etwas brauchen.", "Geben Sie Bescheid, falls Sie noch etwas brauchen.", "Geben Sie Ihrem Gastgeber kurz Bescheid.",
  "Nehmen Sie bitte Kontakt zu Ihrem Gastgeber auf.", "Sie können direkt Kontakt zu Ihrem Gastgeber aufnehmen.", "Klären Sie das am besten direkt mit Ihrem Gastgeber.",
  "Sprechen Sie Ihren Gastgeber direkt an.", "Halten Sie bitte Rücksprache mit Ihrem Gastgeber.", "Stimmen Sie den frühen Check-in bitte mit Ihrem Gastgeber ab.",
  // LEAK-06
  "Merci de contacter directement votre hôte.", "Je vous invite à vous adresser directement à votre hôte.", "Je vous conseille de vous renseigner auprès de votre hôte.",
  "Je vous conseille de vérifier auprès de votre hôte.", "Je vous conseille d'en parler à votre hôte.", "Il est préférable de contacter votre hôte.",
  "Posez la question à votre hôte.", "Parlez-en à votre hôte.", "Votre hôte reste joignable via l'application.",
  "Faites-moi savoir si vous avez besoin d'autre chose.", "Si vous avez des questions, n'hésitez pas à me faire signe.",
  // LEAK-07
  "Le sugiero que se comunique con su anfitrión.", "Lo mejor sería que se comunique con su anfitrión.", "Puede comunicarse directamente con su anfitrión.",
  "Sería mejor preguntarle a su anfitrión.", "Avísenos si necesita algo más.", "Si necesita algo, me avisa.", "Si necesita algo, déjeme saber.",
  "Cualquier cosa, me escribe.", "Si necesita algo más, solo tiene que escribirnos.",
  // LEAK-08
  "Свяжитесь напрямую с хозяином квартиры.", "Обратитесь напрямую к хозяину.", "Сообщите об этом, пожалуйста, хозяину.", "Уточните этот вопрос у хозяина.",
  "Спросите об этом хозяина.", "Предупредите хозяина заранее.", "يرجى الاستفسار من المضيف.", "استفسر من المضيف.", "راجع المضيف بخصوص ذلك.",
  "أخطر المضيف بأي ضرر.", "أخبرني إذا احتجت أي شيء.", "أعلمنا إذا احتجت أي شيء.", "تواصل مع صاحب البيت.", "تواصلي مع مضيفتك.",
];

/** Tek cümle (ya da kısa cevap): dokunulmamalı. */
const NODETECT: string[] = [
  "I'll check this with your host and get back to you.", "The cleaner will confirm the time with your host.", "I'll be checking this with your host.",
  "We are confirming this with your host right now.", "Your booking was confirmed with your host.", "Check-in is arranged with the host's cleaner.",
  // fp-02 / fp-07
  "Thanks for contacting us, and if you need extra towels, they're in the hallway closet on the top shelf.",
  "Bizimle iletişime geçtiğiniz için teşekkür ederiz; ihtiyacınız olursa ekstra havlular koridordaki dolabın üst rafında.",
  "Thank you for messaging us, and should you need a hair dryer, there's one in the bathroom drawer.",
  "Ev sahibinizle iletişime geçildiğinde çıkış saati 11:00 olarak onaylanmıştı.", "Ev sahibinize daha önce haber verilen kombi arızası yarın sabah 10:00'da giderilecek.",
  "Ev sahibinize mesaj attığınızı görüyorum; kombi teknisyeni yarın 10:00'da gelecek.",
  // fp-05 / fp-06 / fp-11
  "There's a great bakery on the corner. Ask the owner for the pistachio simit — it's fresh every morning at 7:00.",
  "Follow the dirt road for 500 m to reach the owner's house; the guest cottage is right behind it.",
  "Lale Café downstairs gives our guests 10% off — just mention the apartment name to the owner when you pay.",
  "Fragen Sie den Eigentümer der Bäckerei nach dem Pistazien-Simit, er ist jeden Morgen frisch.",
  "At the gate, ring the owner's bell (the left one) and the gate will open.",
  "Cleaning is daily at 11:00, and the cleaners report any damage to the host.", "The red button next to the door is an alarm used to alert the host.",
  "Батарейки для пульта можно купить в магазине за углом; если не найдёте, можете обратиться в хозяйственный магазин на соседней улице.",
  // fp-09
  "You don't need to arrange anything with your host; the lockbox code is 4821 and check-in is from 15:00.",
  "You don't have to get in touch with your host when you arrive; the lockbox code is 4821.",
  "Çıkışta ev sahibinize haber vermenize gerek yok, anahtarı masaya bırakmanız yeterli.", "Giriş için ev sahibinize yazmanız gerekmez; kapı kodu 4821.",
  "No es necesario que le escriba a su anfitrión; el código de la puerta es 4821.",
  "Rather than messaging your host, just use the lockbox by the door — the code is 4821.",
  "Schreiben Sie Ihrem Gastgeber bitte nicht wegen des Codes, der Code 4821 gilt die ganze Woche.",
  // fp-10
  "An airport taxi costs 900 TL. If you need one, let us know what time and we'll book it.",
  "If you need it, let us know the date and we'll set it up before you arrive.",
  "Falls Sie ein Babybett brauchen, sagen Sie uns bitte Bescheid, dann stellen wir es vorher auf.",
  "If you're arriving after 22:00, please let us know so we can leave the hallway light on.",
];

/** Bütün cevap: beklenen gönderilen metin; null = TAMAMI tutulur; UNCHANGED = dokunulmaz. */
type Exp = string | null | "UNCHANGED";
const ANALYZE: [string, string, Exp][] = [
  // pronoun across sentences
  ["L5p", "Ihr Gastgeber wohnt nebenan. Bei Fragen können Sie sich gerne an ihn wenden.", "Ihr Gastgeber wohnt nebenan."],
  ["L6p", "Votre hôte habite à côté. N'hésitez pas à le contacter.", "Votre hôte habite à côté."],
  ["L7p", "Su anfitrión vive al lado. No dude en contactarlo.", "Su anfitrión vive al lado."],
  ["L8p", "Хозяин живёт рядом. Можете написать ему в любое время.", "Хозяин живёт рядом."],
  ["L8a", "المضيف يسكن بجانبك. يمكنك التواصل معه في أي وقت.", "المضيف يسكن بجانبك."],
  // LAUNDER-01: hedge in the removed sentence
  ["LA1a", "Street parking is free in front of the building. I'm not 100% sure about this, so it's best to confirm with your host.", null],
  ["LA1b", "Check-out is at 11:00. I'm not completely sure about that, so please check with your host.", null],
  ["LA1c", "The sauna is open until 22:00. I believe that's right, but please confirm with your host.", null],
  ["LA1d", "Otopark ücretsiz. Bundan tam emin değilim, ev sahibinize teyit edebilirsiniz.", null],
  ["LA1e", "Парковка бесплатная. Но я не уверен на сто процентов, поэтому лучше уточнить у хозяина.", null],
  // SETTLE-01
  ["S1a", "Early check-in depends on the cleaning schedule. If needed, message your host.", null],
  ["S1b", "Erken giriş temizlik programına bağlı. Gerekirse ev sahibinize yazabilirsiniz.", null],
  ["S1c", "Erken giriş temizlik programına bağlı. Dilerseniz ev sahibinizle iletişime geçebilirsiniz.", null],
  ["S1d", "Geç çıkış bir sonraki rezervasyona bağlı. İsterseniz ev sahibinize sorabilirsiniz.", null],
  ["S1e", "Erken giriş mümkün. İsterseniz ev sahibinize yazabilirsiniz.", null],
  // "Gerekirse / if needed" kendi başına GENEL kapanış: kalan metin belirsizlik ya da izin söylemiyorsa cevap gider (v2 F2 "Si besoin" pini).
  ["S1f", "Wi-Fi şifresi Lale1234. Gerekirse ev sahibinize yazabilirsiniz.", "Wi-Fi şifresi Lale1234."],
  ["S1g", "The Wi-Fi password is Lale1234. If needed, message your host.", "The Wi-Fi password is Lale1234."],
  ["S1h", "Wi-Fi şifresi Lale1234. İsterseniz ev sahibinize sorabilirsiniz.", "Wi-Fi şifresi Lale1234."],
  ["S1i", "Late checkout is possible. If you'd like, message your host.", null],
  // LAUNDER-02 / VETO-1 / fp-08
  ["LA2a", "Erken giriş saat 12:00'de uygun. Ev sahibinizle görüştüm, yola çıkınca ona yazabilirsiniz.", null],
  ["LA2b", "Your late checkout until 14:00 is approved. I've passed this on to your host — just message them if anything changes.", null],
  ["V1a", "Kombi düğmesi sol tarafta. Hâlâ çalışmazsa ev sahibinize yazın, ben de durumu ev sahibinize ilettim.", null],
  ["V1b", "The heating switch is on the left side of the boiler. If it still doesn't work after that, I've already let your host know, so feel free to message them too.", null],
  ["V1c", "The router is in the hallway. If the router stops working, message your host and I will arrange a replacement for you.", null],
  ["F8a", "Yes, a late checkout until 14:00 is possible for 15 EUR. If you want it, let me confirm with the cleaning team for your date.", "UNCHANGED"],
  ["F8b", "Late checkout is usually possible. If you need it, let me check availability for your dates.", "UNCHANGED"],
  ["F8c", "I've let your host know you'll arrive around 23:00. The lockbox code is 4821.", "UNCHANGED"],
  ["F8d", "Ev sahibinize mesaj attım, yarın sabah teknisyen gelecek. Bu arada Wi-Fi şifresi Lale1234.", "UNCHANGED"],
  // LAUNDER-03
  ["LA3a", "Early check-in is possible. Please arrange it with your host beforehand.", null],
  ["LA3b", "Erken giriş mümkün, ev sahibinizle ayarlamanız yeterli.", null],
  ["LA3c", "Evet, evcil hayvan kabul ediliyor, ancak önceden ev sahibinize haber vermeniz gerekiyor.", null],
  ["LA3d", "Late checkout until 13:00 is usually possible. Just let your host know the day before.", null],
  ["LA3e", "Late checkout depends on the next booking. If you want, feel free to ask your host.", null],
  ["LA3f", "Street parking is free, though I'm not entirely sure, so drop your host a message to double-check.", null],
  ["LA3g", "Der Parkplatz vor dem Haus ist kostenlos, aber ich bin mir nicht ganz sicher, fragen Sie am besten Ihren Gastgeber.", null],
  // fp-01 (GD5: only the instruction clause goes)
  ["F1a", "Check-in is at 15:00. The pool is open until 22:00, but for the sauna hours please message your host.", "Check-in is at 15:00. The pool is open until 22:00."],
  ["F1b", "Giriş saati 15:00. Havuz 22:00'ye kadar açık, sauna saatleri için ise ev sahibinize sorabilirsiniz.", "Giriş saati 15:00. Havuz 22:00'ye kadar açık."],
  ["F1c", "Check-in is at 15:00. Parking is free in the courtyard and the gym is on floor -1, but please ask your host about the sauna.", "Check-in is at 15:00. Parking is free in the courtyard and the gym is on floor -1."],
  // fp-02
  ["F2a", "Thanks for contacting us, and if you need extra towels, they're in the hallway closet on the top shelf.", "UNCHANGED"],
  ["F2b", "Bizimle iletişime geçtiğiniz için teşekkür ederiz; ihtiyacınız olursa ekstra havlular koridordaki dolabın üst rafında.", "UNCHANGED"],
  ["F2c", "Thank you for messaging us, and should you need a hair dryer, there's one in the bathroom drawer.", "UNCHANGED"],
  // fp-03
  ["F3a", "The Wi-Fi network is Lale_5G and the password is Lale1234. If it doesn't work, just message your host.", "The Wi-Fi network is Lale_5G and the password is Lale1234."],
  ["F3b", "The lockbox code is 4821. If that doesn't work, message your host.", "The lockbox code is 4821."],
  ["F3c", "Check-in is at 15:00 and the lockbox code is 4821. If anything breaks during this stay, message your host.", "Check-in is at 15:00 and the lockbox code is 4821."],
  // fp-04 (a closing never makes a reply stricter than the reply without it)
  ["F4a", "Yes! Luggage may be left in the storage room next to the entrance until 18:00 on your departure day. If anything breaks or stops working, message your host.", "Yes! Luggage may be left in the storage room next to the entrance until 18:00 on your departure day."],
  ["F4b", "Guests don't have access to the rooftop terrace, but the balcony has a lovely sea view. If anything breaks or stops working, message your host.", "Guests don't have access to the rooftop terrace, but the balcony has a lovely sea view."],
  ["F4c", "Guests who can't check in before 22:00 can use the lockbox by the door (code 4821). If anything breaks or stops working, message your host.", "Guests who can't check in before 22:00 can use the lockbox by the door (code 4821)."],
  ["F4d", "Anahtar kutusu kapının sağındaki duvarda, kodu 4821. Kutuyu bulamadıysanız binanın arka girişine bakın. Bir sorun olursa ev sahibinize yazın.", "Anahtar kutusu kapının sağındaki duvarda, kodu 4821. Kutuyu bulamadıysanız binanın arka girişine bakın."],
  ["F4e", "Çatı terasına erişim yok, ancak balkonda deniz manzarası var. Bir sorun olursa ev sahibinize yazın.", "Çatı terasına erişim yok, ancak balkonda deniz manzarası var."],
  ["F4f", "Sí, creo que le encantará la terraza. El check-in es a las 15:00 y el código es 4821. Si surge algún problema, escriba a su anfitrión.", "Sí, creo que le encantará la terraza. El check-in es a las 15:00 y el código es 4821."],
  ["F4g", "I think you'll love the view from the balcony! Check-in is at 15:00 and the code is 4821. If anything breaks or stops working, message your host.", "I think you'll love the view from the balcony! Check-in is at 15:00 and the code is 4821."],
  // fp-05
  ["F5a", "Your host recommends Lale Taxi for airport transfers. You can call them on +90 532 123 45 67; they speak English.", "UNCHANGED"],
  ["F5b", "The Lale Hotel next door sells gym day passes for 10 EUR. Just call them on +90 212 555 01 02 to book a slot.", "UNCHANGED"],
  ["F5c", "The hostel next door rents bikes for 100 TL a day. Just ask them at the front desk.", "UNCHANGED"],
  ["F5d", "El Hotel Lale, enfrente, tiene gimnasio con pase de día por 10 EUR. Llámele para reservar.", "UNCHANGED"],
  ["F5e", "Your host recommends the boat tours from the marina — Captain Ali runs them daily at 10:00. Just message him on WhatsApp to book.", "UNCHANGED"],
  ["F5f", "Your host's sister Ayşe lives downstairs and keeps a spare key. Just call her if you get locked out.", "UNCHANGED"],
  // fp-07 / fp-11 / fp-09 / fp-10 whole replies
  ["F7a", "Ev sahibinizle iletişime geçildiğinde çıkış saati 11:00 olarak onaylanmıştı. Anahtarı masaya bırakmanız yeterli.", "UNCHANGED"],
  ["F7b", "Ev sahibinize daha önce haber verilen kombi arızası yarın sabah 10:00'da giderilecek. Bu arada elektrikli ısıtıcı yatak odasındaki dolapta.", "UNCHANGED"],
  ["F9a", "You don't need to arrange anything with your host; the lockbox code is 4821 and check-in is from 15:00.", "UNCHANGED"],
  ["F10a", "An airport taxi costs 900 TL. If you need one, let us know what time and we'll book it.", "UNCHANGED"],
  ["F10b", "If you're arriving after 22:00, please let us know so we can leave the hallway light on. The lockbox code is 4821.", "UNCHANGED"],
  // SAFE-1
  ["SF1a", "Check-in is from 15:00. If the smoke alarm goes off, call your host immediately; for anything else, feel free to message them.", "Check-in is from 15:00. If the smoke alarm goes off, call your host immediately."],
  ["SF1b", "Wenn Sie Gas riechen, rufen Sie Ihren Gastgeber sofort an; bei anderen Fragen schreiben Sie ihm einfach.", "Wenn Sie Gas riechen, rufen Sie Ihren Gastgeber sofort an."],
  ["SF1c", "Если почувствуете запах газа, позвоните хозяину и напишите ему.", "Если почувствуете запах газа, позвоните хозяину."],
  ["SF1d", "If the smoke alarm goes off, open the windows, call your host and then text them a photo of the panel.", "If the smoke alarm goes off, open the windows, call your host."],
  // SAFE-2
  ["SF2a", "If you smell gas, don't use any light switches and open all the windows. Then leave the apartment and call your host from outside.", "UNCHANGED"],
  ["SF2b", "Gaz kokusu alırsanız elektrik düğmelerine dokunmayın ve pencereleri açın. Ardından daireden çıkın ve dışarıdan ev sahibinizi arayın.", "UNCHANGED"],
  ["SF2c", "If the carbon monoxide alarm goes off, open the windows. Then get everyone out of the flat and message your host.", "If the carbon monoxide alarm goes off, open the windows. Then get everyone out of the flat."],
  // SAFE-3
  ["SF3a", "The stove runs on gas: turn the knob and press to ignite. If you ever smell gas, call 112 or message your host right away.", "The stove runs on gas: turn the knob and press to ignite. If you ever smell gas, call 112."],
  ["SF3b", "Ocak doğalgazlı, düğmeyi çevirip bastırarak yakabilirsiniz. Gaz kokusu alırsanız 112'yi arayın ya da ev sahibinize yazın.", "Ocak doğalgazlı, düğmeyi çevirip bastırarak yakabilirsiniz. Gaz kokusu alırsanız 112'yi arayın."],
  ["SF3c", "If you smell gas, call or message your host immediately.", null],
  // SAFE-4
  ["SF4a", "الموقد يعمل بالغاز. إذا شممت رائحة غاز، افتح النوافذ وغادر الشقة فوراً وراسل المضيف.", "الموقد يعمل بالغاز. إذا شممت رائحة غاز، افتح النوافذ وغادر الشقة فوراً."],
  ["SF4b", "الموقد يعمل بالغاز. إذا شممت رائحة غاز، اتصل بالمضيف فوراً.", "UNCHANGED"],
  ["SF4c", "جهاز الإنذار في الممر. إذا انطلق إنذار الدخان، افتح النوافذ وأخبر المضيف.", "جهاز الإنذار في الممر. إذا انطلق إنذار الدخان، افتح النوافذ."],
  // SAFE-5
  ["SF5a", "If the smoke alarm goes off, open the windows and call or contact your host via the app.", null],
  // SAFE-6
  ["SF6a", "The heater is under the window. If you notice a burning smell from the heater, unplug it immediately and message your host.", "The heater is under the window. If you notice a burning smell from the heater, unplug it immediately."],
  ["SF6b", "Isıtıcı pencerenin altında. Isıtıcıdan yanık kokusu gelirse hemen fişini çekin ve ev sahibinize yazın.", "Isıtıcı pencerenin altında. Isıtıcıdan yanık kokusu gelirse hemen fişini çekin."],
  ["SF6c", "If you see exposed wires or the boiler overheats, switch off the main breaker and message your host.", "If you see exposed wires or the boiler overheats, switch off the main breaker."],
];

describe("v4 — dedektör: kaçan biçimler yakalanır", () => {
  it.each(DETECT)("yakalanır: %j", (s) => {
    expect(hostContactKindOf(s)).not.toBeNull();
  });
});

describe("v4 — dedektör: fazla silme yok", () => {
  it.each(NODETECT)("dokunulmaz: %j", (s) => {
    expect(hostContactKindOf(s)).toBeNull();
  });
});

describe("v4 — süzgeç: bütün cevap", () => {
  it.each(ANALYZE)("%s", (_id, reply, expected) => {
    const a = analyzeHostContact(reply);
    if (expected === "UNCHANGED") {
      expect(a.removals).toHaveLength(0);
      expect(a.nothingLeft).toBe(false);
      expect(a.text).toBe(reply);
    } else if (expected === null) {
      expect(a.nothingLeft).toBe(true);
    } else {
      expect(a.nothingLeft).toBe(false);
      expect(a.text).toBe(expected);
    }
  });
});

describe("v4 — konu okumasının tek girdilik önbelleği", () => {
  it("aynı metin iki kez okununca aynı sonuç, çağıranın değiştirdiği dizi önbelleği bozmaz", () => {
    const text = "Wi-Fi şifresi Lale1234; havlular dolapta.";
    const first = topicsWithSymptomsOf(text);
    first.push("bozuk");
    expect(topicsWithSymptomsOf(text)).not.toContain("bozuk");
    // Önbellekten dönen dizi de kopyadır (mutasyon V4-R1: önbellekteki diziyi doğrudan döndürmek sonraki okumayı bozardı).
    const hit = topicsWithSymptomsOf(text);
    hit.push("bozuk");
    expect(topicsWithSymptomsOf(text)).not.toContain("bozuk");
    expect(topicsWithSymptomsOf(text)).toEqual(topicsWithSymptomsOf(`${text} `.trimEnd()));
    expect(topicsWithSymptomsOf("Klima çalışmıyor.")).not.toEqual(topicsWithSymptomsOf(text));
  });
});

describe("v4 — mutasyon pinleri (ilk koşuda yaşayan mutantlar)", () => {
  // V4-F4: genel ihtiyaç kapanışı ("bir şeye ihtiyacınız olursa … haber vermeniz yeterli") ön koşul DEĞİLDİR — izin cümlesi gider.
  it.each([
    ["Evcil hayvan kabul ediliyor. Bir şeye ihtiyacınız olursa ev sahibinize haber vermeniz yeterli.", "Evcil hayvan kabul ediliyor."],
    ["Pets are welcome. If you need anything, just let your host know beforehand.", "Pets are welcome."],
  ])("genel ihtiyaç kapanışı ön koşul değil: %j", (reply, sent) => {
    const a = analyzeHostContact(reply);
    expect(a.nothingLeft).toBe(false);
    expect(a.text).toBe(sent);
  });

  // V4-F10: güvenlik cümlesinde yazma yan cümlesinden SONRA adım varsa temiz kesilemez — tahliye adımı sessizce düşmesin, tamamı tutulur.
  it.each([
    "If you smell gas, call 112, message your host and leave the apartment.",
    "If the smoke alarm goes off, call your host, text them a photo and then open the windows.",
    "Gaz kokusu alırsanız 112'yi arayın, ev sahibinize yazın ve daireden çıkın.",
  ])("yazmadan sonra güvenlik adımı → tamamı tutulur: %j", (reply) => {
    expect(analyzeHostContact(reply).nothingLeft).toBe(true);
  });
});

describe("v4 — göndergesel işaret büyük Türkçe İ ile de okunur (V4-F16)", () => {
  it.each([
    "Binada sauna var. İlgili bir sorunuz olursa ev sahibinize yazabilirsiniz.",
    "Binada sauna var. İLGİLİ BİR SORUNUZ OLURSA EV SAHİBİNİZE YAZIN.",
  ])("%j → göndergesel (genel kapanış değil): kalan bilgi gider, kayıt isteğe bağlı kalır", (reply) => {
    // Kurucu 10-30: göndergesel silme artık cevabı tutmaz; büyük İ okuması kaydın türünde görünür (genel kapanış isteği kapatmazdı).
    const a = analyzeHostContact(reply);
    expect(a.nothingLeft).toBe(false);
    expect(a.text).toBe("Binada sauna var.");
    expect(a.removals.map((r) => r.generic)).toEqual([false]);
  });
});

describe("v4 — önceki cümlenin işletmesi 'the owner'ı işletme sahibi yapar (V4-F17)", () => {
  it("fırın cümlesinden sonra 'Ask the owner' ev sahibine yönlendirme değildir", () => {
    const reply = "There's a great bakery on the corner. Ask the owner for the pistachio simit, it's fresh every morning.";
    const a = analyzeHostContact(reply);
    expect(a.removals).toHaveLength(0);
    expect(a.text).toBe(reply);
  });
});

describe("v4 — Türkçe ekli acil numara güvenlik talimatıdır (V4-F18)", () => {
  it.each(["112'yi arayın.", "Böyle bir şey olursa 112'ye ulaşın.", "155'i arayın."])("%j güvenlik talimatı", (s) => {
    expect(isSafetyWarningSentence(s)).toBe(true);
  });
  it("ekli acil numara + yazma: arama kalır, yazma silinir", () => {
    const a = analyzeHostContact("Wi-Fi şifresi Lale1234. Bir şey olursa 112'yi arayın ya da ev sahibinize yazın.");
    expect(a.nothingLeft).toBe(false);
    expect(a.text).toContain("112'yi arayın");
    expect(a.text).not.toContain("ev sahibinize");
  });
});

describe("v4 — kip + 'also / then' cihaz anlatımıdır, misafire talimat değil (V4-A2)", () => {
  it.each([
    "The smart lock will also notify your host when you check in.",
    "The door sensor will then alert your host automatically.",
    "This will also inform your host.",
  ])("dokunulmaz: %j", (s) => {
    expect(hostContactKindOf(s)).toBeNull();
  });
});

describe("v4 — işletme / akraba anılan cümlede zamir işletmeye gönderir (V4-A5)", () => {
  it.each([
    "Your host recommends Lale Taxi, just call them to book.",
    "Your host suggests the bakery downstairs; ask them for fresh simit.",
    "Your host's friend runs the cafe, just message him for a table.",
    "Ev sahibiniz Lale Taksi'yi öneriyor, onları arayabilirsiniz.",
  ])("ev sahibine yönlendirme değil: %j", (s) => {
    expect(hostContactKindOf(s)).toBeNull();
  });
});
