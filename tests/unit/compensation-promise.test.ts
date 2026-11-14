import { describe, it, expect } from "vitest";
import { promisesCompensation } from "@/lib/ai/compensation-promise";
import { autoReplyGateVerdict, type GateItemsContext } from "@/lib/automation";
import { buildItemsForMessage } from "@/lib/conversation-items/core";

// ---------------------------------------------------------------------------
// TAZMİNAT / İADE SÖZÜ kod kemeri (sızma testi 11-14, E-3; bağımsız doğrulama V-E3). Öğe kipinde şikâyet / iade öğesi ev sahibinde
// tutulur, güvenli kısım gider — model tutulan isteğe gelecek zamanlı bir SÖZ yazarsa ("Bir gecelik ücreti iade edeceğiz.") kod onu
// durdurmuyordu (çıktı vetosu yalnız geçmiş zamanı tutuyor, telafi yasağının kod yedeği yalnız kıdemli okuyucuda — açılışta kapalı).
// ---------------------------------------------------------------------------

describe("promisesCompensation — söz", () => {
  it.each([
    "Bir gecelik ücreti iade edeceğiz.",
    "Konaklamanızın bir gecesini iade edeceğim.",
    "Size %20 indirim yapacağız.",
    "Ücretinizin bir kısmını geri ödeyeceğiz.",
    "Bir gecelik ücret size iade edilecek.",
    "Paranızı geri vereceğiz.",
    "Telafi olarak bir sonraki konaklamanızda indirim uygularız.",
    "Bir geceyi ücretsiz yapacağız.",
    "Tazminat ödeyeceğiz.",
    "İade ediyoruz.",
    "Bir gecelik ücreti iade edebiliriz.",
    "Bir gecelik ücreti iade edemeyeceğiz.",
    "We will refund one night.",
    "We'll give you a discount on your next stay.",
    "You'll get a refund for the night.",
    "The night will be refunded.",
    "We can offer a free night.",
    "I will compensate you for the inconvenience.",
    "Ücretinizin yarısını geri yatıracağız.",
    "Ücretinizi geri vereceğiz.",
    "A refund will be processed.",
    "We're going to refund you.",
    "We are issuing a refund for one night.",
    "We cannot refund the night.",
    "We won't refund the cleaning fee.",
    "Bir gecelik indirim yapabiliriz, ister misiniz?",
    "We can offer a discount, would you like that?",
    "Gelecek konaklamanızda indirim yapacağız, özür dileriz.",
  ])("söz → true: %s", (reply) => {
    expect(promisesCompensation(reply)).toBe(true);
  });

  it("karakter hilesiyle (görünmez karakter, kıvrık kesme, büyük harf) da yakalanır", () => {
    expect(promisesCompensation("Bir gecelik ücreti İADE\u200b EDECEĞİZ.")).toBe(true);
    expect(promisesCompensation("We\u2019ll refund the night.")).toBe(true);
  });

  it("uzun cevabın ortasındaki söz da yakalanır (yan cümle başına)", () => {
    expect(promisesCompensation("Çıkış saatimiz 11:00. Anahtarı kutuya bırakabilirsiniz. Bir gecelik ücreti iade edeceğiz. İyi yolculuklar!")).toBe(true);
  });
});

describe("promisesCompensation — aşırı uygulama yok", () => {
  it.each([
    "Anahtarı çıkışta kutuya iade edebilirsiniz.",
    "Kartı resepsiyona iade edeceğiz demek istemedik; kartınızı kutuya bırakmanız yeterli.",
    "Please return the key to the lockbox; we will collect it.",
    "Depozitonuz çıkışta iade edilecek.",
    "İade politikamız rezervasyon sayfanızda yazıyor.",
    "Airbnb iade sürecini kendi yürütecektir.",
    "İade talep etmek ister misiniz?",
    "Çıkış saatimiz 11:00.",
    "Wi-Fi ve otopark ücretsizdir.",
    "Ücretsiz otopark binanın önünde.",
    "We can accept credit cards at the property.",
    "Kahvaltı ücretsiz değildir; yakındaki fırını öneririz.",
    "Ücret bilgisi rezervasyon sayfanızda yazıyor.",
    "We're going to clean the apartment before you arrive.",
    "We cannot accept pets.",
    "Klima sorunu ve kısmi iade talebiniz için özür dileriz.",
    "İade talebiniz için teşekkür ederiz.",
    "Gelecek ay için indirimli fiyatlar sayfamızda.",
    "",
  ])("söz değil → false: %s", (reply) => {
    expect(promisesCompensation(reply)).toBe(false);
  });
  it("null / undefined → false", () => {
    expect(promisesCompensation(null)).toBe(false);
    expect(promisesCompensation(undefined)).toBe(false);
  });
});

describe("öğe kapısı — iade / şikâyet tutulurken söz veren cevap GİTMEZ", () => {
  const keyReply = {
    intent: "check_in",
    riskLevel: "none",
    confidence: 0.92,
    source: "openai",
    riskType: null as string | null,
    reply: "Anahtarı çıkışta kutuya bırakabilirsiniz. Bir gecelik ücreti iade edeceğiz.",
    answeredRequests: { ok: true as const, refs: ["R1"] },
  };
  const GUEST = "Klima iki gün çalışmadı, bir gecenin ücretini geri alabilir miyim? Anahtarı nereye bırakayım?";
  const refundHeld: GateItemsContext = {
    held: buildItemsForMessage({ requests: [{ intent: "cancellation_refund" }, { intent: "complaint_issue" }], lexicalLabels: ["money_refund", "complaint"] }),
    paymentHeld: false,
    answerableKinds: ["access_keys"],
  };

  it("🚨 söz veren cevap → items_compensation_promise (bugün GEÇİYORDU)", () => {
    expect(autoReplyGateVerdict(keyReply, GUEST, { items: refundHeld })?.detail).toBe("items_compensation_promise");
  });
  it("KONTROL: sözsüz güvenli cevap aynı turda tutulmaz", () => {
    const safe = { ...keyReply, reply: "Anahtarı çıkışta kutuya bırakabilirsiniz." };
    expect(autoReplyGateVerdict(safe, GUEST, { items: refundHeld })?.detail).not.toBe("items_compensation_promise");
  });
  it("KONTROL: iade / şikâyet / ödeme tutulmuyorsa kemer sorulmaz (ör. yalnız evcil hayvan tutuluyor)", () => {
    const petHeld: GateItemsContext = {
      held: buildItemsForMessage({ requests: [{ intent: "pets" }], lexicalLabels: [] }),
      paymentHeld: false,
      answerableKinds: ["access_keys"],
    };
    expect(autoReplyGateVerdict(keyReply, "Köpeğimi getirebilir miyim? Anahtar nerede?", { items: petHeld })?.detail).not.toBe(
      "items_compensation_promise",
    );
  });
});
