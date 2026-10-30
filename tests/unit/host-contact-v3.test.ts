import { describe, it, expect } from "vitest";
import { analyzeHostContact } from "@/lib/ai/host-contact-filler";
import { hostContactKindOf } from "@/lib/ai/absence";
import { settleHostContactRemovals } from "@/lib/conversation-items/host-contact-settle";
import { needTerms } from "@/lib/conversation-items/topic-absence";
import { topicsWithSymptomsOf } from "@/lib/conversation-items/relation";
import { asksHypotheticalSituation, mentionsHostContact, refersGuestToHost } from "@/lib/ai/absence";

// ---------------------------------------------------------------------------
// K-1029-A v3 (10-30) — v2'nin çekişmeli incelemesi (4 mercek: aklama, aşırı uygulama, güvenlik + bağlantı, maliyet): bulucu ajanların
// probla doğruladığı girdiler, v3'ün beklediği çıktıyla. `null` = cevabın TAMAMI tutulur; "ANY_SENT" = bir kısmı gider (biçim serbest).
// Kırmızı-önce: v2 (d1c15f16) bu tabloda çoğunu kaçırıyordu (ölçüm `docs/INCELEME-2026-10-28-gece-dongusu.md` v3 bölümü).
// ---------------------------------------------------------------------------

