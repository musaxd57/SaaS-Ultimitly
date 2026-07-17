import { describe, it, expect } from "vitest";
import { OFFER_PAYMENT_METHOD_RX } from "@/lib/validators";

// The host-written late-checkout offer is relayed to guests as the host's word and
// can be auto-surfaced, so it must never carry a payment METHOD (Airbnb/Booking TOS
// forbid off-platform/cash). This deterministic guard backs the prompt rule.
describe("offer text payment-method guard (payment-neutral backstop)", () => {
  it("REJECTS a payment method in any language / rail", () => {
    for (const s of [
      "12:00'ye kadar geç çıkış 300 TL, elden ödeme",
      "Ekstra gece 500 TL, nakit alırız",
      "IBAN'a havale yapabilirsiniz: 250 TL",
      "Late checkout €40 via PayPal",
      "Extra night, pay cash on arrival",
      "Kapıda ödeme ile 200 TL",
    ]) {
      expect(OFFER_PAYMENT_METHOD_RX.test(s), s).toBe(true);
    }
  });

  it("ACCEPTS a clean price/terms line (no payment method named)", () => {
    for (const s of [
      "13:00'e kadar geç çıkış 250 TL, uygunluğa bağlı.",
      "Ekstra bir gece kalış mümkün, gecelik 600 TL.",
      "Late checkout until 2pm is 40 EUR, subject to the next booking.",
      "", // empty = clears the offer, must be allowed
    ]) {
      expect(OFFER_PAYMENT_METHOD_RX.test(s), s).toBe(false);
    }
  });
});
