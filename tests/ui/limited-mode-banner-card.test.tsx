// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LimitedModeBanner } from "@/components/billing/limited-mode-banner";
import { TRIAL_CARD_REQUIRED_MESSAGE } from "@/lib/billing/trial-card-gate";

// ---------------------------------------------------------------------------
// Kartla deneme bandı (kurucu 10-17, KD2 sınırlı mod): müşteri YALNIZ onaylı metni ve "Kart ekle" eylemini görür — sebep / risk / ilan
// sözcüğü bantta YOK; kart istenmeyen hesapta bant bugünkü metinle (deneme bitti / ödeme alınamadı) kalır.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

describe("kartla deneme bandı", () => {
  it("🚨 kart isteniyor → onaylı metin + 'Kart ekle'; sebep sızmaz", () => {
    const { container } = render(<LimitedModeBanner status="trialing" cardRequiredMessage={TRIAL_CARD_REQUIRED_MESSAGE} />);
    expect(container.textContent).toContain(TRIAL_CARD_REQUIRED_MESSAGE);
    expect(screen.getByText("Kart ekle")).toBeTruthy();
    expect(container.textContent).not.toMatch(/risk|kötüye|işaret|puan|şüphe|deneme süreniz doldu/iu);
    // "IP" ve "ilan" TAM sözcük ("iptal" metinde geçer — "deneme bitmeden iptal ederseniz").
    expect(container.textContent).not.toMatch(/(?<![\p{L}])(?:IP|ilan\p{L}*)(?![\p{L}])/u);
  });

  it("KONTROL: kart istenmeyen hesap bugünkü metni görür (kart cümlesi yok)", () => {
    const { container } = render(<LimitedModeBanner status="past_due" />);
    expect(container.textContent).not.toContain(TRIAL_CARD_REQUIRED_MESSAGE);
    expect(container.textContent).not.toContain("Kart ekle");
  });
});
