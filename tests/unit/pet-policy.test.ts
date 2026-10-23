import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// EVCİL HAYVAN / YARDIMCI HAYVAN (kurucu 10-23 akşam 4.3 + 4.4, seçenek A). Kurucu: "bedavaysa … hostta kabul ediyorsa gidebilir … ama emin
// olalım model sallamasın" · "yardımcı hayvanı sorusu ile normal evcil hayvan sorusu ayrışsın" · 4.3: köpek sorusu bütün mesajı tutmasın.
// ---------------------------------------------------------------------------

import { kbForbidsPets, kbPetsFreeAllowed, mentionsAssistanceAnimal, mentionsPets } from "@/lib/conversation-items/pet-policy";
import { buildItemsForMessage, replyRiskAttributable } from "@/lib/conversation-items/core";
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

  it("aşırı uygulama yok: 'pet şişe', İngilizce 'chat', 'кошмар' evcil hayvan değildir", () => {
    expect(kbPetsFreeAllowed([...kb("Evcil hayvanlar ücretsiz kabul edilir."), { title: "Çöp", content: "Pet şişeler mavi kutuya atılır." }])).toBe(true);
    for (const t of ["Pet şişeleri mavi kutuya atabilirsiniz.", "You can chat with us anytime.", "Это был кошмар, но всё хорошо."]) {
      expect([t, mentionsPets(t)]).toEqual([t, false]);
    }
    for (const t of ["Evcil hayvan kabul ediyoruz.", "Your dog is welcome.", "Köpeğinizi getirebilirsiniz.", "Haustiere sind erlaubt."]) {
      expect([t, mentionsPets(t)]).toEqual([t, true]);
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
      ...(labels.includes("rule_violation") && ruleViolationIsPetsOnly(body) ? { petRuleOnly: true } : {}),
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
      { id: "k2", propertyId: "p1", title: "Kurallar", content: "Evcil hayvan kabul edilmez." },
      { id: "k1", propertyId: "p1", title: "Pets", content: "No pets allowed." },
      { id: "k3", propertyId: "p2", title: "Evcil hayvan", content: "Evcil hayvanlar ücretsiz kabul edilir." },
      { id: "k4", propertyId: "p2", title: "Otopark", content: "Otopark yoktur." },
    ]);
    expect(f).toEqual([{ propertyId: "p1", itemIds: ["k1", "k2"] }]);
    expect(PET_FORBIDDEN_WARNING).toContain("Yardımcı hayvanlar");
    expect(PET_FORBIDDEN_WARNING).toContain("ilan ayarınızla uyumlu mu kontrol edin");
  });
});
