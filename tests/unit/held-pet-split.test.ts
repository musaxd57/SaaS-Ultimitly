import { describe, it, expect, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// S3 (kurucu kararı 11-11; anahtar `AI_HELD_PET_SPLIT_ENABLED`, VARSAYILAN KAPALI) — "Köpeğimizi getirebilir miyiz? İnternet şifresi ne?"
//
// Bugün: evcil hayvan isteği ev sahibine bırakılınca (öğe kipi) öteki isteğin cevabı da tutuluyor. Karar: Wi-Fi cevabı GİDER, evcil hayvan
// sorusu ev sahibinde KALIR. Şart: giden cevap o soruya dair hiçbir onay / ret / koşul / ima taşımaz. "Evet, getirebilirsiniz." hayvanı
// anmaz; "Tabii! Wi-Fi şifresi …"deki "Tabii" ilk soruya da okunur → ikisi de tutulur.
// ---------------------------------------------------------------------------

import { heldPetLeak, heldPetSplitEnabled } from "@/lib/conversation-items/pet-policy";
import { autoReplyGateVerdict } from "@/lib/automation";
import { buildItemsPromptBlock, type ReplyItemsInput } from "@/lib/conversation-items/reply-block";
import { composeItemsPlan } from "@/lib/conversation-items/plan";

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

  it("🚨 anlamı yere göre değişen sözcükler cümle / yan cümle BAŞINDA sızıntıdır ('Olur, …' · 'Sure, …' · 'No. …' · 'Merhaba, olur.')", () => {
    for (const reply of [
      "Olur. Wi-Fi şifresi Lale2024.",
      "Merhaba, olur. Wi-Fi şifresi Lale2024.",
      "Tamam, Wi-Fi şifresi Lale2024.",
      "Sure, the Wi-Fi password is Lale2024.",
      "Hi Ada, sure! The Wi-Fi password is Lale2024.",
      "No. The Wi-Fi password is Lale2024.",
      "OK — the Wi-Fi password is Lale2024.",
      "Ja, das WLAN-Passwort lautet Lale2024.",
      "Gerne! Das WLAN-Passwort lautet Lale2024.",
      "Claro, la contraseña es Lale2024.",
      "Да, пароль от Wi-Fi: Lale2024.",
      "Non. Le mot de passe est Lale2024.",
    ]) {
      expect([reply, heldPetLeak(reply)]).toEqual([reply, "verdict_word"]);
    }
  });

  it("KONTROL: aynı sözcükler başta DEĞİLKEN bilgi cümlesinin parçasıdır — tutmaz", () => {
    for (const reply of [
      "Sıcak su 10 dakikada hazır olur. Wi-Fi şifresi Lale2024.",
      "Please make sure the router is on. The Wi-Fi password is Lale2024.",
      "There is no charge for parking. The Wi-Fi password is Lale2024.",
      "Havuz 20:00'de kapanır, sonra bahçe kapısı kilitli olur.",
    ]) {
      expect([reply, heldPetLeak(reply)]).toEqual([reply, null]);
    }
  });

  it("🚨 getirme / kabul / izin / yasak fiili → sızıntı (hayvan sözcüğü olmadan da)", () => {
    for (const reply of [
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
      "Можно. Пароль: Lale2024.",
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
      "Das WLAN-Passwort lautet Lale2024.",
      "Le mot de passe Wi-Fi est Lale2024.",
      "La contraseña del Wi-Fi es Lale2024.",
      "Пароль от Wi-Fi: Lale2024.",
      "كلمة مرور الواي فاي هي Lale2024.",
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
  });
  const heldPets = (over: Record<string, unknown> = {}) =>
    ({ items: { held: [{ kind: "pets", sensitivity: "sensitive", riskType: null, ...over }], paymentHeld: false, answerableKinds: ["wifi"] } }) as never;
  const GUEST = "Köpeğimizi getirebilir miyiz? İnternet şifresi ne?";
  const WIFI = "Wi-Fi şifresi: Lale2024.";

  it("anahtar KAPALI: bugünkü davranış aynen — Wi-Fi cevabı da tutulur", () => {
    expect(autoReplyGateVerdict(model(WIFI), GUEST, heldPets())).toEqual({ reason: "blocked", detail: "reply_pet_policy" });
  });

  it("🚨 anahtar AÇIK: yalnız Wi-Fi bilgisini veren cevap GİDER (evcil hayvan isteği öğe olarak ev sahibinde kalır)", () => {
    on();
    expect(autoReplyGateVerdict(model(WIFI), GUEST, heldPets())).toBeNull();
    // Yardımcı hayvan isteği de aynı: soru ev sahibinde, öteki bilgi gider.
    expect(autoReplyGateVerdict(model(WIFI), "Rehber köpeğimle geleceğim. İnternet şifresi ne?", heldPets({ riskType: "assistance_animal" }))).toBeNull();
    // Önceki turdan bekleyen evcil hayvan sorusu bugünkü Wi-Fi sorusunu da tutmaz.
    expect(autoReplyGateVerdict(model(WIFI), "İnternet şifresi ne?", heldPets({ earlier: true }))).toBeNull();
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
  });

  it("plan işareti yalnız: anahtar açık + evcil hayvan tutuluyor + gidecek başka cevap var", () => {
    const wifi = { messageId: "m1", kind: "wifi" as const, sensitivity: "none" as const };
    const pets = { messageId: "m1", kind: "pets" as const, sensitivity: "sensitive" as const, riskType: null };
    const plan = (turnItems: (typeof wifi | typeof pets)[], held: (typeof pets)[]) => composeItemsPlan({ turnItems, held, hints: new Map() }).replyItems.petHeldRule;
    expect(plan([pets, wifi], [pets])).toBeUndefined(); // anahtar kapalı
    on();
    expect(plan([pets, wifi], [pets])).toBe(true);
    expect(plan([wifi], [{ ...pets, earlier: true } as never])).toBe(true); // önceki turdan bekleyen evcil hayvan sorusu
    expect(plan([pets], [pets])).toBeUndefined(); // gidecek cevap yok
    expect(plan([wifi], [])).toBeUndefined(); // evcil hayvan isteği yok
    const freePets = { messageId: "m1", kind: "pets" as const, sensitivity: "none" as const };
    expect(composeItemsPlan({ turnItems: [freePets, wifi], held: [], hints: new Map() }).replyItems.petHeldRule).toBeUndefined(); // cevaplanabilir
  });
});
