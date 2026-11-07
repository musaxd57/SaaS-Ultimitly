import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// EVCİL HAYVAN / YARDIMCI HAYVAN (kurucu 10-23 akşam 4.3 + 4.4, seçenek A). Kurucu: "bedavaysa … hostta kabul ediyorsa gidebilir … ama emin
// olalım model sallamasın" · "yardımcı hayvanı sorusu ile normal evcil hayvan sorusu ayrışsın" · 4.3: köpek sorusu bütün mesajı tutmasın.
// ---------------------------------------------------------------------------

import { kbForbidsPets, kbPetsFreeAllowed, mentionsAssistanceAnimal, mentionsPets, petReplyStraysFromFreeKb } from "@/lib/conversation-items/pet-policy";
import { buildItemsForMessage, PET_SPLIT_KINDS, replyRiskAttributable } from "@/lib/conversation-items/core";
import { detectRiskTypes, ruleViolationIsPetsOnly } from "@/lib/ai/fallback";
import { autoReplyGateVerdict } from "@/lib/automation";
import { evaluateEscalation } from "@/lib/guest-chat-gate";
import { decideHouseRule } from "@/lib/house-rules/core";
import { PET_FORBIDDEN_WARNING, petForbiddenFindings } from "@/lib/kb-scan/pet-rule";

const kb = (content: string, title = "Evcil hayvan") => [{ title, content }];

