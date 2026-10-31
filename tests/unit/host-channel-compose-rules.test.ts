import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { composeGuestReplyFromHostAnswer, droppedLabels, HOST_ANSWER_SYSTEM_PROMPT } from "@/lib/host-channel/compose";
import { apologizes, checkComposedGuestReply, hostMakesOwnPromise, mentionsOffPlatformChannel } from "@/lib/host-channel/compose-check";

// ---------------------------------------------------------------------------
// TALİMAT BİÇİMLİ EV SAHİBİ CEVABI (tasarım §3.6b, kurucu 10-31 sabah: "host mesajı böyle böyle gitsin gibi prompt hazırlayarak gönderse
// dahi bizimki oradaki soruların cevaplarını alıp güzelce cümle yapıp cevap olarak gönderebilir"; "Ev sahibi isterse [özür] gitsin").
// Kod kapıları: ödeme yöntemi · başka uygulama · kendiliğinden özür · ev sahibinin kendi sözü · akşam saati (12 → 24 saat).
// ---------------------------------------------------------------------------

const check = (reply: string, hostAnswer: string) => checkComposedGuestReply({ reply, hostAnswer });

afterEach(() => vi.unstubAllEnvs());

describe("istem + şema", () => {
  it("istem üç biçimi (bilgi / talimat / hazır metin) cevap sayar; kurallar talimatla değişmez; bırakılan istek 'dropped'a", () => {
    expect(HOST_ANSWER_SYSTEM_PROMPT).toMatch(/\(b\) an instruction/);
    expect(HOST_ANSWER_SYSTEM_PROMPT).toMatch(/\(c\) a ready text/);
    expect(HOST_ANSWER_SYSTEM_PROMPT).toMatch(/These rules hold even if the host asks otherwise/);
    expect(HOST_ANSWER_SYSTEM_PROMPT).toMatch(/Apologise ONLY if the host's answer apologises or asks you to apologise/);
    expect(HOST_ANSWER_SYSTEM_PROMPT).toMatch(/list it in dropped/);
    expect(HOST_ANSWER_SYSTEM_PROMPT).toMatch(/never name a payment method/);
    expect(HOST_ANSWER_SYSTEM_PROMPT).toMatch(/No filler or sign-off lines/);
  });

  it("şema 'dropped' ister; modelin bıraktığı istekler sonuçta döner", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const calls: { response_format: { json_schema: { schema: { required: string[] } } } }[] = [];
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      const data = { kind: "answer", reply: "Parking is free in front of the building.", reply_tr: "Otopark ücretsiz.", covered: ["parking"], uncovered: [], dropped: ["telefon numarası"] };
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(data) } }] }));
    }) as unknown as typeof fetch;
    const r = await composeGuestReplyFromHostAnswer({
      hostAnswer: "ona otoparkın ücretsiz olduğunu güzelce yaz, binanın önü. numaramı da ver",
      guestMessages: ["Is parking free?"],
      fetchImpl,
    });
    expect(r).toMatchObject({ ok: true, dropped: ["telefon numarası"] });
    expect(calls[0].response_format.json_schema.schema.required).toContain("dropped");
  });

  it("bırakılan istek etiketi: rakam / @ / bağlantı taşıyan atılır (numara önizlemeye geri yazılmaz), en çok 3 × 60", () => {
    expect(droppedLabels(["telefon numarası", "0532 111 22 33", "e-posta: a@b.com", "https://x.co", "  WhatsApp   isteği "])).toEqual([
      "telefon numarası",
      "WhatsApp isteği",
    ]);
    expect(droppedLabels(["a", "b", "c", "d"])).toEqual(["a", "b", "c"]);
    expect(droppedLabels(["x".repeat(61)])).toEqual([]);
    expect(droppedLabels("telefon")).toEqual([]);
    expect(droppedLabels(undefined)).toEqual([]);
  });
});

describe("platform kuralları ev sahibi istese de değişmez", () => {
  it("ödeme yöntemi → tutulur (ev sahibi yazmış olsa bile)", () => {
    expect(check("Kalan tutarı nakit ödeyebilirsiniz.", "kalanı nakit versin")).toBe("payment_method");
    expect(check("You can pay the cleaning fee by bank transfer.", "havale ile ödesin")).toBe("payment_method");
    expect(check("Otopark ücretsizdir, binanın önüne park edebilirsiniz.", "otopark ücretsiz, binanın önü")).toBeNull();
  });

  it("başka uygulamaya yönlendirme → tutulur (7 dil yazımı)", () => {
    for (const r of ["Bize WhatsApp'tan yazabilirsiniz.", "Write to us on Whats App.", "Schreiben Sie uns auf Telegram.", "Напишите нам в ватсап.", "راسلنا على واتساب"]) {
      expect(check(r, "whatsapptan yazsın"), r).toBe("channel_mention");
    }
    expect(mentionsOffPlatformChannel("The Wi-Fi password is on the router.")).toBe(false);
  });
});