const W = "Wi-Fi şifresi Lale1234.";
const WE = "The Wi-Fi password is Lale1234.";
type Case = [string, string, string | null | "ANY_SENT"];
const CASES: Case[] = [
  // launder-01 / sw-01: adım başvurmadan sonra
  ["L01a", "The stove runs on gas: turn the knob and press to ignite. If you smell gas, message your host and leave the apartment immediately.", null],
  ["L01b", "The boiler is in the kitchen. If the carbon monoxide alarm goes off, message your host and get everyone outside.", null],
  ["L01c", "La cuisinière fonctionne au gaz. En cas d'odeur de gaz, écrivez à votre hôte et quittez immédiatement l'appartement.", null],
  ["L01d", "Плита газовая. Если почувствуете запах газа, напишите хозяину и сразу покиньте квартиру.", null],
  ["SW01", "The stove is in the kitchen. If you smell gas leave the flat and message your host.", "The stove is in the kitchen. If you smell gas leave the flat."],
  // launder-02: göndergesel koşullu
  ["L02a", "We do have a sauna in the building. If you have any questions about it, please message your host.", null],
  ["L02b", "We do have a sauna in the building. Feel free to message your host about the opening times.", null],
  ["L02c", "Binada sauna var. Bu konuda bir sorunuz olursa ev sahibinize yazabilirsiniz.", null],
  ["L02d", "Binada sauna var. Saatleriyle ilgili bir sorunuz olursa ev sahibinize yazabilirsiniz.", null],
  ["L02e", "Extra towels are available. If you need them, just message your host.", null],
  // launder-03: etiketler / başlıklar
  ["L03a", `${WE} Speaking of the sauna, if you need anything, message your host.`, WE],
  ["L03b", `${WE} When it comes to parking, if you have any questions, message your host.`, WE],
  ["L03c", `${WE} Regarding the parking garage next to the building, if you have questions, please message your host.`, WE],
  ["L03d", `${WE} Regarding the 15:00 check-in, if anything comes up, message your host.`, WE],
  ["L03e", `${W} Otoparka gelince, bir sorun olursa ev sahibinize yazın.`, W],
  ["L03f", `${WE} Was die Sauna betrifft, bei Fragen schreiben Sie bitte Ihrem Gastgeber.`, WE],
  ["L03g", `${WE} Что касается парковки, если возникнут вопросы, напишите хозяину.`, WE],
  ["L03h", `${WE}\n\n**Parking**\nIf you have questions, please message your host.`, WE],
  ["L03i", `${WE}\n\nParking\n- If anything comes up, message your host.`, WE],
  // launder-04 / 05: yetersizlik / tahmin
  ["L04a", "Unfortunately, I can't help with the airport transfer. Please contact your host.", null],
  ["L04b", "I can't check availability from here. Please message your host.", null],
  ["L04c", `${WE} The sauna opening hours aren't listed. Please message your host.`, null],
  ["L04d", `${WE} The host hasn't mentioned the sauna hours. Please message your host.`, null],
  ["L04e", "Maalesef havalimanı transferi konusunda yardımcı olamıyorum. Ev sahibinize yazabilirsiniz.", null],
  ["L04f", `${W} Sauna saatlerini bulamadım. Ev sahibinize sorabilirsiniz.`, null],
  ["L04g", `${W} Ev sahibiniz sauna saatlerini belirtmemiş. Ev sahibinize sorabilirsiniz.`, null],
  ["L04h", "Leider kann ich Ihnen dabei nicht helfen. Bitte schreiben Sie Ihrem Gastgeber.", null],
  ["L05a", "I believe the sauna is open until 22:00. Please confirm with your host.", null],
  ["L05b", `${WE} The sauna is probably open until 22:00. Please check with your host to confirm.`, null],
  ["L05c", "Sanırım sauna 22:00'ye kadar açık. Ev sahibinize teyit edebilirsiniz.", null],
  ["L05d", `${W} Otopark muhtemelen ücretsizdir. Ev sahibinize sorabilirsiniz.`, null],
  ["L05e", "Парковка, скорее всего, бесплатная. Напишите хозяину, чтобы уточнить.", null],
  // launder-06: only if
  ["L06a", "A baby cot can be provided, but only if you message your host in advance.", null],
  ["L06b", "Sie können die Sauna kostenlos nutzen, aber nur wenn Sie Ihrem Gastgeber vorher schreiben.", null],
  ["L06c", "Saunayı ücretsiz kullanabilirsiniz, ancak ev sahibinize bir gün önceden yazarsanız.", null],
  // launder-07: belirsiz gönderge
  ["L07", "We do have a sauna in the building. The Wi-Fi password is Lale1234. Please message your host for more details.", null],
  // launder-08: dedektör
  ["L08a", `${WE} Your host Mehmet lives nearby. If anything comes up, just message him.`, `${WE} Your host Mehmet lives nearby.`],
  ["L08b", `${W} Ev sahibinize yazarsanız hemen ilgilenir.`, W],
  // launder-09: öksüz özne cümlesi
  ["L09a", `${WE} If anything breaks, message your host. He can send a technician the same day.`, "ANY_SENT"],
  // launder-10: artık
  ["L10a", `${WE}\n\nIf the Wi-Fi stops working:\n- Message your host.`, WE],
  ["L10b", "Check-in steps:\n1. Get the key from the lockbox (code 4321).\n2. Message your host when you're inside.\n3. Enjoy your stay!", "Check-in steps:\n1. Get the key from the lockbox (code 4321).\n3. Enjoy your stay!"],
  ["L10c", `${WE}\n\nP.S. If anything breaks, message your host.`, WE],
  ["L10d", `${WE} 😊 If anything breaks, message your host! 🙏`, WE],
  // launder-11: yalnız nezaket
  ["L11a", "Thanks for reaching out! For the sauna, please message your host.", null],
  ["L11b", "I understand. Please message your host about the sauna.", null],
  ["L11c", "Mesajınızı aldım. Sauna için ev sahibinize yazabilirsiniz.", null],
  ["L11d", "Vielen Dank für Ihre Nachricht! Zur Sauna fragen Sie bitte Ihren Gastgeber. Ich wünsche Ihnen einen schönen Urlaub!", null],
  // launder-12: fatura / tüp
  ["L12a", `${WE} If the gas bill is too high, contact your host.`, WE],
  ["L12b", `${WE} The fire extinguisher is under the sink; if you can't find it, contact your host.`, `${WE} The fire extinguisher is under the sink.`],
  // overhold-1 / sw-03: sarkan koşul
  ["O01a", "If the smoke alarm beeps while cooking, open the window, and if it keeps beeping, let your host know.", "If the smoke alarm beeps while cooking, open the window."],
  ["O01b", "Ocak doğalgazlı. Gaz kokusu alırsanız pencereleri açın ve koku devam ederse, ev sahibinize yazın.", "Ocak doğalgazlı. Gaz kokusu alırsanız pencereleri açın."],
  ["SW03a", "Check-in is at 15:00. The fire extinguisher is under the sink; if anything breaks, message your host.", "Check-in is at 15:00. The fire extinguisher is under the sink."],
  ["SW03b", "Плита на кухне. Если увидите дым, напишите хозяину.", "Плита на кухне."],
  ["SW03c", "Der Herd ist in der Küche. Sollten Sie Gas riechen, schreiben Sie Ihrem Gastgeber.", "Der Herd ist in der Küche."],
  // overhold-2 / sw-02: su / elektrik
  ["O02a", "Towels are in the closet. If an outlet sparks, switch off the breaker in the fuse box by the door and message your host.", "Towels are in the closet. If an outlet sparks, switch off the breaker in the fuse box by the door."],
  ["O02b", "The washing machine is in the bathroom. If water leaks from it, turn off the main valve under the sink and message your host.", "The washing machine is in the bathroom. If water leaks from it, turn off the main valve under the sink."],
  ["O02c", "Çamaşır makinesi banyoda. Su kaçırırsa ana vanayı kapatın ve ev sahibinize yazın.", "ANY_SENT"],
  // overhold-3: sözcük sınırı
  ["O03a", "N'appuyez pas sur le bouton rouge, c'est l'alarme. En cas de problème, écrivez à votre hôte.", "N'appuyez pas sur le bouton rouge, c'est l'alarme."],
  ["O03b", "El desayuno no se sirve los domingos. Si tiene algún problema, escriba a su anfitrión.", "El desayuno no se sirve los domingos."],
  ["O03c", "Daire kablolu internet değil, Wi-Fi ile bağlanıyorsunuz; şifre Lale1234. Bir sorun olursa ev sahibinize yazın.", "Daire kablolu internet değil, Wi-Fi ile bağlanıyorsunuz; şifre Lale1234."],
  ["O03d", "المفاتيح أسفل السجادة عند الباب. إذا واجهت أي مشكلة، تواصل مع المضيف.", "المفاتيح أسفل السجادة عند الباب."],
  ["O03e", "Hangi düğme olduğundan emin değilseniz mavi olana basın. Bir sorun olursa ev sahibinize yazın.", "Hangi düğme olduğundan emin değilseniz mavi olana basın."],
  ["O03f", "Aksi belirtilmemişse giriş saati 15:00'tir. Bir sorun olursa ev sahibinize yazın.", "Aksi belirtilmemişse giriş saati 15:00'tir."],
  ["O03g", "If you don't know where to park, there is a free lot behind the building. If anything comes up, message your host.", "If you don't know where to park, there is a free lot behind the building."],
  // overhold-4: Almanca adlar / evet
  ["O04a", "Der Schlüssel ist im Briefkasten. Bei Fragen schreiben Sie bitte Ihrem Gastgeber.", "Der Schlüssel ist im Briefkasten."],
  ["O04b", "Yes, of course! If anything comes up, message your host.", "Yes, of course!"],
  // overhold-5: olumsuz iletişim
  ["O05a", "Check-in is at 15:00. There's no need to tell your host when you arrive; the lockbox code is 4821.", "Check-in is at 15:00. There's no need to tell your host when you arrive; the lockbox code is 4821."],
  // overhold-6: fiilli edat baş kısmı
  ["O06a", "For parking use spot B, and if anything goes wrong, message your host.", "For parking use spot B."],
  ["O06b", "Zur Sauna gehen Sie geradeaus, bei Fragen schreiben Sie Ihrem Gastgeber.", "Zur Sauna gehen Sie geradeaus."],
  // overhold-7: selam + kısa cevap
  ["O07a", "Merhaba, havuz kapalı. Bir sorun olursa ev sahibinize yazın.", "Merhaba, havuz kapalı."],
  ["O07b", "Hi, parking is free! If anything comes up, message your host.", "Hi, parking is free!"],
  // overhold-8: davet
  ["O08a", "If you'd like to use the bikes, don't hesitate! They are in the garage.", "If you'd like to use the bikes, don't hesitate! They are in the garage."],
  // sw-04: ilgisiz tehlike sözcüğü "arayın"ı korumaz
  ["SW04a", `${WE} Smoke detectors are in every room; if the Wi-Fi stops working, call your host.`, `${WE} Smoke detectors are in every room.`],
  ["SW04b", "Electricity, water and gas are included in the price; if anything stops working, call your host.", "Electricity, water and gas are included in the price."],
  ["SW04c", "Check-in is at 15:00. The police station is two streets away; if you lose the key, call your host.", "Check-in is at 15:00. The police station is two streets away."],
  // sw-05: güvenlik cümlesinde "ask / contact" kalmaz
  ["SW05a", "The stove is in the kitchen. If the smoke alarm goes off, open the window and ask your host to check it.", "The stove is in the kitchen. If the smoke alarm goes off, open the window."],
  ["SW05b", "Ocak mutfakta. Gaz kokusu alırsanız pencereleri açın ve ev sahibinizle iletişime geçin.", "Ocak mutfakta. Gaz kokusu alırsanız pencereleri açın."],
  // sw-06: bildirim kalan metinde
  ["SW06a", `${W} Ev sahibiniz de bu yazışmayı görüyor, bir sorun olursa ev sahibinize yazın.`, null],
  ["SW06b", `${WE} Your host can see the conversation, so feel free to message your host if anything comes up.`, null],
  ["SW06c", `${WE} If the Wi-Fi stops working, message your host. Your host can also see this conversation.`, null],
  // KONTROL — kurucu kuralları
  ["K1", "Gaz kokusu alırsanız 112'yi arayın ve ev sahibinize ulaşın.", "Gaz kokusu alırsanız 112'yi arayın ve ev sahibinize ulaşın."],
  ["K2", "If you smell gas, open the windows and call your host.", "If you smell gas, open the windows and call your host."],
  ["K3", `${W} Herhangi bir sorunda ev sahibinize yazın.`, W],
  ["K4", "Merhaba Alex, Size ayrılan otopark yeri P2. Yakınlarda kuaför bilgisi elimde olmadığı için bu konuda ev sahibiniz size kesin bilgi verebilir.", "Merhaba Alex, Size ayrılan otopark yeri P2."],
  ["K5", `${WE}\nIf the Wi-Fi fails, message\nyour host.`, WE],
  ["K6", "Giriş 15:00'te. Varınca ev sahibinizi arayın.", "Giriş 15:00'te."],
];

