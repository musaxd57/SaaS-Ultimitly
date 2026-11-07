import { describe, it, expect } from "vitest";
import { HOST_CHANNEL_CONSENT_TEXT, HOST_CHANNEL_CONSENT_VERSION } from "@/lib/host-channel/consent";

// Rıza metni WhatsApp'a giden BÜTÜN mesaj türlerini kapsar (kurucu 10-31 "Rıza metnini güncelle"): soru (dilim 1) · acil bildirim (dilim 4) ·
// karar isteği (dilim 3). Yeni bir tür eklenip metin güncellenmezse ev sahibi rıza vermediği mesajı alırdı. Metin değişince sürüm de değişir.
describe("WhatsApp rıza metni", () => {
  it("üç mesaj türünü de adıyla anar; sürüm v2", () => {
    expect(HOST_CHANNEL_CONSENT_TEXT).toMatch(/Misafir sorularının/u);
    expect(HOST_CHANNEL_CONSENT_TEXT).toMatch(/acil misafir bildirimlerinin/u);
    expect(HOST_CHANNEL_CONSENT_TEXT).toMatch(/karar isteklerinin/u);
    expect(HOST_CHANNEL_CONSENT_TEXT).toMatch(/DUR yazarak kapatabilirim/u);
    expect(HOST_CHANNEL_CONSENT_VERSION).toMatch(/^v2-/u);
  });
});