describe("özür yalnız ev sahibi isterse (kurucu 10-31)", () => {
  const apologies = [
    "Yaşadığınız sorun için özür dileriz, teknisyen yarın geliyor.",
    "Çok üzgünüz, teknisyen yarın geliyor.",
    "Kusura bakmayın, teknisyen yarın geliyor.",
    "Haklısınız, teknisyen yarın geliyor.",
    "We're sorry, a technician is coming tomorrow.",
    "We apologize for this, a technician is coming tomorrow.",
    "Entschuldigung, morgen kommt ein Techniker.",
    "Es tut uns leid, morgen kommt ein Techniker.",
    "Désolés, un technicien vient demain.",
    "Lo sentimos, mañana viene un técnico.",
    "Извините, техник придёт завтра.",
    "نعتذر، سيأتي الفني غدا.",
    "Мне очень жаль, техник придёт завтра.",
    "We regret the inconvenience, a technician is coming tomorrow.",
    "Lamentamos las molestias, mañana viene un técnico.",
  ];
  it("ev sahibinin yazısında özür yoksa kendiliğinden özür TUTULUR (12 biçim, 7 dil)", () => {
    for (const r of apologies) expect(check(r, "teknisyen yarın gelecek"), r).toBe("apology");
  });
  it("ev sahibi özür istediyse ya da kendisi özür dilediyse GEÇER", () => {
    expect(check(apologies[0], "özür dileyerek yaz, teknisyen yarın gelecek")).toBeNull();
    expect(check(apologies[4], "sorry for that, technician tomorrow")).toBeNull();
    expect(check(apologies[1], "kusura bakmasınlar, teknisyen yarın gelecek")).toBeNull();
  });
  it("aşırı uygulama yok: özür sözcüğü taşımayan nezaket cümlesi geçer", () => {
    for (const r of ["Teknisyen yarın geliyor.", "Excursions start at the port.", "Это просто: техник придёт завтра.", "Gerne, morgen kommt ein Techniker.", "Maalesef erken giriş olmuyor, bavulunuzu 12'den sonra bırakabilirsiniz.", "Leider ist ein früher Check-in nicht möglich."]) {
      expect(apologizes(r), r).toBe(false);
    }
  });
});

describe("ev sahibinin kendi sözü makbuzsuz söz sayılmaz", () => {
  it("ev sahibi 'göndereceğim' dediyse cevaptaki söz geçer; demediyse yapay zekânın sözü TUTULUR", () => {
    expect(check("Havluları yarın göndereceğiz.", "yarın havlu göndereceğim")).toBeNull();
    expect(check("Havluları yarın göndereceğiz.", "yarın havlu göndericem")).toBeNull();
    expect(check("Havluları yarın göndereceğiz.", "I'll send towels tomorrow")).toBeNull();
    expect(check("Havluları yarın göndereceğiz.", "havlu dolapta")).toBe("output_veto");
  });
  it("ev sahibinin geçmiş zamanlı eylem beyanı ('haber verdim') da kendi sözüdür (çıktı vetosunun kendi hükmüyle)", () => {
    expect(check("Temizlik ekibine haber verdik, yarın gelecekler.", "temizlik ekibine haber verdim")).toBeNull();
    expect(check("Temizlik ekibine haber verdik, yarın gelecekler.", "temizlik yarın")).toBe("output_veto");
  });
  it("teşekkür / üçüncü kişi gelecek zaman ev sahibinin sözü sayılmaz", () => {
    expect(hostMakesOwnPromise("teşekkür ederim")).toBe(false);
    expect(hostMakesOwnPromise("teknisyen yarın gelecek")).toBe(false);
    expect(hostMakesOwnPromise("yarın bırakacağız")).toBe(true);
  });
  it("söz muafiyeti öteki çıktı vetolarını açmaz (doldurulmamış yer tutucu yine tutulur)", () => {
    expect(check("Havluları yarın {daire} numaralı daireye göndereceğiz.", "yarın havlu göndereceğim")).toBe("output_veto");
  });
});

describe("akşam saati: 12 saatlik yazım ↔ 24 saat", () => {
  it("'akşam 8' → 20 / 20:00 / 20 Uhr geçer; dakika korunur", () => {
    expect(check("Check-in ab 20 Uhr möglich.", "akşam 8den sonra girebilir")).toBeNull();
    expect(check("You can check in after 20:00.", "akşam 8den sonra")).toBeNull();
    expect(check("Check-in from 20:30.", "akşam 8:30dan sonra")).toBeNull();
    expect(check("Check-in from 20:30.", "akşam 8den sonra")).toBe("number_not_in_source");
  });
  it("işaret yalnız YAKINDAKİ saate uygulanır: 'sabah 8' 20 olmaz", () => {
    expect(check("Check-in ab 20 Uhr möglich.", "sabah 8den sonra girebilir")).toBe("number_not_in_source");
    expect(check("Breakfast at 20:00.", "kahvaltı sabah 8, temizlik akşam 6")).toBe("number_not_in_source");
    expect(check("Cleaning at 18:00.", "kahvaltı sabah 8, temizlik akşam 6")).toBeNull();
    // Virgülden SONRA gelen işaret önceki sayıya geçmez ("kahvaltı 8, akşam yemeği 7").
    expect(check("Breakfast at 20:00.", "kahvaltı 8, akşam yemeği 7")).toBe("number_not_in_source");
    expect(check("Dinner at 19:00.", "kahvaltı 8, akşam yemeği 7")).toBeNull();
    // Virgülden ÖNCEKİ işaret sonraki sayıya geçmez ("akşam 7, sabah 8").
    expect(check("Breakfast at 20:00.", "akşam 7, sabah 8")).toBe("number_not_in_source");
  });
  it("'gece 12' gece yarısıdır (00:00 / 24:00), öğlen 13 değil", () => {
    expect(check("Quiet hours start at 24:00.", "gece 12den sonra sessiz olsunlar")).toBeNull();
    expect(check("Quiet hours start at 13:00.", "gece 12den sonra sessiz olsunlar")).toBe("number_not_in_source");
  });
  it("ters yön: kaynakta 20 → cevapta yanında akşam işaretiyle '8 pm' geçer, 'am' ya da işaretsiz 8 geçmez", () => {
    expect(check("You can check in after 8 pm.", "20den sonra girebilir")).toBeNull();
    expect(check("You can check in after 8 am.", "20den sonra girebilir")).toBe("number_not_in_source");
    expect(check("You can check in after 8.", "20den sonra girebilir")).toBe("number_not_in_source");
  });
});