describe("bilgi tabanı okuması — yalnız AÇIK ve KOŞULSUZ 'ücretsiz kabul'", () => {
  it("🚨 ücretsiz kabul → evet (TR / EN / DE / FR / ES / RU)", () => {
    for (const c of [
      "Evcil hayvanlar ücretsiz olarak kabul edilir.",
      "Evcil hayvan kabul edilir, ücret alınmaz.",
      "Evcil hayvan kabul ediyoruz; ek ücret yok.",
      "Pets are welcome free of charge.",
      "Pets are allowed, no pet fee.",
      "Haustiere sind kostenlos erlaubt.",
      "Les animaux sont acceptés gratuitement.",
      "Las mascotas son bienvenidas sin cargo.",
      "Домашние животные допускаются бесплатно.",
    ]) {
      expect([c, kbPetsFreeAllowed(kb(c))]).toEqual([c, true]);
    }
  });

  it("🚨 ücretli / koşullu / yasak / ücret belirsiz / başka hizmetin ücretsizliği → hayır (ev sahibine)", () => {
    for (const c of [
      "Evcil hayvan kabul edilir.",
      "Evcil hayvan gecelik 200 TL ücretle kabul edilir.",
      "Küçük köpekler ücretsiz kabul edilir.",
      "10 kg altı evcil hayvan ücretsiz kabul edilir.",
      "Evcil hayvan kabul edilmez.",
      "Evcil hayvan yasaktır.",
      "Pets are not allowed.",
      "Pets allowed on request, free of charge.",
      "Pets are welcome free of charge, maximum one dog.",
      "Evcil hayvan kabul edilir; otopark ücretsizdir.",
      "Evcil hayvan ücretsiz kabul edilir, önceden haber verilmesi gerekir.",
    ]) {
      expect([c, kbPetsFreeAllowed(kb(c))]).toEqual([c, false]);
    }
    // Evcil hayvan anılmıyorsa da hayır (bilinmiyor).
    expect(kbPetsFreeAllowed(kb("Otopark ücretsizdir.", "Otopark"))).toBe(false);
    expect(kbPetsFreeAllowed([])).toBe(false);
    // İki kalemden biri ücret yazıyorsa hayır (her evcil hayvan cümlesi uymalı).
    expect(kbPetsFreeAllowed([...kb("Evcil hayvanlar ücretsiz kabul edilir."), ...kb("Temizlik için evcil hayvan başına 300 TL alınır.", "Temizlik")])).toBe(false);
  });

  it("🚨 Opus 10-23 akşam B1: yasak biçimleri ('-emez', forbidden / prohibited) ve TÜRE GÖRE ayrışan politika 'ücretsiz kabul' değildir; yasak uyarısı da çıkar", () => {
    for (const c of [
      "Kediler ücretsiz kabul edilir; köpekler kabul edilemez.",
      "Kediler ücretsiz kabul edilir, köpekler getirilemez.",
      "Cats are welcome free of charge. Dogs are forbidden.",
      "Cats are welcome free of charge; dogs are prohibited.",
      "Kediler ve köpekler ücretsiz kabul edilir.",
    ]) {
      expect([c, kbPetsFreeAllowed(kb(c))]).toEqual([c, false]);
    }
    for (const c of ["Evcil hayvan kabul edilemez.", "Pets are forbidden.", "Pets are prohibited in the apartment.", "Evcil hayvan getiremezsiniz."]) {
      expect([c, kbForbidsPets(kb(c))]).toEqual([c, true]);
    }
  });

  it("🚨 Opus 10-23 akşam B2: çıplak 'free' ücretsizlik değil ('Feel free', 'smoke-free'); önceden haber / tasma / 'ancak' / 'please' koşuldur", () => {
    for (const c of [
      "Pets are welcome! Feel free to use the garden.",
      "Pets are welcome in our smoke-free home.",
      "Pets are welcome free of charge. Please let us know in advance.",
      "Hunde sind willkommen und kostenlos, bitte vorab anmelden.",
      "Pets welcome, free of charge, on a leash in common areas.",
      "Evcil hayvanlar ücretsiz kabul edilir, ancak koltuklara çıkarılmamalıdır.",
    ]) {
      expect([c, kbPetsFreeAllowed(kb(c))]).toEqual([c, false]);
    }
    // KONTROL: açık ücret bağlamı hâlâ "ücretsiz".
    for (const c of ["Pets are welcome, no pet fee.", "Pets are allowed for free.", "Pets are welcome free of charge."]) {
      expect([c, kbPetsFreeAllowed(kb(c))]).toEqual([c, true]);
    }
  });

  it("🚨 Opus 10-28 R16: TÜR adı geçen ya da İSTİSNA taşıyan kural genel 'ücretsiz kabul' değildir", () => {
    for (const c of [
      "Kediler ücretsiz kabul edilir.",
      "Köpekler ücretsiz kabul edilir.",
      "Evcil hayvanlar ücretsiz kabul edilir, köpekler hariç.",
      "Pets are welcome free of charge, except dogs.",
      "Pets are welcome free of charge (excluding cats).",
      "Haustiere sind kostenlos erlaubt, außer Hunde.",
      "Les animaux sont acceptés gratuitement, sauf les chiens.",
      "Las mascotas son bienvenidas sin cargo, excepto perros.",
      // Tür adı GEÇMEYEN istisnalar (mutasyon R16-except: tür kuralı bunları yakalamaz, yalnız istisna sözcüğü yakalar).
      "Evcil hayvanlar ücretsiz kabul edilir, yaz ayları hariç.",
      "Evcil hayvanlar ücretsiz kabul edilir, bayram dönemleri dışında.",
      "Pets are welcome free of charge, excluding the summer season.",
      "Haustiere sind kostenlos erlaubt, außer im Sommer.",
      // Türkçe ekli biçimler (Haiku 10-28): sözcük sınırı "haricinde / dışındaki"yi kaçırıyordu.
      "Evcil hayvanlar ücretsiz kabul edilir; tehlikeli ırklar haricinde.",
      "Evcil hayvanlar ücretsiz kabul edilir, yaz ayları harici.",
      "Evcil hayvanlar ücretsiz kabul edilir; bayram dışındaki dönemlerde.",
    ]) {
      expect([c, kbPetsFreeAllowed(kb(c))]).toEqual([c, false]);
    }
  });

  it("aşırı uygulama yok: 'pet şişe', İngilizce 'chat', 'кошмар' evcil hayvan değildir", () => {
    expect(kbPetsFreeAllowed([...kb("Evcil hayvanlar ücretsiz kabul edilir."), { title: "Çöp", content: "Pet şişeler mavi kutuya atılır." }])).toBe(true);
    for (const t of ["Pet şişeleri mavi kutuya atabilirsiniz.", "You can chat with us anytime.", "Это был кошмар, но всё хорошо."]) {
      expect([t, mentionsPets(t)]).toEqual([t, false]);
    }
    for (const t of ["Evcil hayvan kabul ediyoruz.", "Your dog is welcome.", "Köpeğinizi getirebilirsiniz.", "Haustiere sind erlaubt."]) {
      expect([t, mentionsPets(t)]).toEqual([t, true]);
    }
  });

  it("🚨 Haiku 10-23 akşam: koşul sonraki cümlede / eksik koşul sözcükleri / yalnız yardımcı hayvan kalemi → hayır; eksik izin biçimleri → evet", () => {
    for (const c of [
      "Evcil hayvan kabul edilir ve ücretsizdir. Depozito 500 TL alınır.",
      "Evcil hayvan kabul edilir, jakuzi ücretsizdir.",
      "Evcil hayvan ücretsiz kabul edilir, tasma zorunludur.",
      "Evcil hayvan ücretsiz kabul edilir, en fazla bir köpek.",
      "Dogs are welcome for free, if house-trained.",
      "Les animaux sont acceptés gratuitement uniquement pour les chats.",
      "Los animales son bienvenidos gratis solamente para gatos.",
      "Yardımcı hayvanlar ücretsiz kabul edilir.",
    ]) {
      expect([c, kbPetsFreeAllowed(kb(c))]).toEqual([c, false]);
    }
    for (const c of [
      "Evcil hayvanınızla birlikte kalabilirsiniz, ücretsizdir.",
      "Pets are welcome at no cost.",
      "Les animaux sont admis gratuitement.",
      "Haustiere sind kostenfrei erlaubt.",
    ]) {
      expect([c, kbPetsFreeAllowed(kb(c))]).toEqual([c, true]);
    }
  });

  it("🚨 Haiku 10-23 akşam: 'hot dog', 'pet-bottle', İspanyolca 'esa', duygusal destek (hayvansız) evcil / yardımcı hayvan değildir; eksik biçimler", () => {
    for (const t of ["We grilled a hot dog for lunch.", "Please recycle the pet-bottle.", "Yakında hayvanat bahçesi var."]) expect([t, mentionsPets(t)]).toEqual([t, false]);
    for (const t of ["Hunden sind erlaubt, oder?", "Les chats sont acceptés ?", "У нас кот, можно?", "Hayvanımızı getirebilir miyiz?", "Hayvanınızı getirebilirsiniz."]) {
      expect([t, mentionsPets(t)]).toEqual([t, true]);
    }
    for (const t of ["¿Esa casa tiene piscina?", "I need emotional support during my stay. What is the wifi password?"]) {
      expect([t, mentionsAssistanceAnimal(t)]).toEqual([t, false]);
    }
    for (const t of ["Yardımcı köpeğim var, getirebilir miyim?", "Yardım köpeğim var, kabul ediyor musunuz?", "Duygusal destek köpeğim var.", "Mein Therapiehund begleitet mich.", "Traigo un perro de servicio."]) {
      expect([t, mentionsAssistanceAnimal(t)]).toEqual([t, true]);
    }
  });

  it("'yasak' yazan bilgi tabanı için uyarı (ev sahibine: yardımcı hayvan her durumda kabul edilmeli)", () => {
    expect(kbForbidsPets(kb("Evcil hayvan kabul edilmez."))).toBe(true);
    expect(kbForbidsPets(kb("No pets allowed."))).toBe(true);
    expect(kbForbidsPets(kb("Evcil hayvanlar ücretsiz kabul edilir."))).toBe(false);
    expect(kbForbidsPets(kb("Otopark yoktur.", "Otopark"))).toBe(false);
  });

  it("🚨 yardımcı / hizmet / destek hayvanı çok dilli; sıradan evcil hayvan sorusu değil", () => {
    for (const t of [
      "Görme engelli olduğum için rehber köpeğim var, gelebilir mi?",
      "Yardımcı hayvanım var.",
      "I travel with a service dog.",
      "Can I bring my emotional support animal?",
      "Ich habe einen Blindenführhund.",
      "J'ai un chien guide.",
      "Tengo un perro guía.",
      "У меня собака-поводырь.",
    ]) {
      expect([t, mentionsAssistanceAnimal(t)]).toEqual([t, true]);
    }
    for (const t of ["Köpeğimizi getirebilir miyiz?", "Can we bring our dog?", "Is there a guide to the city?"]) {
      expect([t, mentionsAssistanceAnimal(t)]).toEqual([t, false]);
    }
  });
});

