import { createHash } from "crypto";
import { describe, it, expect } from "vitest";
import { LEGAL_TEXT_HASH, checkoutLegalTextHash } from "@/lib/legal-text-hash";
import { SECTIONS as GIZLILIK_SECTIONS } from "@/app/(legal)/gizlilik/content";
import { SECTIONS as MESAFELI_SATIS_SECTIONS } from "@/app/(legal)/mesafeli-satis/content";
import { SECTIONS as ON_BILGILENDIRME_SECTIONS } from "@/app/(legal)/on-bilgilendirme/content";
import { SECTIONS as KOSULLAR_SECTIONS } from "@/app/(legal)/kosullar/content";
import { checkoutConsentSentences, checkoutConsentKeysFor, CHECKOUT_CONSENT_KEYS } from "@/lib/billing/consent-copy";

const sha = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const DOCS = [KOSULLAR_SECTIONS, GIZLILIK_SECTIONS, MESAFELI_SATIS_SECTIONS, ON_BILGILENDIRME_SECTIONS];

describe("LEGAL_TEXT_HASH (tamper-evident companion to LEGAL_VERSION)", () => {
  it("is a stable 64-char lowercase-hex sha256 digest", () => {
    expect(LEGAL_TEXT_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic across separate module reads", async () => {
    const again = await import("@/lib/legal-text-hash");
    expect(again.LEGAL_TEXT_HASH).toBe(LEGAL_TEXT_HASH);
  });

  it("matches a hash recomputed from the live SECTIONS content in the documented order (kayıt: yalnız dört metin)", () => {
    expect(sha(DOCS)).toBe(LEGAL_TEXT_HASH);
  });

  it("would change if a legal page's actual text changed (auto-derived, not hand-maintained)", () => {
    const tamperedGizlilik = [...GIZLILIK_SECTIONS.slice(0, -1), { ...GIZLILIK_SECTIONS.at(-1), title: "tampered" }];
    expect(sha([KOSULLAR_SECTIONS, tamperedGizlilik, MESAFELI_SATIS_SECTIONS, ON_BILGILENDIRME_SECTIONS])).not.toBe(LEGAL_TEXT_HASH);
  });
});

// Kurucu 11-13 + Opus P2-2: ödeme onayı satırının özeti dört metin + o ekranda GÖSTERİLEN onay cümleleri — yol başına ayrı. Kartla deneme
// yolunda gösterilmeyen "hemen başlasın" cümlesi özete GİRMEZ; normal yol üç cümleyi taşır. Tek kelime değişirse özet değişir.
describe("ödeme onayı özeti (checkoutLegalTextHash)", () => {
  it("cümleler ekranda okunan tam hâlleridir; kartla denemede yalnız ilk ikisi", () => {
    expect(checkoutConsentSentences()).toEqual([
      "Ön Bilgilendirme Formu’nu okudum ve bu bilgileri aldığımı onaylıyorum.",
      "Mesafeli Satış Sözleşmesi’ni okudum ve kabul ediyorum.",
      "Ücretli planın 14 günlük cayma süresi dolmadan hemen başlamasını onaylıyorum. Bu nedenle cayma hakkımı kaybedeceğimi kabul ediyorum.",
    ]);
    expect(checkoutConsentSentences(checkoutConsentKeysFor({ cardTrial: true }))).toEqual(checkoutConsentSentences().slice(0, 2));
  });

  it("normal yol: dört metin + üç cümle; kartla deneme: dört metin + iki cümle; ikisi farklı ve kayıt özetinden farklı", () => {
    const normal = checkoutLegalTextHash(CHECKOUT_CONSENT_KEYS);
    const cardTrial = checkoutLegalTextHash(checkoutConsentKeysFor({ cardTrial: true }));
    expect(normal).toBe(sha([...DOCS, checkoutConsentSentences()]));
    expect(cardTrial).toBe(sha([...DOCS, checkoutConsentSentences().slice(0, 2)]));
    expect(new Set([normal, cardTrial, LEGAL_TEXT_HASH]).size).toBe(3);
  });

  it("onay cümlelerinden biri değişirse özet değişir", () => {
    const s = checkoutConsentSentences();
    expect(sha([...DOCS, [s[0], "Mesafeli Satış Sözleşmesi’ni okudum.", s[2]]])).not.toBe(checkoutLegalTextHash(CHECKOUT_CONSENT_KEYS));
  });
});