describe("v3 — inceleme bulguları", () => {
  it.each(CASES)("%s", (_id, reply, expected) => {
    const a = analyzeHostContact(reply);
    const got = a.nothingLeft ? null : a.text;
    if (expected === "ANY_SENT") expect(got).not.toBeNull();
    else expect(got).toBe(expected);
  });

  it("güvenlik adımı temiz ayrılamadığı için tutulan cevabın taslağı BOŞ (adımsız metin tek tıkla gitmesin — safety-wiring-07)", () => {
    const a = analyzeHostContact("The stove is in the kitchen. If you smell gas, message your host and leave the apartment immediately.");
    expect(a.nothingLeft).toBe(true);
    expect(a.draft).toBe("");
  });

  it("konu etiketli kapanış o konunun isteğini açar (launder-03)", () => {
    const need = (ref: string, q: string[]) => ({ ref, topics: topicsWithSymptomsOf(q.join(" ")), terms: needTerms(q), contingency: q.some((x) => asksHypotheticalSituation(x)) });
    const a = analyzeHostContact(`${WE} Speaking of the sauna, if you need anything, message your host.`);
    const s = settleHostContactRemovals({ removals: a.removals, keptText: a.text, needs: [need("R1", ["wifi password"]), need("R2", ["is there a sauna"])], declared: { refs: ["R1", "R2"] } });
    expect(s.refs).toEqual(["R1"]);
  });
});