describe("4.3 — köpek sorusu bütün mesajı tutmaz; parti / fazla kişi / sigara bugünkü gibi", () => {
  const items = (body: string, intents: string[], extra: Partial<Parameters<typeof buildItemsForMessage>[0]> = {}) => {
    const labels = detectRiskTypes(body);
    return buildItemsForMessage({
      requests: intents.map((intent) => ({ intent: intent as never })),
      lexicalLabels: labels,
      // `extract.ts` ile AYNI kural: yalnız evcil hayvan ailesi + mesajın öteki istekleri bağımsız bilgi soruları.
      ...(labels.includes("rule_violation") && ruleViolationIsPetsOnly(body) && intents.every((i) => PET_SPLIT_KINDS.has(i as never))
        ? { petRuleOnly: true }
        : {}),
      ...extra,
    }).map((it) => [it.kind, it.sensitivity]);
  };

  it("🚨 kurucunun örneği: 'Sauna kaçta açılıyor? Küçük köpeğimizi getirebilir miyiz?' → sauna cevaplanır, köpek sorusu ev sahibinde", () => {
    expect(items("Sauna kaçta açılıyor? Küçük köpeğimizi getirebilir miyiz?", ["amenities", "pets"])).toEqual([
      ["amenities", "none"],
      ["pets", "sensitive"],
    ]);
  });

  it("KONTROL: parti / fazla kişi / sigara ailesi atfedilemezse bütün mesaj tutulur (bugünkü)", () => {
    expect(items("Sauna kaçta? Akşam parti yapacağız.", ["amenities"])).toEqual([["amenities", "sensitive"]]);
    expect(items("Sauna kaçta? Köpeğimi getireyim, akşam da parti yapacağız.", ["amenities", "pets"])).toEqual([
      ["amenities", "sensitive"],
      ["pets", "sensitive"],
    ]);
    expect(ruleViolationIsPetsOnly("Köpeğimi getireyim, akşam da parti yapacağız.")).toBe(false);
    expect(ruleViolationIsPetsOnly("Köpeğimizi getirebilir miyiz?")).toBe(true);
  });

  it("🚨 Haiku 10-23 akşam: öteki istek bağımsız bilgi sorusu DEĞİLSE (diğer / konaklama değişikliği) bütün mesaj tutulur", () => {
    expect(items("Köpeğimizle birlikte arkadaşlarımız da gelecek, sauna kaçta?", ["pets", "other"])).toEqual([
      ["pets", "sensitive"],
      ["other", "sensitive"],
    ]);
    expect(items("Köpeğimizle burada kalmaya devam edeceğiz, çıkmayız.", ["pets", "late_checkout"])).toEqual([
      ["pets", "sensitive"],
      ["late_checkout", "sensitive"],
    ]);
  });

  it("🚨 4.4: evcil hayvan isteği varsayılan ev sahibinde (kelime ağı yakalamasa da: 'puppy'); 'ücretsiz kabul' doğrulanmışsa cevaplanabilir", () => {
    expect(items("Can we bring our puppy? What time is check-in?", ["pets", "checkin_time"])).toEqual([
      ["pets", "sensitive"],
      ["checkin_time", "none"],
    ]);
    expect(items("Can we bring our puppy?", ["pets"], { petsFreeAllowed: true })).toEqual([["pets", "none"]]);
    // Kelime ağının evcil hayvan etiketi de doğrulanmış "ücretsiz kabul"de tutmaz…
    expect(items("Köpeğimizi getirebilir miyiz?", ["pets"], { petsFreeAllowed: true })).toEqual([["pets", "none"]]);
    // …ama evcil hayvan isteği yoksa (anlama başka türe koyduysa) etiket bugünkü gibi bağlanır / bütün mesajı tutar.
    expect(items("Köpeğimizi getirebilir miyiz?", ["house_rules"], { petsFreeAllowed: true })).toEqual([["house_rules", "sensitive"]]);
  });

  it("🚨 yardımcı hayvan etiketi evcil hayvan isteğini AYRI sebeple tutar", () => {
    const built = buildItemsForMessage({ requests: [{ intent: "pets" }, { intent: "wifi" }], lexicalLabels: ["assistance_animal"] });
    expect(built.map((it) => [it.kind, it.sensitivity, it.riskType])).toEqual([
      ["pets", "sensitive", "assistance_animal"],
      ["wifi", "none", null],
    ]);
  });

  it("cevap modelinin 'kural ihlali' etiketi tutulan evcil hayvan isteğine atfedilir (bütün cevap tutulmaz)", () => {
    expect(replyRiskAttributable("rule_violation", [{ kind: "pets", sensitivity: "sensitive", riskType: null }])).toBe(true);
    expect(replyRiskAttributable("rule_violation", [{ kind: "wifi", sensitivity: "none", riskType: null }])).toBe(false);
  });
});

