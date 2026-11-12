import { describe, it, expect, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// S3 (kurucu kararı 11-11; anahtar `AI_HELD_PET_SPLIT_ENABLED`, VARSAYILAN KAPALI) — "Köpeğimizi getirebilir miyiz? İnternet şifresi ne?"
//
// Bugün: evcil hayvan isteği ev sahibine bırakılınca (öğe kipi) öteki isteğin cevabı da tutuluyor. Karar: Wi-Fi cevabı GİDER, evcil hayvan
// sorusu ev sahibinde KALIR. Şart: giden cevap o soruya dair hiçbir onay / ret / koşul / ima taşımaz. "Evet, getirebilirsiniz." hayvanı
// anmaz; "Tabii! Wi-Fi şifresi …"deki "Tabii" ilk soruya da okunur → ikisi de tutulur.
//
// Opus sert incelemesi (11-12, kodla doğrulandı): sözcük denetimi ve kaba dayanak şartı TEK BAŞINA yetmez → dal yalnız kodun doğruladığı
// cevap parçalarında (`verifiedPartsOnly`) açılır; anahtar tek başına hiçbir şeyi değiştirmez.
// ---------------------------------------------------------------------------

import { heldPetLeak, heldPetSplitEnabled } from "@/lib/conversation-items/pet-policy";
import { autoReplyGateVerdict } from "@/lib/automation";
import { buildItemsPromptBlock, type ReplyItemsInput } from "@/lib/conversation-items/reply-block";
import { composeItemsPlan } from "@/lib/conversation-items/plan";
import { ungroundedAnsweredRefs } from "@/lib/conversation-items/answer-grounding";

afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("AI_HELD_PET_SPLIT_ENABLED", "1");

describe("anahtar", () => {
  it("yalnız tam '1' açar; boş / 'true' / '0' kapalı", () => {
    for (const v of ["", "true", "0", "yes", " 1", "on"]) {
      vi.stubEnv("AI_HELD_PET_SPLIT_ENABLED", v);
      expect([v, heldPetSplitEnabled()]).toEqual([v, false]);
    }
    on();
    expect(heldPetSplitEnabled()).toBe(true);
  });
});

describe("heldPetLeak — cevap, bırakılan evcil hayvan sorusuna dair onay / ret / ima taşıyor mu", () => {
  it("🚨 hayvanı / yardımcı hayvanı anan cevap → sızıntı", () => {
    for (const reply of [
      "Wi-Fi şifresi: Lale2024. Köpeğiniz için ev sahibimiz size dönecek.",
      "The Wi-Fi password is Lale2024. About your dog, we will get back to you.",
      "Das WLAN-Passwort lautet Lale2024. Zu Ihrem Hund melden wir uns.",
      "Wi-Fi şifresi Lale2024. Evcil hayvan konusunu ayrıca yazacağız.",
      "Wi-Fi: Lale2024. Rehber köpeğinizle ilgili ayrıca döneceğiz.",
    ]) {
      expect([reply, heldPetLeak(reply)]).toEqual([reply, "pet_mention"]);
    }
  });

  it("🚨 hayvanı ANMAYAN onay / ret sözcüğü → sızıntı (aynı turda cevapsız bir evet / hayır sorusu var) — yedi dil", () => {
    for (const reply of [
      "Evet, Wi-Fi şifresi Lale2024.",
      "Tabii! Wi-Fi şifresi: Lale2024.",
      "Tabii ki, şifre Lale2024.",
      "Elbette. Wi-Fi şifresi Lale2024.",
      "Sorun değil. Wi-Fi şifresi Lale2024.",
      "Maalesef. Wi-Fi şifresi Lale2024.",
      "Hayır. Wi-Fi şifresi Lale2024.",
      "Yes, the Wi-Fi password is Lale2024.",
      "Of course! The Wi-Fi password is Lale2024.",
      "No problem. The Wi-Fi password is Lale2024.",
      "Unfortunately not. The Wi-Fi password is Lale2024.",
      "Natürlich! Das WLAN-Passwort lautet Lale2024.",
      "Leider nicht. Das WLAN-Passwort lautet Lale2024.",
      "Oui, le mot de passe Wi-Fi est Lale2024.",
      "Bien sûr ! Le mot de passe Wi-Fi est Lale2024.",
      "Por supuesto. La contraseña del Wi-Fi es Lale2024.",
      "Конечно! Пароль от Wi-Fi: Lale2024.",
      "К сожалению, нет. Пароль от Wi-Fi: Lale2024.",
      "نعم، كلمة مرور الواي فاي هي Lale2024.",
    ]) {
      expect([reply, heldPetLeak(reply)]).toEqual([reply, "verdict_word"]);
    }
  });

  it("🚨 Opus 11-12 (kodla doğrulandı): denetimden GEÇEN onay kalıpları, Arapça ve ücret sözcüğü olmayan tutar artık sızıntı", () => {
    for (const [reply, kind] of [
      ["Mümkün. Wi-Fi şifresi Lale2024.", "verdict_word"],
      ["That's possible. The Wi-Fi password is Lale2024.", "verdict_word"],
      ["Sure thing! The Wi-Fi password is Lale2024.", "verdict_word"],
      ["Sure—the Wi-Fi password is Lale2024.", "verdict_word"],
      ["¡Claro que sí! La contraseña es Lale2024.", "verdict_word"],
      ["Pas de souci. Le mot de passe est Lale2024.", "verdict_word"],
      ["Kein Thema. Das WLAN-Passwort lautet Lale2024.", "verdict_word"],
      ["Можно. Пароль: Lale2024.", "verdict_word"],
      // Arapça: hayvan sözcüğü, izin / yasak fiili, tek başına "لا".
      ["الحيوانات الأليفة مرحب بها. كلمة مرور الواي فاي هي Lale2024.", "pet_mention"],
      ["لا يُسمح بالكلاب. كلمة المرور Lale2024.", "pet_mention"],
      ["لا، كلمة المرور Lale2024.", "verdict_word"],
      ["ممكن. كلمة المرور Lale2024.", "verdict_word"],
      ["مرحب بها. كلمة المرور Lale2024.", "verdict_word"],
      ["يمكنكم إحضارها. كلمة المرور Lale2024.", "verdict_word"],
      // Ücret sözcüğü yok, konusuz cümlede tutar var → tutulan evcil hayvan sorusunun ücreti gibi okunur.
      ["Wi-Fi şifresi Lale2024. Ekstra gecelik 300 TL eklenir.", "unanchored_verdict"],
      ["The Wi-Fi password is Lale2024. It's an extra $20 per night.", "unanchored_verdict"],
      ["Das WLAN-Passwort lautet Lale2024. Das macht 15 € pro Nacht.", "unanchored_verdict"],
      // Haiku 11-12 (kodla doğrulandı: hepsi `null` dönüyordu).
      ["Uygundur. Wi-Fi şifresi Lale2024.", "verdict_word"],
      ["Yok, Wi-Fi şifresi Lale2024.", "verdict_word"],
      ["Out of the question. The Wi-Fi password is Lale2024.", "verdict_word"],
      ["لا مشكلة. كلمة المرور Lale2024.", "verdict_word"],
      ["Gern. Das WLAN-Passwort lautet Lale2024.", "verdict_word"],
      ["Разумеется. Пароль: Lale2024.", "verdict_word"],
      ["Con mucho gusto. La contraseña es Lale2024.", "verdict_word"],
      ["بالطبع. كلمة المرور Lale2024.", "verdict_word"],
      ["Pourquoi pas. Le mot de passe est Lale2024.", "verdict_word"],
      ["كـلاب. كلمة المرور Lale2024.", "pet_mention"], // uzatma çizgisi sözcüğü bölmez
      ["Le mot de passe est Lale2024. Cela fait 15 euros par nuit.", "unanchored_verdict"],
      ["Wi-Fi şifresi Lale2024. Gecelik 300 liradır.", "unanchored_verdict"],
      ["Le mot de passe est Lale2024. Un supplément s'applique.", "unanchored_verdict"],
      ["Wi-Fi şifresi Lale2024. Ek ödeme gerekir.", "unanchored_verdict"],
    ] as const) {
      expect([reply, heldPetLeak(reply)]).toEqual([reply, kind]);
    }
    // KONTROL: başka bir hizmetin adını taşıyan cümlede tutar bilgidir.
    for (const reply of [
      "Otopark ücreti gecelik 100 TL.",
      "Parking is 10 € per day.",
      "Kahvaltı kişi başı 250 TL, 08:00–10:30 arası.",
      // Aynı sözcükler bilgi cümlesinin parçasıyken tutmaz.
      "Daire dört kişiye uygundur. Wi-Fi şifresi Lale2024.",
      "Dairede ütü yok ama askı var, Wi-Fi şifresi Lale2024.",
      "Otopark için ek ödeme gerekmez.",
    ]) {
      expect([reply, heldPetLeak(reply)]).toEqual([reply, null]);
    }
  });

  it("🚨 anlamı yere göre değişen sözcükler TEK BAŞINA ünlemken sızıntıdır ('Olur.' · 'Sure, …' · 'No. …' · 'Merhaba, olur.')", () => {
    for (const reply of [
      "Olur. Wi-Fi şifresi Lale2024.",
      "Merhaba, olur. Wi-Fi şifresi Lale2024.",
      "Tamam, Wi-Fi şifresi Lale2024.",
      "Sure, the Wi-Fi password is Lale2024.",
      "Hi Ada, sure! The Wi-Fi password is Lale2024.",
      "No. The Wi-Fi password is Lale2024.",
      "OK — the Wi-Fi password is Lale2024.",
      "Tamam - Wi-Fi şifresi Lale2024.", // boşluklu kısa çizgi de yan cümle sınırıdır
      "Ja, das WLAN-Passwort lautet Lale2024.",
      "Gerne! Das WLAN-Passwort lautet Lale2024.",
      "Claro, la contraseña es Lale2024.",
      "Да, пароль от Wi-Fi: Lale2024.",
      "Non. Le mot de passe est Lale2024.",
    ]) {
      expect([reply, heldPetLeak(reply)]).toEqual([reply, "verdict_word"]);
    }
  });

  it("KONTROL: aynı sözcükler bilgi cümlesinin parçasıyken tutmaz — cümle içinde, cümle başında bir öbeğin parçası, adres numarası", () => {
    for (const reply of [
      "Sıcak su 10 dakikada hazır olur. Wi-Fi şifresi Lale2024.",
      "Please make sure the router is on. The Wi-Fi password is Lale2024.",
      "There is no charge for parking. The Wi-Fi password is Lale2024.",
      "Havuz 20:00'de kapanır, sonra bahçe kapısı kilitli olur.",
      // Haiku 11-12: yan cümle BAŞINDA ama ünlem değil → bilgi.
      "Хорошо отапливается зимой, пароль от Wi-Fi: Lale2024.",
      "Tamam yazan düğmeye basınca klima açılır; kumanda çekmecededir.",
      // Adres / daire numarası: "No. 14" ret sözcüğü değildir.
      "Adres: Menekşe Sokak No. 14, Alsancak.",
      "Otopark yeriniz No: 12, binanın arkasında.",
    ]) {
      expect([reply, heldPetLeak(reply)]).toEqual([reply, null]);
    }
  });

  it("🚨 hayvanı adıyla anmayan örtmece → sızıntı (Haiku 11-12: dört denetimden de geçiyordu)", () => {
    for (const reply of [
      "Minik dostunuz da bizimle konaklayabilir. Wi-Fi şifresi Lale2024.",
      "Patili dostlarınızı aramızda görmekten mutluluk duyarız. Wi-Fi şifresi Lale2024.",
      "Furry friends are more than welcome to join you. The Wi-Fi password is Lale2024.",
      "Su peludo amigo será más que bienvenido. La contraseña es Lale2024.",
      "Ihr Vierbeiner kann gerne dabei sein. Das WLAN-Passwort lautet Lale2024.",
    ]) {
      expect([reply, heldPetLeak(reply)]).toEqual([reply, "pet_mention"]);
    }
  });

  it("🚨 getirme / kabul / izin / yasak fiili → sızıntı (hayvan sözcüğü olmadan da)", () => {
    for (const reply of [
      "Onlar da sizinle kalabilir. Wi-Fi şifresi Lale2024.",
      "Sizinle birlikte konaklayabilir. Wi-Fi şifresi Lale2024.",
      "He can stay with you. The Wi-Fi password is Lale2024.",
      "She is more than welcome. The Wi-Fi password is Lale2024.",
      "Será muy bienvenido. La contraseña es Lale2024.",
      "Getirebilirsiniz. Wi-Fi şifresi Lale2024.",
      "Wi-Fi şifresi Lale2024, onu da getirin lütfen.",
      "Kabul ediyoruz. Wi-Fi şifresi Lale2024.",
      "Buna izin veriyoruz; Wi-Fi şifresi Lale2024.",
      "Bu yasaktır. Wi-Fi şifresi Lale2024.",
      "You can bring him along. The Wi-Fi password is Lale2024.",
      "That is allowed. The Wi-Fi password is Lale2024.",
      "He is very welcome. The Wi-Fi password is Lale2024.",
      "Das ist erlaubt. Das WLAN-Passwort lautet Lale2024.",
      "Sie können ihn mitbringen. Das WLAN-Passwort lautet Lale2024.",
      "C'est autorisé. Le mot de passe est Lale2024.",
      "Está permitido. La contraseña es Lale2024.",
      "Это разрешено. Пароль: Lale2024.",
      "Его можно взять с собой. Пароль: Lale2024.",
    ]) {
      expect([reply, heldPetLeak(reply)]).toEqual([reply, "permission"]);
    }
  });

  it("🚨 başka bir hizmetin adını taşımayan cümlede olumsuzluk / ücret → sızıntı ('Gecelik ücret 200 TL.' hangi sorunun cevabı?)", () => {
    for (const reply of ["Wi-Fi şifresi Lale2024. Gecelik ücret 200 TL'dir.", "Wi-Fi şifresi Lale2024. Bu mümkün olmuyor.", "The Wi-Fi password is Lale2024. There is a fee of 20 EUR per night."]) {
      expect([reply, heldPetLeak(reply)]).toEqual([reply, "unanchored_verdict"]);
    }
  });

  it("✅ yalnız öteki isteğin bilgisini veren düz cevap → sızıntı YOK (yedi dil; başka hizmetin ücreti / olumsuzu serbest)", () => {
    for (const reply of [
      "Wi-Fi şifresi: Lale2024.",
      "Merhaba Ada, Wi-Fi ağı Lale_Home, şifresi Lale2024.",
      "Giriş saati 15:00, çıkış saati 11:00.",
      "Otopark ücretsizdir; binanın arkasındadır.",
      "Otopark ücreti gecelik 100 TL.",
      "Havuz ısıtmalı değildir, 09:00–20:00 arası açıktır.",
      "The Wi-Fi network is Lale_Home and the password is Lale2024.",
      "Check-in is not possible before 15:00.",
      "Parking is free of charge.",
      // Başka hizmetin adı + yapamama olumsuzluğu bilgidir (Opus 11-12 S3-6a: bu koruma pinsizdi).
      "Parking cannot be reserved in advance.",
      "Otoparkta yer ayırmak mümkün olmuyor.",
      "Das WLAN-Passwort lautet Lale2024.",
      "Le mot de passe Wi-Fi est Lale2024.",
      "La contraseña del Wi-Fi es Lale2024.",
      "Пароль от Wi-Fi: Lale2024.",
      "كلمة مرور الواي فاي هي Lale2024.",
      // Ölçüm 11-12 (gerçek taslak): Arapça selam "مرحباً" onay sözcüğü değildir; "يمكنكم" tek başına "yapabilirsiniz"dir.
      'مرحباً Alex،\n\nشبكة الواي فاي اسمها "Lale_Home"، وكلمة المرور هي Lale2024.',
      "أهلاً ومرحباً بكم. يمكنكم الاتصال بشبكة الواي فاي Lale_Home.",
      "Welcome to Lale! The Wi-Fi password is Lale2024.", // selam "welcome" izin fiili değildir
      "Hoş geldiniz! Wi-Fi şifresi Lale2024.",
    ]) {
      expect([reply, heldPetLeak(reply)]).toEqual([reply, null]);
    }
    expect(heldPetLeak("")).toBeNull();
    expect(heldPetLeak(null)).toBeNull();
  });
});

describe("kapı — tutulan evcil hayvan isteği öteki cevabı yalnız sızıntı varsa tutar", () => {
  const model = (reply: string) => ({
    intent: "general",
    riskLevel: "none",
    confidence: 0.95,
    source: "openai",
    riskType: null as string | null,
    reply,
    answeredRequests: { ok: true as const, refs: ["R1"] },
    // Cevap parçaları kipinin işareti: metin yalnız kodun doğruladığı parçalardan kuruldu (dalın ön şartı).
    verifiedPartsOnly: true as const,
  });
  const WIFI_NEED = { ref: "R1", topics: ["wifi"], terms: ["internet", "sifresi", "wifi"], contingency: false };
  const KB = ["Wi-Fi\nAğ adı: Lale_Home, şifre: Lale2024.", "Market\nEn yakın market binanın 150 metre ilerisindedir."];
  /** Evcil hayvan isteği tutuluyor + cevaplanabilir tek istek (varsayılan: Wi-Fi; bilgi tabanında karşılığı var). */
  const heldPets = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    ({
      kbFacts: KB,
      items: { held: [{ kind: "pets", sensitivity: "sensitive", riskType: null, ...over }], paymentHeld: false, answerableKinds: ["wifi"], hostContactNeeds: [WIFI_NEED] },
      ...extra,
    }) as never;
  const GUEST = "Köpeğimizi getirebilir miyiz? İnternet şifresi ne?";
  const WIFI = "Wi-Fi şifresi: Lale2024.";

  it("anahtar KAPALI: bugünkü davranış aynen — Wi-Fi cevabı da tutulur", () => {
    expect(autoReplyGateVerdict(model(WIFI), GUEST, heldPets())).toEqual({ reason: "blocked", detail: "reply_pet_policy" });
  });

  it("🚨 anahtar AÇIK ama cevap doğrulanmış parçalardan kurulmadıysa (parça kipi kapalı) hiçbir şey değişmez — bugünkü gibi tutulur", () => {
    on();
    const plain = { ...model(WIFI), verifiedPartsOnly: undefined };
    expect(autoReplyGateVerdict(plain, GUEST, heldPets())).toEqual({ reason: "blocked", detail: "reply_pet_policy" });
    // KONTROL: aynı cevap doğrulanmış parçalardan kurulduysa gider.
    expect(autoReplyGateVerdict(model(WIFI), GUEST, heldPets())).toBeNull();
  });

  it("🚨 anahtar AÇIK: yalnız Wi-Fi bilgisini veren cevap GİDER (evcil hayvan isteği öğe olarak ev sahibinde kalır)", () => {
    on();
    expect(autoReplyGateVerdict(model(WIFI), GUEST, heldPets())).toBeNull();
    // Yardımcı hayvan isteği de aynı: soru ev sahibinde, öteki bilgi gider.
    expect(autoReplyGateVerdict(model(WIFI), "Rehber köpeğimle geleceğim. İnternet şifresi ne?", heldPets({ riskType: "assistance_animal" }))).toBeNull();
  });

  it("🚨 anahtar AÇIK: yalnız ÖNCEKİ turdan bekleyen evcil hayvan sorusu dalı AÇMAZ — bugünkü kemer aynen (kapsam ölçülen kadar)", () => {
    on();
    // Dün sorulan köpek sorusu ev sahibinde bekliyor; bugün yalnız Wi-Fi soruldu → bugünkü gibi tutulur (turlar arası serbest bırakma ayrı karar).
    expect(autoReplyGateVerdict(model(WIFI), "İnternet şifresi ne?", heldPets({ earlier: true }))).toEqual({ reason: "blocked", detail: "reply_pet_policy" });
    // Anlama katmanının bu turda ÇIKARAMADIĞI yeni evcil hayvan sorusu: önceki öğe dalı açsaydı misafirin cümlesi hiç okunmazdı.
    expect(autoReplyGateVerdict(model(WIFI), "Köpek 5 kg, sorun olur mu? İnternet şifresi ne?", heldPets({ earlier: true }))).toEqual({ reason: "blocked", detail: "reply_pet_policy" });
    // KONTROL: aynı tur içinde çıkarılmış evcil hayvan isteği (önceki öğe de bekliyor olsa) dalı açar.
    const both = {
      kbFacts: KB,
      items: {
        held: [{ kind: "pets", sensitivity: "sensitive", riskType: null, earlier: true }, { kind: "pets", sensitivity: "sensitive", riskType: null }],
        paymentHeld: false,
        answerableKinds: ["wifi"],
        hostContactNeeds: [WIFI_NEED],
      },
    } as never;
    expect(autoReplyGateVerdict(model(WIFI), GUEST, both)).toBeNull();
  });

  it("anahtar AÇIK: boş cevap da tutulur (gönderecek metin yokken dal açık kalmaz)", () => {
    on();
    for (const reply of ["", "   ", null]) {
      expect(autoReplyGateVerdict({ ...model(WIFI), reply } as never, GUEST, heldPets())).toEqual({ reason: "blocked", detail: "reply_pet_policy" });
    }
  });

  it("🚨 anahtar AÇIK: onay / ret / ima taşıyan cevap yine TUTULUR", () => {
    on();
    for (const reply of [
      "Evet, getirebilirsiniz. Wi-Fi şifresi: Lale2024.",
      "Tabii! Wi-Fi şifresi: Lale2024.",
      "Wi-Fi şifresi: Lale2024. Köpeğiniz için ayrıca döneceğiz.",
      "Wi-Fi şifresi: Lale2024. Gecelik ücret 200 TL'dir.",
      "Maalesef kabul edemiyoruz. Wi-Fi şifresi: Lale2024.",
      "Yes! The Wi-Fi password is Lale2024.",
    ]) {
      expect([reply, autoReplyGateVerdict(model(reply), GUEST, heldPets())]).toEqual([reply, { reason: "blocked", detail: "reply_pet_policy" }]);
    }
  });

  it("🚨 anahtar AÇIK: yanındaki sorunun cevabı bilgi tabanında YOKSA uydurulan cevap GİTMEZ (ölçüm 11-12: model 5/5 uydurdu)", () => {
    on();
    const unknown = (kind: string, need: { topics: string[]; terms: string[] }) =>
      ({
        kbFacts: KB,
        items: { held: [{ kind: "pets", sensitivity: "sensitive", riskType: null }], paymentHeld: false, answerableKinds: [kind], hostContactNeeds: [{ ref: "R1", kind, contingency: false, ...need }] },
      }) as never;
    for (const [reply, ctx] of [
      // Marketin mesafesi eczaneye yazıldı: "150 metre" bilgi tabanında var ama eczane yok.
      ["En yakın eczane, binanın yaklaşık 150 metre ilerisindedir.", unknown("local_recommendations", { topics: ["pharmacy"], terms: ["eczane", "yakin", "yakinda"] })],
      ["Dairede misafirlerimizin kullanımına açık ütü bulunmaktadır.", unknown("amenities", { topics: ["iron"], terms: ["utu"] })],
      ["Kahvaltı servisi bulunmuyor.", unknown("amenities", { topics: ["restaurant"], terms: ["kahvalti", "musunuz"] })],
      ["Dairede sabit bir bebek yatağı bulunmuyor.", unknown("amenities", { topics: ["baby"], terms: ["bebek", "besik", "yatagi"] })],
    ] as const) {
      expect([reply, autoReplyGateVerdict(model(reply), "Köpeğimizi getirebilir miyiz? Bir sorum daha var.", ctx)]).toEqual([reply, { reason: "blocked", detail: "items_answer_ungrounded" }]);
    }
    // Modele hiç bilgi tabanı gösterilmediyse de aynı (dayanak bilinmiyor = tut).
    expect(autoReplyGateVerdict(model(WIFI), GUEST, heldPets({}, { kbFacts: null }))).toEqual({ reason: "blocked", detail: "items_answer_ungrounded" });
  });

  it("giriş / çıkış saati mülkün kendi alanından cevaplanır: alan doluysa dayanak vardır; boşsa cevap gitmez", () => {
    on();
    const time = (stayTimes: Record<string, string | null>) =>
      ({
        kbFacts: KB,
        stayTimes,
        items: { held: [{ kind: "pets", sensitivity: "sensitive", riskType: null }], paymentHeld: false, answerableKinds: ["checkout_time"], hostContactNeeds: [{ ref: "R1", kind: "checkout_time", contingency: false, topics: ["checkout"], terms: ["cikis"] }] },
      }) as never;
    const reply = model("Çıkış saati 11:00.");
    expect(autoReplyGateVerdict(reply, "Köpeğimizi getirebilir miyiz? Çıkış saati kaç?", time({ checkIn: "15:00", checkOut: "11:00" }))).toBeNull();
    expect(autoReplyGateVerdict(reply, "Köpeğimizi getirebilir miyiz? Çıkış saati kaç?", time({ checkIn: "15:00", checkOut: null }))).toEqual({ reason: "blocked", detail: "items_answer_ungrounded" });
  });

  it("anahtar AÇIK olsa da: istek öğe olarak ÇIKARILAMADIYSA (yalnız misafirin cümlesinde) bugünkü kemer aynen — cevap tutulur", () => {
    on();
    const missed = { items: { held: [], paymentHeld: false, answerableKinds: ["wifi"] } } as never;
    expect(autoReplyGateVerdict(model(WIFI), GUEST, missed)).toEqual({ reason: "blocked", detail: "reply_pet_policy" });
    // Öğe kipi hiç koşmadıysa da aynı.
    expect(autoReplyGateVerdict({ ...model(WIFI), answeredRequests: undefined } as never, GUEST, {})).toMatchObject({ reason: "blocked" });
  });

  it("anahtar AÇIK olsa da: evcil hayvan isteği CEVAPLANABİLİR sayıldıysa (bilgi tabanı ücretsiz kabul) bugünkü 'cevap aynı yönde mi' denetimi aynen", () => {
    on();
    const free = { petsFreeAllowed: true, items: { held: [], paymentHeld: false, answerableKinds: ["pets", "wifi"] } } as never;
    const both = { ...model("Evet, getirebilirsiniz. Wi-Fi şifresi: Lale2024."), answeredRequests: { ok: true as const, refs: ["R1", "R2"] } };
    expect(autoReplyGateVerdict(both, GUEST, free)).toBeNull();
    const fee = { ...both, reply: "Evet, getirebilirsiniz. Gecelik ücret 200 TL'dir. Wi-Fi şifresi: Lale2024." };
    expect(autoReplyGateVerdict(fee, GUEST, free)).toEqual({ reason: "blocked", detail: "reply_pet_policy" });
  });

  it("anahtar AÇIK olsa da: evcil hayvan isteği hem TUTULAN hem CEVAPLANABİLİR ise (aynı turda iki evcil hayvan isteği) eski kemer aynen", () => {
    on();
    // Bu turda biri tutulan, biri cevaplanabilir sayılan iki evcil hayvan isteği (sıra kipi): ayrım dalı AÇILMAZ; cevap bilgi tabanı
    // "ücretsiz kabul" demiyorsa bugünkü gibi tutulur (hayvanı anmasa da).
    const both = {
      kbFacts: KB,
      items: {
        held: [{ kind: "pets", sensitivity: "sensitive", riskType: null }],
        paymentHeld: false,
        answerableKinds: ["pets", "wifi"],
        hostContactNeeds: [{ ref: "R1", topics: ["pets"], terms: ["evcil"], contingency: false }, { ...WIFI_NEED, ref: "R2" }],
      },
    } as never;
    const reply = { ...model(WIFI), answeredRequests: { ok: true as const, refs: ["R2"] } };
    expect(autoReplyGateVerdict(reply, GUEST, both)).toEqual({ reason: "blocked", detail: "reply_pet_policy" });
  });

  it("🚨 'açık kalan parça' olarak beyan edilen cevap da dayanak ister (metinde gidiyor, yalnız isteği kapatmıyor)", () => {
    on();
    const ctx = {
      kbFacts: KB,
      items: {
        held: [{ kind: "pets", sensitivity: "sensitive", riskType: null }],
        paymentHeld: false,
        answerableKinds: ["wifi", "amenities"],
        hostContactNeeds: [WIFI_NEED, { ref: "R2", topics: ["iron"], terms: ["utu"], contingency: false }],
      },
    } as never;
    const reply = { ...model("Wi-Fi şifresi: Lale2024. Dairede ütü bulunmaktadır."), answeredRequests: { ok: true as const, refs: ["R1"], openRefs: ["R2"] } };
    expect(autoReplyGateVerdict(reply, GUEST, ctx)).toEqual({ reason: "blocked", detail: "items_answer_ungrounded" });
    // KONTROL: açık kalan parça beyan edilmediyse (yalnız Wi-Fi) cevap gider.
    expect(autoReplyGateVerdict(model(WIFI), GUEST, ctx)).toBeNull();
  });

  it("KONTROL: evcil hayvan öğesi olmayan turda anahtar hiçbir şeyi değiştirmez", () => {
    const plain = { items: { held: [], paymentHeld: false, answerableKinds: ["wifi"] } } as never;
    const off = autoReplyGateVerdict(model("Evet, Wi-Fi şifresi Lale2024."), "İnternet şifresi ne?", plain);
    on();
    expect(autoReplyGateVerdict(model("Evet, Wi-Fi şifresi Lale2024."), "İnternet şifresi ne?", plain)).toEqual(off);
    expect(off).toBeNull();
  });
});

describe("istem bloğu — kural + kapı çifti", () => {
  const base: ReplyItemsInput = { answerable: [{ ref: "R1", kind: "wifi", hint: "wifi şifresi" }], held: [{ kind: "pets" }] };

  it("işaret verilmezse blok BAYT BAYT eski; verilirse evcil hayvan cümlesi eklenir", () => {
    const before = buildItemsPromptBlock(base);
    expect(before).not.toContain("Evcil hayvan isteği ev sahibine bırakıldı");
    const after = buildItemsPromptBlock({ ...base, petHeldRule: true });
    expect(after.startsWith(before)).toBe(true);
    const added = after.slice(before.length);
    expect(added).toContain("Evcil hayvan isteği ev sahibine bırakıldı");
    for (const word of ["Evet", "Tabii", "Maalesef", "getirebilirsiniz"]) expect(added).toContain(word);
    // Ölçüm 11-12: bilgisi olmayan isteği cevaplamasın (uydurmasın) — kuralın istemdeki yarısı.
    expect(added).toMatch(/o isteği\s+CEVAPLAMA ve answeredRequests'e KOYMA/);
    // Giriş / çıkış saati ve adres bilgi tabanından değil mülk kaydından gelir — "notlarda yoksa" denirse model onları da cevaplamaz (Opus S3-5a).
    expect(added).toContain("bilgi tabanında ya da mülk bilgilerinde (giriş / çıkış saati, adres) YOKSA");
  });

  it("plan işareti yalnız: anahtar açık + parça kipi + evcil hayvan tutuluyor + gidecek başka cevap var", () => {
    const wifi = { messageId: "m1", kind: "wifi" as const, sensitivity: "none" as const };
    const pets = { messageId: "m1", kind: "pets" as const, sensitivity: "sensitive" as const, riskType: null };
    const plan = (turnItems: (typeof wifi | typeof pets)[], held: (typeof pets)[]) => composeItemsPlan({ turnItems, held, hints: new Map() }).replyItems.petHeldRule;
    expect(plan([pets, wifi], [pets])).toBeUndefined(); // anahtar kapalı
    on();
    expect(plan([pets, wifi], [pets])).toBeUndefined(); // anahtar açık ama parça kipi kapalı → kapı dalı açılamaz, istem de değişmez
    vi.stubEnv("AI_ANSWER_PARTS_ENABLED", "1");
    expect(plan([pets, wifi], [pets])).toBeUndefined(); // parça kipi sıra kipi olmadan etkisiz
    vi.stubEnv("AI_ITEM_ORDINAL_ENABLED", "1");
    expect(plan([pets, wifi], [pets])).toBe(true);
    expect(plan([wifi], [{ ...pets, earlier: true } as never])).toBeUndefined(); // yalnız ÖNCEKİ turdan bekleyen evcil hayvan sorusu: dal açılmaz, işaret de yok
    expect(plan([pets], [pets])).toBeUndefined(); // gidecek cevap yok
    // İhtiyaç kendi TÜRÜNÜ taşır: kapının dayanak şartı mülk alanı kısayolunu (giriş / çıkış saati) türden okur — plan sırasıyla dizin eşlemesi yok.
    expect(composeItemsPlan({ turnItems: [pets, wifi], held: [pets], hints: new Map() }).gateItems.hostContactNeeds?.map((n) => [n.ref, n.kind])).toEqual([["R1", "wifi"]]);
    expect(plan([wifi], [])).toBeUndefined(); // evcil hayvan isteği yok
    const freePets = { messageId: "m1", kind: "pets" as const, sensitivity: "none" as const };
    expect(composeItemsPlan({ turnItems: [freePets, wifi], held: [], hints: new Map() }).replyItems.petHeldRule).toBeUndefined(); // cevaplanabilir
    // Önceki turdan bekleyen evcil hayvan sorusu VAR ama bu turun evcil hayvan sorusu cevaplanabilir → kapı dalı açılmaz, işaret de verilmez.
    expect(composeItemsPlan({ turnItems: [freePets, wifi], held: [{ ...pets, earlier: true } as never], hints: new Map() }).replyItems.petHeldRule).toBeUndefined();
  });
});

describe("ungroundedAnsweredRefs — cevaplanan isteğin konusu gösterilen bir kaynakta geçiyor mu", () => {
  const kbFacts = ["Wi-Fi\nAğ adı: Lale_Home, şifre: Lale2024.", "Otopark\nOtopark ücretsizdir; binanın arkasındadır.", "Market\nEn yakın market binanın 150 metre ilerisindedir."];
  const wifi = { ref: "R1", kind: "wifi" as const, topics: ["wifi"], terms: ["internet", "sifresi", "wifi"] };
  const pharmacy = { ref: "R2", kind: "local_recommendations" as const, topics: ["pharmacy"], terms: ["eczane", "yakin", "yakinda"] };
  const checkout = { ref: "R3", kind: "checkout_time" as const, topics: ["checkout"], terms: ["cikis"] };

  it("konusu bilgi tabanında geçen istek dayanaklı; geçmeyen dayanaksız (yakın konu / ortak sıfat yetmez: 'en yakın market' eczane değildir)", () => {
    expect(ungroundedAnsweredRefs({ needs: [wifi, pharmacy], answeredRefs: ["R1"], kbFacts })).toEqual([]);
    expect(ungroundedAnsweredRefs({ needs: [wifi, pharmacy], answeredRefs: ["R1", "R2"], kbFacts })).toEqual(["R2"]);
    // Cevaplanmayan isteğe bakılmaz (ev sahibinde açık kalır).
    expect(ungroundedAnsweredRefs({ needs: [wifi, pharmacy], answeredRefs: [], kbFacts })).toEqual([]);
  });

  it("yabancı dilde sorulan soru Türkçe sorgusuyla eşlenir (anlama katmanı her isteğe Türkçe sorgu yazar)", () => {
    const wlan = { ref: "R1", kind: "wifi" as const, topics: ["wifi"], terms: ["passwort", "sifresi", "wifi", "wlan"] };
    expect(ungroundedAnsweredRefs({ needs: [wlan], answeredRefs: ["R1"], kbFacts })).toEqual([]);
  });

  it("giriş / çıkış saati: mülk alanı doluysa bilgi tabanına bakılmaz; boşsa bilgi tabanında konu aranır", () => {
    expect(ungroundedAnsweredRefs({ needs: [checkout], answeredRefs: ["R3"], kbFacts, stayTimes: { checkOut: "11:00" } })).toEqual([]);
    expect(ungroundedAnsweredRefs({ needs: [checkout], answeredRefs: ["R3"], kbFacts, stayTimes: { checkOut: " " } })).toEqual(["R3"]);
    expect(ungroundedAnsweredRefs({ needs: [checkout], answeredRefs: ["R3"], kbFacts: [...kbFacts, "Çıkış\nÇıkışta anahtarı kutuya bırakın."], stayTimes: null })).toEqual([]);
  });

  it("🚨 BİLİNEN SINIR (Opus 11-12 S3-3c, pinli): soruyla İLGİLİ ama cevabı içermeyen kalem de 'dayanak' sayılır — bu şart tek başına güvence DEĞİLDİR", () => {
    // Kaba ön süzgeç: isteğin tek sözcüğü ya da kaba sözlük konusu herhangi bir kalemde geçince yeter. Güvence, çağıran dalın şart koştuğu
    // doğrulanmış cevap parçalarıdır (`automation.ts`). Bu test sınırı YAZAR; biri şartı sıkılaştırırsa bilerek güncellensin.
    // Kahvaltı sorusu ↔ restoran önerileri kalemi (kaba sözlük konusu `restaurant`).
    const breakfast = { ref: "R1", kind: "amenities" as const, topics: ["restaurant"], terms: ["kahvalti"] };
    expect(ungroundedAnsweredRefs({ needs: [breakfast], answeredRefs: ["R1"], kbFacts: ["Restoran önerileri\nYakındaki restoranlar: Lale Lokantası, 5 dakika yürüme mesafesinde."] })).toEqual([]);
    // "Mutfakta mikrodalga var mı?" ↔ "Mutfakta bulaşık makinesi vardır." (yer sözcüğü ortak).
    const microwave = { ref: "R1", kind: "amenities" as const, topics: [], terms: ["mutfakta", "mikrodalga"] };
    expect(ungroundedAnsweredRefs({ needs: [microwave], answeredRefs: ["R1"], kbFacts: ["Mutfak\nMutfakta bulaşık makinesi vardır."] })).toEqual([]);
    // Wi-Fi HIZI sorusu ↔ Wi-Fi şifresi kalemi (tür konusu `wifi`).
    const speed = { ref: "R1", kind: "wifi" as const, topics: ["wifi"], terms: ["hizi", "internet"] };
    expect(ungroundedAnsweredRefs({ needs: [speed], answeredRefs: ["R1"], kbFacts })).toEqual([]);
  });

  it("şüphede dayanaksız: tanınmayan kimlik, sözcüğü / konusu olmayan istek, boş ya da verilmemiş bilgi tabanı", () => {
    expect(ungroundedAnsweredRefs({ needs: [wifi], answeredRefs: ["R9"], kbFacts })).toEqual(["R9"]);
    expect(ungroundedAnsweredRefs({ needs: [{ ref: "R1", terms: [], topics: [] }], answeredRefs: ["R1"], kbFacts })).toEqual(["R1"]);
    expect(ungroundedAnsweredRefs({ needs: [wifi], answeredRefs: ["R1"], kbFacts: [] })).toEqual(["R1"]);
    expect(ungroundedAnsweredRefs({ needs: [wifi], answeredRefs: ["R1"], kbFacts: undefined })).toEqual(["R1"]);
    expect(ungroundedAnsweredRefs({ needs: [wifi], answeredRefs: ["R1"], kbFacts: ["", "  "] })).toEqual(["R1"]);
  });
});