describe("v3 — dedektör: yeni yakalananlar ve aşırı uygulama yok", () => {
  const POS = [
  "Wi-Fi şifresi Lale1234. Ev sahibinize yazarsanız hemen ilgilenir.", "Ev sahibinizi ararsanız hemen gelir.",
  "Если напишете хозяину, он ответит.", "Your host can be reached via the Airbnb app.",
  "If anything comes up, feel free to message your host.", "Bir sorun olursa ev sahibinize sorun.", "Ev sahibinize sorun ve kendisi yardımcı olur.",
  "Düzelmezse yeniden yazın.", "If you need anything, don't hesitate!", "Bei Fragen können Sie Ihren Gastgeber kontaktieren.",
  "Si necesita algo, puede contactar a su anfitrión.", "إذا احتجت أي شيء، أرسل رسالة إلى المضيف.", "Let me know if you need anything else.",
  "If you need anything, just reach out.", "Ev sahibinize ulaşılabilir.",
];
  const NEG = [
  "There's no need to tell your host, the cleaner already knows.", "You don't need to alert the host, the cleaner comes at 11:00 anyway.",
  "Sie müssen dem Gastgeber nicht Bescheid geben, der Schlüssel liegt im Briefkasten.", "Sie müssen Ihren Gastgeber nicht kontaktieren, wenn Sie gehen; legen Sie den Schlüssel einfach auf den Tisch.",
  "No hace falta avisar al anfitrión, la llave está en el buzón.", "Herhangi bir sorun yoksa çıkışta bizi aramanıza gerek yok, anahtarı masaya bırakmanız yeterli.",
  "The door sensor will alert the host if the door is left open.", "Die Reinigungskraft wird den Gastgeber informieren, sobald die Wohnung fertig ist.",
  "El sistema va a avisar al anfitrión automáticamente cuando llegue.", "The host can reach out if there are any changes to your booking.",
  "أرسل صاحب الشقة رمز الباب في رسالة سابقة.", "Your host has arranged a taxi for you; the driver will wait at arrivals, just call him when you land.",
  "Your host's parents live downstairs and keep a spare key, so if you ever get locked out, just ask them.", "Your host's cleaner Ayşe comes on Tuesdays; if you need fresh towels, just tell her.",
  "Ev sahibinizin annesi alt katta oturuyor ve yedek anahtar onda; anahtarı unutursanız ona sorun.", "Ihr Gastgeber hat einen Hausmeister im Erdgeschoss, bei Problemen mit der Heizung rufen Sie ihn an.",
  "Bize bildirdiğiniz sorun çözüldü, teknisyen kombiyi tamir etti.", "Ev sahibinizin bahsettiği sorun yarın giderilecek.", "Kodu girerken bir sorun olursa kodu tekrar yazın ve # tuşuna basın.",
  "If you can, let me know your arrival time so I can prepare the apartment.", "If possible, send us a photo of your ID before arrival.", "Wenn möglich, schreiben Sie uns Ihre Ankunftszeit.",
  "If you'd like to use the bikes, don't hesitate! They are in the garage.", "Si vous voulez profiter de la piscine, n'hésitez pas ! Elle est ouverte de 9h à 20h.",
  "Your host will reach out to you before arrival.", "Ev sahibiniz sizi arayacak.",
];
  it.each(POS)("yakalanır: %j", (s) => {
    expect(hostContactKindOf(s)).not.toBeNull();
  });
  it.each(NEG)("dokunulmaz: %j", (s) => {
    expect(hostContactKindOf(s)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// v3 kapsam turu (10-30, çekişmeli incelemenin "kapsam + maliyet" merceği cost-coverage-01…08): yedi dilde gündelik yönlendirme biçimleri
// ("ev sahibinizle iletişim kurabilirsiniz", "coordinate / arrange … with your host", "feel free to ask", "Kontakt aufnehmen", "je vous
// conseille de contacter", "ponerse en contacto con", "Сообщите об этом хозяину", "يرجى إبلاغ المضيف") — inceleme bunların HEPSİNİN
// misafire gittiğini ve konulu olanlarda isteğin sessizce "cevaplandı" kapandığını probla gösterdi. Bilerek dışarıda: "zur Verfügung
// stehen / a su disposición" (talimat değil "buradayız" — sabah sorusu 5).
// ---------------------------------------------------------------------------
describe("v3 kapsam turu — yedi dilde yeni biçimler", () => {
  const POS = [
    // Tekrar oynatmanın yakaladığı gerileme: ev sahibi öznesiyle "size bildirebilir" bilgi yönlendirmesidir.
    "Havluların yerini ev sahibiniz size bildirebilir.", "Anahtar kutusu koduyla ilgili güncel durumu ev sahibiniz size kesin olarak bildirebilir.",
    "Ev sahibiniz size söyleyebilir.", "Bunu ev sahibiniz açıklayabilir.",
    "If you have any other questions, feel free to ask!", "If you need anything else, just ask.", "Feel free to ask if you need anything else.",
    "Don't hesitate to get in touch.", "If you need anything, get in touch.", "If you need anything else, don't hesitate to ask.",
    "Please coordinate with your host.", "Please follow up with your host.", "Please raise this with your host.",
    "Please bring this up with your host.", "Please direct this question to your host.", "Please report it to your host.",
    "Please mention it to your host.", "Please flag this to your host.", "Please arrange early check-in directly with your host.",
    "Please leave a message for your host.", "Drop your host a message.", "Shoot your host a message.", "Have a word with your host.",
    "Your host can be reached through the Airbnb app.", "Your host is your best point of contact for this.", "Please contact the homeowner.",
    "I'd suggest reaching out to your host.", "You might want to reach out to your host.", "It's best to ask your host directly.",
    "Please message your host on Airbnb.", "If anything comes up, send us a message.",
    "If you need anything, we're happy to help — just send a message.", "Başka sorunuz olursa sormaktan çekinmeyin.",
    "Başka bir sorunuz olursa çekinmeden sorabilirsiniz.", "Herhangi bir sorunuz olursa bize sorabilirsiniz.",
    "Bir ihtiyacınız olursa bize ulaşmaktan çekinmeyin.", "Ev sahibinizle iletişim kurabilirsiniz.", "Bu konuda ev sahibinizle iletişim kurun.",
    "Ev sahibinizle irtibat kurabilirsiniz.", "Ev sahibinizle temasa geçebilirsiniz.", "Ev sahibinize e-posta gönderebilirsiniz.",
    "Ev sahibinize telefon açabilirsiniz.", "Ev sahibinize telefon edebilirsiniz.", "Ev sahibinizle koordine edebilirsiniz.",
    "Ev sahibinizle yazışabilirsiniz.", "Erken giriş için ev sahibinizle ayarlayabilirsiniz.", "Ev sahibinize bildirmeniz yeterli.",
    "Lütfen ev sahibinizi bilgilendirin.", "Ev sahibine Airbnb üzerinden mesaj atmanız yeterli.", "Ev sahibinize iletmeniz yeterli olacaktır.",
    "Sorun olursa bize bildirin.", "Herhangi bir sorunda bizi bilgilendirin.", "Bitte nehmen Sie Kontakt mit Ihrem Gastgeber auf.",
    "Sie können mit Ihrem Gastgeber Kontakt aufnehmen.", "Treten Sie bitte mit Ihrem Gastgeber in Kontakt.",
    "Teilen Sie das bitte Ihrem Gastgeber mit.", "Bitte melden Sie dies Ihrem Gastgeber.", "Kontaktieren Sie bei Problemen Ihren Gastgeber.",
    "Kontaktieren Sie dazu bitte Ihren Gastgeber.", "Am besten kontaktieren Sie Ihren Gastgeber.", "Fragen Sie am besten Ihren Gastgeber.",
    "Ihr Gastgeber hilft Ihnen gerne weiter.", "Sie erreichen Ihren Gastgeber über die Airbnb-App.",
    "Bei Fragen können Sie sich gerne an uns wenden.", "Wenden Sie sich bei Fragen gerne an uns.", "Bei Fragen schreiben Sie uns einfach.",
    "Je vous conseille de contacter votre hôte.", "Je vous recommande de contacter votre hôte.", "Le mieux est de contacter votre hôte.",
    "Prenez contact avec votre hôte.", "Il faudra voir avec votre hôte.", "Merci de prévenir votre hôte.",
    "Vous pouvez envoyer un message à votre hôte.", "Mieux vaut écrire à votre hôte.", "Contactez directement votre hôte via l'application.",
    "Si vous avez d'autres questions, n'hésitez pas à me contacter.", "Si vous avez des questions, n'hésitez pas à nous écrire.",
    "Pour toute question, n'hésitez pas à demander.", "Le recomiendo ponerse en contacto con su anfitrión.",
    "Le sugiero que se ponga en contacto con su anfitrión.", "Lo mejor es consultar con su anfitrión.", "Por favor, informe a su anfitrión.",
    "Puede enviarle un mensaje a su anfitrión.", "Le recomiendo escribirle a su anfitrión.", "Te recomiendo que le escribas a tu anfitrión.",
    "Si tiene alguna pregunta, no dude en preguntar.", "Si necesita algo, no dude en contactarnos.", "Сообщите об этом хозяину.",
    "Напишите об этом хозяину.", "Задайте этот вопрос хозяину.", "Можно написать хозяину в приложении.", "Если что-то понадобится, дайте знать.",
    "Если возникнут вопросы, не стесняйтесь писать.", "Если возникнут вопросы, обращайтесь в любое время.", "Если будут вопросы, смело пишите.",
    "Если будут вопросы, напишите нам.", "Рекомендую написать хозяину.", "Свяжитесь с собственником квартиры.", "يرجى إبلاغ المضيف.",
    "يرجى إخبار المضيف.", "اسأل المضيف.", "يمكنك سؤال المضيف.", "يرجى التواصل مع المضيف.", "اتصل بالمضيف.",
    "إذا احتجت أي شيء، لا تتردد في التواصل معنا.", "إذا كان لديك أي سؤال، لا تتردد في سؤالي.", "إذا احتجت أي شيء، أرسل لنا رسالة.",
    "Başka sorunuz varsa yazabilirsiniz.", "Sorunuz varsa yazın.", "Aklınıza takılan bir şey olursa sorabilirsiniz.",
    "Başka bir şeye ihtiyacınız olursa sormanız yeterli.", "Ev sahibinizle iletişim kurmanızı öneririm.",
    "Erken giriş için ev sahibinizle iletişim kurabilirsiniz.", "Ev sahibinize WhatsApp'tan ulaşabilirsiniz.",
    "Ev sahibinizle iletişime geçmenizi öneririm.", "Lütfen ev sahibinizle irtibata geçin.", "Let me know if you need anything else!",
    "If there's anything else, just let me know.", "Please check with your host about early check-in.",
    "For early check-in, please coordinate directly with your host.", "You can arrange a late checkout with your host.",
    "Please report any damage to your host as soon as possible.", "If you need anything else during your stay, feel free to ask.",
    "Should you have any other questions, please don't hesitate to ask.",
    "Für einen früheren Check-in nehmen Sie bitte Kontakt mit Ihrem Gastgeber auf.", "Bei weiteren Fragen können Sie sich jederzeit an uns wenden.",
    "Falls Sie noch Fragen haben, wenden Sie sich gerne an uns.", "Pour un départ tardif, je vous conseille de contacter votre hôte.",
    "Si vous avez d'autres questions, n'hésitez pas à me les poser.",
    "Para la llegada anticipada, le recomiendo ponerse en contacto con su anfitrión.", "Si tiene más preguntas, no dude en consultarnos.",
    "Si tiene más preguntas, no dude en preguntarme.", "Если будут вопросы, не стесняйтесь обращаться.",
    "По поводу раннего заезда лучше сообщить хозяину заранее.", "Сообщите, пожалуйста, об этом хозяину.",
    "إذا كان لديك أي أسئلة، لا تتردد في سؤالنا.", "يرجى إبلاغ المضيف بأي ضرر.", "If you need anything, send us a message.",
    "If anything comes up, send me a message.", "If you need anything else, send us a text.", "If you have any questions, send me an email.",
    "If anything comes up, let us know the details.",
  ];
  const NEG = [
    "I'll mention it to your host.", "We're happy to arrange this with your host.", "I will report it to your host right away.",
    "We have already discussed this with your host.", "The cleaner will report any damage to the host.", "Signs direct guests to the host's office.",
    "Feel free to ask the concierge for a map.", "Just ask for the key at reception.", "Feel free to ask for extra blankets at the front desk.",
    "If you can, let me know your arrival time.", "Please send us your ID before arrival.", "If you need parking, send us your car plate number.",
    "Get in touch with nature on the hiking trails.", "Send a message to the building app to open the gate.",
    "Your host is not reachable at night, so please plan ahead.", "Your host arranged a taxi for you.",
    "The host mentioned that the pool opens at 9.", "Don't hesitate to use the pool.", "Bring your own towels to the beach.",
    "Report to the reception on arrival.", "Your host's office is on the ground floor.",
    "Ev sahibinize ait klimayı istediğiniz gibi ayarlayabilirsiniz.", "Ev sahibiniz sizi bilgilendirecek.",
    "Ev sahibinizle iletişim kurmanıza gerek yok.", "Rezervasyon numaranız varsa yazın.", "Bize varış saatinizi yazın.",
    "Ev sahibinizin ayarladığı saat 15:00.", "Kodu tekrar yazın.", "Klimayı 22 dereceye ayarlayabilirsiniz.",
    "Ev sahibimizle anlaştık, erken giriş mümkün.", "Herhangi bir sorunda kombinin reset tuşuna basın.", "Telefon şarj aleti çekmecede.",
    "E-posta adresinize fatura gönderildi.", "Ev sahibiniz size haber verecek.", "Ev sahibiniz sizi arayıp bilgilendirecek.",
    "Ev sahibiniz durumu bize bildirdi.", "Ev sahibiniz sizinle iletişim kuracak.", "Nehmen Sie den Schlüssel von Ihrem Gastgeber entgegen.",
    "Teilen Sie das Bad mit Ihrem Gastgeber nicht.", "Melden Sie sich an der Rezeption.", "Kontaktieren Sie im Notfall den Hausmeister.",
    "Fragen Sie nach dem Weg, der Gastgeber wohnt oben.", "Der Gastgeber wird Sie kontaktieren.", "Bitte melden Sie sich an.",
    "Ihr Gastgeber ist nicht erreichbar.", "Schreiben Sie den Code auf.", "Bei Fragen finden Sie alles im Gästebuch.",
    "Kontaktieren Sie nicht den Gastgeber, die Rezeption hilft.", "N'hésitez pas à profiter de la piscine.",
    "N'hésitez pas à demander un lit bébé à la réception.", "Votre hôte vous contactera.", "Je vous conseille de visiter le vieux port.",
    "Merci de laisser les clés sur la table.", "Vous pouvez contacter la réception.", "Le recomiendo visitar el mercado.",
    "Su anfitrión le contactará.", "No dude en usar la piscina.", "Puede consultar el horario en la recepción.",
    "No dude en preguntar por la piscina en recepción.", "Хозяин вам напишет.", "Напишите номер квартиры хозяина в форме.",
    "Если что-то понадобится, магазин рядом.", "Сообщите нам ваше время прибытия.", "Лучше сообщить на ресепшен.", "أجب على سؤال المضيف.",
    "إذا واجهت أي مشكلة، المفتاح الاحتياطي في الدرج.", "سأل المضيف عن موعد وصولك.",
  ];
  it.each(POS)("yakalanır: %j", (s) => {
    expect(hostContactKindOf(s)).not.toBeNull();
  });
  it.each(NEG)("dokunulmaz: %j", (s) => {
    expect(hostContactKindOf(s)).toBeNull();
  });
  // Mutasyon A1 (yaşadı): nesne aralıklı iş fiili kalıbı üçüncü kişi öznesinde susar — kip "can" süzgecin kip listesinde yok, yalnız üçüncü
  // kişi denetimi durdurur.
  it.each(["Our cleaner can report any damage to the host directly.", "The driver can arrange a stop with the host on the way."])(
    "üçüncü kişi öznesi: %j",
    (s) => {
      expect(hostContactKindOf(s)).toBeNull();
    },
  );

  // Mutasyon A19 / A20 (yaşadı — iki dedektör birbirini örtüyordu): her biri yalnız kendisinin yakaladığı biçimle pinli.
  it("ev sahibinin kendi sesi 'bizimle iletişim kurun / temasa geçin' yalnız başvurma dedektöründe (A19)", () => {
    expect(mentionsHostContact("Herhangi bir sorunda bizimle iletişim kurabilirsiniz.")).toBe("write");
    expect(mentionsHostContact("Bir sıkıntı olursa bizimle temasa geçin.")).toBe("write");
  });
  it("'iletişim kurabilirsiniz' bilgi yönlendirmesidir — 'bilgim yok' ağı da görür; site yöneticisi yalnız orada (A20)", () => {
    expect(refersGuestToHost("Ev sahibinizle iletişim kurabilirsiniz.")).toBe(true);
    expect(refersGuestToHost("Ev sahibinizle temasa geçebilirsiniz.")).toBe(true);
    expect(hostContactKindOf("Otopark için site yöneticisiyle iletişim kurabilirsiniz.")).toBe("referral");
  });

  const need = (ref: string, q: string[]) => ({ ref, topics: topicsWithSymptomsOf(q.join(" ")), terms: needTerms(q), contingency: q.some((x) => asksHypotheticalSituation(x)) });
  it.each([
    ["Wi-Fi şifresi Lale1234. Erken giriş için ev sahibinizle iletişim kurabilirsiniz.", "Wi-Fi şifresi nedir?", "Erken giriş yapabilir miyiz?"],
    ["The Wi-Fi password is Lale1234. For early check-in, please coordinate directly with your host.", "What is the Wi-Fi password?", "Can we check in early?"],
    ["Das WLAN-Passwort lautet Lale1234. Für einen früheren Check-in nehmen Sie bitte Kontakt mit Ihrem Gastgeber auf.", "Wie lautet das WLAN-Passwort?", "Können wir früher einchecken?"],
    ["Le mot de passe Wi-Fi est Lale1234. Pour un départ tardif, je vous conseille de contacter votre hôte.", "Quel est le mot de passe Wi-Fi ?", "Peut-on partir plus tard ?"],
    ["La contraseña del Wi-Fi es Lale1234. Para la llegada anticipada, le recomiendo ponerse en contacto con su anfitrión.", "¿Cuál es la contraseña del Wi-Fi?", "¿Podemos llegar antes?"],
    ["Пароль от Wi-Fi: Lale1234. По поводу раннего заезда лучше сообщить хозяину заранее.", "Какой пароль от Wi-Fi?", "Можно ли заехать пораньше?"],
  ])("konulu yönlendirme silinir, cevaplanan gider, öteki istek AÇIK kalır: %j", (reply, q1, q2) => {
    const a = analyzeHostContact(reply);
    expect(a.nothingLeft).toBe(false);
    expect(a.text).toContain("Lale1234");
    expect(a.removals.length).toBeGreaterThan(0);
    const s = settleHostContactRemovals({ removals: a.removals, keptText: a.text, needs: [need("U1", [q1]), need("U2", [q2])], declared: { refs: ["U1", "U2"] } });
    // Erken giriş / geç çıkış hiçbir dilde sessizce "cevaplandı" kapanmaz. (İspanyolcada silinen cümlenin "con" sözcüğü gevşek eşleşmeyle
    // Wi-Fi isteğine de bağlanıp onu da açık bırakabiliyor — güvenli yön, belgede bilinen fazla açma.)
    expect(s.refs).not.toContain("U2");
  });

  it("genel ihtiyaç koşullu 'let us know the details / when' kapanıştır, kendi bilgisini isteyen 'let me know your arrival time' değildir (cost-coverage-08)", () => {
    // Cümle hiçbir yolda misafire gitmez: ya silinir (kalan gider) ya cevabın tamamı tutulur ("details" göndergesel sayılıp tutar — bilinen
    // fazla tutuş, güvenli yön).
    for (const x of ["If anything comes up, let us know the details.", "If you need anything, let us know when.", "If you have any problems, tell us what happened."]) {
      const a = analyzeHostContact(`${WE} ${x}`);
      expect(a.removals.length).toBeGreaterThan(0);
      if (!a.nothingLeft) expect(a.text).toBe(WE);
    }
    const own = `${WE} If you can, let me know your arrival time.`;
    expect(analyzeHostContact(own)).toMatchObject({ text: own, nothingLeft: false, removals: [] });
  });

  it("ev sahibi ÖZNE + söz ('Ev sahibiniz size haber verecek') süzgecin işi değil — metin aynen kalır, çıktı vetosu görür", () => {
    for (const s of [`${W} Ev sahibiniz size haber verecek.`, `${W} Ev sahibiniz sizi arayıp bilgilendirecek.`]) {
      expect(analyzeHostContact(s)).toMatchObject({ text: s, nothingLeft: false, removals: [] });
    }
    // Misafirin kipiyle haber verme yine başvurmadır (R13).
    expect(hostContactKindOf("Ev sahibinizi arayıp bilgi verin.")).not.toBeNull();
    expect(hostContactKindOf("Ev sahibinize haber verebilirsiniz.")).not.toBeNull();
  });
});