describe("kapı kod yedeği — 'model sallamasın'", () => {
  const ok = { intent: "general", riskLevel: "none", confidence: 0.92, source: "openai", riskType: null as string | null, reply: "" };
  it("🚨 evcil hayvandan söz eden cevap yalnız bilgi tabanı 'ücretsiz kabul' diyorsa gider; yardımcı hayvan hiç", () => {
    const yes = { ...ok, reply: "Evet, evcil hayvanınızı getirebilirsiniz." };
    // Kelime ağının yakalamadığı soru ("puppy"): kod yedeği tutar. (Ağın yakaladığı "köpeğimizi" konuşma düzeyinde zaten önce tutulur.)
    expect(autoReplyGateVerdict(yes, "Can we bring our puppy?", {})).toEqual({ reason: "blocked", detail: "reply_pet_policy" });
    expect(autoReplyGateVerdict(yes, "Can we bring our puppy?", { petsFreeAllowed: false })).toEqual({ reason: "blocked", detail: "reply_pet_policy" });
    expect(autoReplyGateVerdict(yes, "Köpeğimizi getirebilir miyiz?", {})).toMatchObject({ reason: "blocked" });
    expect(autoReplyGateVerdict(yes, "Can we bring our puppy?", { petsFreeAllowed: true })).toBeNull();
    const no = { ...ok, reply: "Evcil hayvan kabul edilmiyor." };
    expect(autoReplyGateVerdict(no, "Can we bring our puppy?", {})).toEqual({ reason: "blocked", detail: "reply_pet_policy" });
    const service = { ...ok, reply: "Yes, your service dog is welcome." };
    expect(autoReplyGateVerdict(service, "I have a service dog.", { petsFreeAllowed: true })).toEqual({ reason: "blocked", detail: "reply_pet_policy" });
  });

  it("🚨 Opus 10-23 akşam B3: öğe kipi koşmazken cevap hayvanı anmasa da misafirin evcil hayvan sorusuna cevap tutulur; yardımcı hayvan misafir mesajından da okunur", () => {
    const vague = { ...ok, reply: "Evet, getirebilirsiniz." };
    expect(autoReplyGateVerdict(vague, "Can we bring our puppy?", {})).toEqual({ reason: "blocked", detail: "reply_pet_policy" });
    expect(autoReplyGateVerdict({ ...ok, reply: "Yes, you can bring him along." }, "Can I bring my guide dog?", { petsFreeAllowed: true })).toEqual({
      reason: "blocked",
      detail: "reply_pet_policy",
    });
    // Bilgi tabanı ücretsiz kabul diyorsa sıradan evcil hayvan sorusuna belirsiz "evet" gider (kurucu 4.4 A).
    expect(autoReplyGateVerdict(vague, "Can we bring our puppy?", { petsFreeAllowed: true })).toBeNull();
  });

  it("🚨 Opus 10-23 akşam B4: bilgi tabanı 'ücretsiz kabul' derken cevabın kendisi ters yönde / koşullu / ücretliyse tutulur", () => {
    const free = { petsFreeAllowed: true };
    for (const reply of [
      "Maalesef evcil hayvan kabul edilmiyor.",
      "Evet, köpeğinizi gecelik 200 TL ücretle getirebilirsiniz.",
      "Evet, getirebilirsiniz. Gecelik ücret 200 TL'dir.",
      "Maalesef kabul edemiyoruz.",
      "Yes, pets are welcome but a cleaning fee applies.",
      "Your dog is welcome if it is under 10 kg.",
      "Evet, küçük köpekler kabul edilir.",
    ]) {
      // Kelime ağının yakalamadığı soru ("puppy") — "köpeğimi / dog" konuşma düzeyinde zaten önce tutulur.
      expect([reply, autoReplyGateVerdict({ ...ok, reply }, "Can we bring our puppy?", free)]).toEqual([
        reply,
        { reason: "blocked", detail: "reply_pet_policy" },
      ]);
      expect([reply, evaluateEscalation({ ...ok, reply }, "Can we bring our puppy?", null, [], free).reason]).toEqual([reply, "reply_pet_policy"]);
    }
  });

  it("B4 KONTROL (aşırı uygulama yok): olumlu, koşulsuz cevap ve başka konunun cümlesi geçer", () => {
    expect(petReplyStraysFromFreeKb("Evet, evcil hayvanınızı ücretsiz getirebilirsiniz.", true)).toBe(false);
    expect(petReplyStraysFromFreeKb("No problem — pets are welcome at no extra fee.", true)).toBe(false);
    expect(petReplyStraysFromFreeKb("Evet, köpeğinizi getirebilirsiniz. Wi-Fi şifresi: Lale2024.", true)).toBe(false);
    expect(petReplyStraysFromFreeKb("Evet, getirebilirsiniz. Giriş saati 15:00'tir.", true)).toBe(false);
    // Başka hizmetin ücreti / giriş saatinin olumsuzu evcil hayvan cevabı değildir (mutasyon B4-other + Haiku 10-23 akşam).
    expect(petReplyStraysFromFreeKb("Evet, köpeğinizi getirebilirsiniz. Otopark ücreti gecelik 100 TL.", true)).toBe(false);
    expect(petReplyStraysFromFreeKb("Yes, your dog is welcome. Check-in is not possible before 15:00.", true)).toBe(false);
    // Hayvan sorulmayan turda hayvanı anmayan cümle okunmaz (öğe kipi: evcil hayvan isteği ayrı öğe).
    expect(petReplyStraysFromFreeKb("Otopark ücreti gecelik 100 TL.", false)).toBe(false);
    expect(autoReplyGateVerdict({ ...ok, reply: "Evet, evcil hayvanınızı ücretsiz getirebilirsiniz." }, "Can we bring our puppy?", { petsFreeAllowed: true })).toBeNull();
    expect(evaluateEscalation({ ...ok, reply: "Yes, your puppy is welcome." }, "Can we bring our puppy?", null, [], { petsFreeAllowed: true }).reason).toBeNull();
  });

  it("🚨 Opus 10-28 R18: ÖĞE KİPİNDE (canlıda açık) evcil hayvan öğesi varken cevabın hayvanı anmayan ücret / ret cümlesi de tutulur", () => {
    const items = { held: [], paymentHeld: false, answerableKinds: ["pets"] } as const;
    const free = { petsFreeAllowed: true, items };
    // İkinci misafir mesajında hayvan sözcüğü HİÇ yok (adıyla anılıyor) — sözcük okuması kaçırır, öğe türü yakalar (mutasyon R18-items).
    for (const guest of ["Can we bring our puppy?", "Can Bella come with us? She is house-trained."]) {
      for (const reply of ["Evet, getirebilirsiniz. Gecelik ücret 200 TL'dir.", "Maalesef kabul edemiyoruz."]) {
        expect([guest, reply, autoReplyGateVerdict({ ...ok, reply }, guest, free)]).toEqual([
          guest,
          reply,
          { reason: "blocked", detail: "reply_pet_policy" },
        ]);
      }
    }
    // KONTROL: olumlu, koşulsuz cevap evcil hayvan kemerine takılmaz; evcil hayvan öğesi olmayan turda hayvanı anmayan cümle okunmaz.
    // (Sahte sonuçta öğe beyanı olmadığı için öğe kapısı ayrıca `items_undeclared` der — burada yalnız evcil hayvan kemeri sınanır.)
    expect(autoReplyGateVerdict({ ...ok, reply: "Evet, getirebilirsiniz." }, "Can we bring our puppy?", free)?.detail).not.toBe("reply_pet_policy");
    expect(
      autoReplyGateVerdict({ ...ok, reply: "Otopark ücreti gecelik 100 TL." }, "Is parking paid?", {
        petsFreeAllowed: true,
        items: { held: [], paymentHeld: false, answerableKinds: ["parking"] },
      })?.detail,
    ).not.toBe("reply_pet_policy");
  });

  it("🚨 Haiku 10-28: öğe kipinde anlama katmanı evcil / yardımcı hayvan isteğini HİÇ çıkarmadıysa misafirin mesajı yine okunur", () => {
    // Anlama yalnız giriş saatini çıkardı; köpek sorusu öğe olmadı. Cevap hayvanı anmadan ücret söylüyor → gitmez.
    const missed = { held: [], paymentHeld: false, answerableKinds: ["checkin_time"] } as const;
    const guest = "Köpeğimizle gelebilir miyiz? Giriş saat kaçta?";
    expect(autoReplyGateVerdict({ ...ok, reply: "Giriş 15:00. Evet, getirebilirsiniz; gecelik ücret 200 TL." }, guest, { petsFreeAllowed: true, items: missed })).toEqual({
      reason: "blocked",
      detail: "reply_pet_policy",
    });
    // Bilgi tabanı "ücretsiz kabul" demiyorsa hayvan sorusu kaçırılmış turda cevap ev sahibine kalır.
    expect(autoReplyGateVerdict({ ...ok, reply: "Giriş 15:00. Evet, getirebilirsiniz." }, guest, { items: missed })).toEqual({
      reason: "blocked",
      detail: "reply_pet_policy",
    });
    // Yardımcı hayvan yalnız misafirin cümlesinde; öğe çıkmadı → her zaman ev sahibine (bilgi tabanı ücretsiz dese de).
    expect(
      autoReplyGateVerdict({ ...ok, reply: "Check-in is at 15:00. Yes, you can bring it." }, "We travel with a service dog, is that ok? What time is check-in?", {
        petsFreeAllowed: true,
        items: missed,
      }),
    ).toEqual({ reason: "blocked", detail: "reply_pet_policy" });
    // KONTROL (4.3): evcil hayvan öğesi TUTULDUYSA misafirin yardımcı hayvan sözcüğü öteki cevabı tutmaz (öğe zaten ev sahibinde).
    const heldPets = { held: [{ kind: "pets", sensitivity: "sensitive" }], paymentHeld: false, answerableKinds: ["checkin_time"] } as never;
    expect(
      autoReplyGateVerdict({ ...ok, reply: "Check-in is at 15:00." }, "We travel with a service dog, is that ok? What time is check-in?", { petsFreeAllowed: true, items: heldPets })
        ?.detail,
    ).not.toBe("reply_pet_policy");
  });

  it("aşırı uygulama yok: evcil hayvan anmayan cevap etkilenmez", () => {
    expect(autoReplyGateVerdict({ ...ok, reply: "Check-in is from 15:00. Plastic (PET) bottles go in the blue bin." }, "check-in?", {})).toBeNull();
    expect(autoReplyGateVerdict({ ...ok, reply: "Pet şişeler mavi kutuya." }, "Çöpler?", {})).toBeNull();
  });
});

