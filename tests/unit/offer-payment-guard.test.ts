import { describe, it, expect } from "vitest";
import { foldPaymentText, namesPaymentMethod } from "@/lib/payment-method-guard";
import { validateEarlyCheckinRuleInput } from "@/lib/early-checkin/rules";

// The host-written late-checkout offer / early check-in note is relayed to guests as the host's word and
// can be auto-surfaced, so it must never carry a payment METHOD (Airbnb/Booking TOS forbid off-platform/cash).
// 09-25 kök neden turu ("kapıda" vakası): eski kalıp bağlamsız alt dizeydi → kapı konumu / anahtar teslimi ödeme
// yöntemi sayılıyor, Türkçe büyük harf ("KAPIDA ÖDEME", "İBAN") kaçıyordu. Aşağıdaki çiftler aynı YER sözcüğünü
// ödeme bağlamıyla ve bağlamsız sınar — bir cümleye istisna yazılarak geçilemez.
describe("offer text payment-method guard (payment-neutral backstop)", () => {
  it("REJECTS a payment method in any language / rail", () => {
    for (const s of [
      "12:00'ye kadar geç çıkış 300 TL, elden ödeme",
      "Ekstra gece 500 TL, nakit alırız",
      "IBAN'a havale yapabilirsiniz: 250 TL",
      "Late checkout €40 via PayPal",
      "Extra night, pay cash on arrival",
      "Kapıda ödeme ile 200 TL",
      "EFT ile gönderebilirsiniz",
      "Revolut ile gönderin",
      "Banka hesabımıza yatırın",
      "Zahlung per Überweisung",
      "Paiement en espèces",
      "Оплата наличными",
    ]) {
      expect(namesPaymentMethod(s), s).toBe(true);
    }
  });

  it("ACCEPTS a clean price/terms line (no payment method named)", () => {
    for (const s of [
      "13:00'e kadar geç çıkış 250 TL, uygunluğa bağlı.",
      "Ekstra bir gece kalış mümkün, gecelik 600 TL.",
      "Late checkout until 2pm is 40 EUR, subject to the next booking.",
      "Havalandırmayı açık bırakın; havalimanı transferi için bize yazın.",
      "", // empty = clears the offer, must be allowed
    ]) {
      expect(namesPaymentMethod(s), s).toBe(false);
    }
  });

  it("minimal çiftler: YER/BİÇİM sözcüğü ('kapıda', 'elden', 'at the door') yalnız AYNI cümlecikte ödeme bağlamıyla yöntemdir", () => {
    const pairs: [string, string][] = [
      ["Anahtar kapıdaki kutuda.", "Ücreti kapıda alırız."],
      ["Kapıda şifreli kilit var.", "Kapıda 300 TL ödenir."],
      ["Anahtarlar elden teslim edilir.", "Ücreti elden alırız."],
      ["Please leave the key at the door.", "Pay at the door: 40 EUR"],
      ["We will meet you in person at 12:00.", "The fee is payable in person."],
      ["Check-in instructions are sent on arrival day.", "Fee is payable on arrival."],
      // Aynı metinde ücret + kapı, FARKLI cümleciklerde: kapı konumu ödeme yöntemi olmaz.
      ["Erken giriş ücreti 300 TL, anahtar kapıdaki kutuda.", "Erken giriş ücreti 300 TL kapıda alınır."],
      // Saat/ondalık içindeki nokta ve iki nokta cümleciği BÖLMEZ.
      ["Kapıda 12:00'de karşılarız.", "Kapıda 12:00'de ödeme yapılır."],
    ];
    for (const [clean, method] of pairs) {
      expect(namesPaymentMethod(clean), clean).toBe(false);
      expect(namesPaymentMethod(method), method).toBe(true);
    }
  });

  it("Türkçe büyük harf katlanır: 'KAPIDA ÖDEME', 'İBAN', 'NAKİT' JS /i ile kaçıyordu", () => {
    for (const s of ["KAPIDA ÖDEME alınır.", "İBAN ile ödeyin.", "NAKİT ödeme.", "ÜCRETİ ELDEN ALIRIZ"]) {
      expect(namesPaymentMethod(s), s).toBe(true);
    }
    expect(foldPaymentText("KAPIDA ÖDEME İBAN NAKİT Işık")).toBe("kapida odeme iban nakit isik");
  });

  it("yöntem adı sözcük BAŞINDA aranır: 'Libanlı' içindeki 'iban', 'left' içindeki 'eft' yöntem değildir", () => {
    for (const s of ["Libanlı komşumuz yardımcı olur.", "Turn left after the gate.", "Ödevinizi bitirince çıkabilirsiniz."]) {
      expect(namesPaymentMethod(s), s).toBe(false);
    }
  });
});

describe("erken giriş notu: kapı konumu yazan kural KAYDEDİLEBİLİR (kök neden: 13c fikstürü bu yüzden değişmişti)", () => {
  const base = { mode: "auto", earliest: "12:00", fee: { amount: 300, currency: "TRY" } };
  it("kapı/anahtar teslimi notu geçerli, ödeme yöntemi notu geçersiz", () => {
    for (const note of ["Anahtar kapıdaki kilitli kutuda.", "Anahtarlar elden teslim edilir."]) {
      expect(validateEarlyCheckinRuleInput({ ...base, note })?.note, note).toBe(note);
    }
    for (const note of ["Ücreti kapıda alırız.", "KAPIDA ÖDEME alınır.", "İBAN ile ödeyin."]) {
      expect(validateEarlyCheckinRuleInput({ ...base, note }), note).toBeNull();
    }
  });
});
