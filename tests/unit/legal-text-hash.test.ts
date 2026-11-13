import { createHash } from "crypto";
import { describe, it, expect } from "vitest";
import { LEGAL_TEXT_HASH } from "@/lib/legal-text-hash";
import { SECTIONS as GIZLILIK_SECTIONS } from "@/app/(legal)/gizlilik/content";
import { SECTIONS as MESAFELI_SATIS_SECTIONS } from "@/app/(legal)/mesafeli-satis/content";
import { SECTIONS as ON_BILGILENDIRME_SECTIONS } from "@/app/(legal)/on-bilgilendirme/content";
import { SECTIONS as KOSULLAR_SECTIONS } from "@/app/(legal)/kosullar/content";
import { checkoutConsentSentences } from "@/lib/billing/consent-copy";

describe("LEGAL_TEXT_HASH (tamper-evident companion to LEGAL_VERSION)", () => {
  it("is a stable 64-char lowercase-hex sha256 digest", () => {
    expect(LEGAL_TEXT_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic across separate module reads", async () => {
    const again = await import("@/lib/legal-text-hash");
    expect(again.LEGAL_TEXT_HASH).toBe(LEGAL_TEXT_HASH);
  });

  it("matches a hash recomputed from the live SECTIONS content in the documented order", () => {
    const recomputed = createHash("sha256")
      .update(
        JSON.stringify([KOSULLAR_SECTIONS, GIZLILIK_SECTIONS, MESAFELI_SATIS_SECTIONS, ON_BILGILENDIRME_SECTIONS, checkoutConsentSentences()]),
      )
      .digest("hex");
    expect(recomputed).toBe(LEGAL_TEXT_HASH);
  });

  it("would change if a legal page's actual text changed (auto-derived, not hand-maintained)", () => {
    const tamperedGizlilik = [...GIZLILIK_SECTIONS.slice(0, -1), { ...GIZLILIK_SECTIONS.at(-1), title: "tampered" }];
    const tamperedHash = createHash("sha256")
      .update(
        JSON.stringify([KOSULLAR_SECTIONS, tamperedGizlilik, MESAFELI_SATIS_SECTIONS, ON_BILGILENDIRME_SECTIONS, checkoutConsentSentences()]),
      )
      .digest("hex");
    expect(tamperedHash).not.toBe(LEGAL_TEXT_HASH);
  });

  // Kurucu 11-13: ödeme ekranındaki onay cümleleri de özete girer — tek kelime değişirse kayıttaki özet de değişir (hangi cümle görüldü).
  it("ödeme onayı cümlelerinden biri değişirse özet değişir; cümleler ekranda okunan tam hâlleridir", () => {
    const sentences = checkoutConsentSentences();
    expect(sentences).toEqual([
      "Ön Bilgilendirme Formu’nu okudum ve bu bilgileri aldığımı onaylıyorum.",
      "Mesafeli Satış Sözleşmesi’ni okudum ve kabul ediyorum.",
      "Ücretli planın 14 günlük cayma süresi dolmadan hemen başlamasını onaylıyorum. Bu nedenle cayma hakkımı kaybedeceğimi kabul ediyorum.",
    ]);
    const tampered = createHash("sha256")
      .update(
        JSON.stringify([KOSULLAR_SECTIONS, GIZLILIK_SECTIONS, MESAFELI_SATIS_SECTIONS, ON_BILGILENDIRME_SECTIONS, [sentences[0], "Mesafeli Satış Sözleşmesi’ni okudum.", sentences[2]]]),
      )
      .digest("hex");
    expect(tampered).not.toBe(LEGAL_TEXT_HASH);
  });
});