describe("QR kapısı — kanal kapısıyla AYNI kural", () => {
  const draft = (reply: string) => ({ intent: "general", riskLevel: "none", confidence: 0.92, source: "openai", riskType: null, reply });
  it("🚨 'ücretsiz kabul' doğrulanmadan evcil hayvan cevabı devredilir; doğrulanınca gider; yardımcı hayvan hiç", () => {
    expect(evaluateEscalation(draft("Yes, your puppy is welcome."), "Can we bring our puppy?").reason).toBe("reply_pet_policy");
    expect(evaluateEscalation(draft("Yes, your puppy is welcome."), "Can we bring our puppy?", null, [], { petsFreeAllowed: true }).reason).toBeNull();
    expect(evaluateEscalation(draft("Your service dog is welcome."), "I have a service dog.", null, [], { petsFreeAllowed: true }).reason).toBe("reply_pet_policy");
    expect(evaluateEscalation(draft("Check-in is from 15:00."), "When is check-in?").reason).toBeNull();
    // Opus 10-23 akşam B3: QR'da öğe kipi yok → misafirin evcil / yardımcı hayvan sorusu cevap metninden bağımsız okunur.
    expect(evaluateEscalation(draft("Yes, you can bring him along."), "Can we bring our puppy?").reason).toBe("reply_pet_policy");
    expect(evaluateEscalation(draft("Yes, you can bring him along."), "Can I bring my guide dog?", null, [], { petsFreeAllowed: true }).reason).toBe("reply_pet_policy");
  });
});

describe("ev kuralları çekirdeği (gölge) — evcil hayvan kuralı koddan söylenmez", () => {
  it("izinli de yasak da ev sahibine (kart ücret bilmez; Airbnb'de ücretle eklenebilir)", () => {
    const rule = (policy: "allowed" | "forbidden") => [{ topic: "pets" as const, policy, status: "confirmed" as const }];
    expect(decideHouseRule({ topic: "pets", stance: "asks_permission" }, rule("allowed"))).toEqual({ kind: "hold" });
    expect(decideHouseRule({ topic: "pets", stance: "asks_permission" }, rule("forbidden"))).toEqual({ kind: "hold" });
    expect(decideHouseRule({ topic: "pets", stance: "not_about_guest" }, rule("forbidden"))).toEqual({ kind: "not_applicable" });
    // Öteki konular aynen.
    expect(decideHouseRule({ topic: "smoking", stance: "asks_permission" }, [{ topic: "smoking", policy: "forbidden", status: "confirmed" }])).toMatchObject({
      kind: "state_rule",
    });
  });
});

describe("bilgi tabanı taraması — 'yasak' kalemi uyarısı (seçenek A)", () => {
  it("daire başına yasak kalemleri bulur; izinli / ilgisiz kalem bulgu değildir; uyarı metni kurucunun seçtiği", () => {
    const f = petForbiddenFindings([
      { id: "k2", organizationId: "org-1", propertyId: "p1", title: "Kurallar", content: "Evcil hayvan kabul edilmez." },
      { id: "k1", organizationId: "org-1", propertyId: "p1", title: "Pets", content: "No pets allowed." },
      { id: "k3", organizationId: "org-1", propertyId: "p2", title: "Evcil hayvan", content: "Evcil hayvanlar ücretsiz kabul edilir." },
      { id: "k4", organizationId: "org-1", propertyId: "p2", title: "Otopark", content: "Otopark yoktur." },
    ]);
    expect(f).toEqual([{ propertyId: "p1", itemIds: ["k1", "k2"] }]);
    expect(PET_FORBIDDEN_WARNING).toContain("Yardımcı hayvanlar");
    expect(PET_FORBIDDEN_WARNING).toContain("ilan ayarınızla uyumlu mu kontrol edin");
  });
});
