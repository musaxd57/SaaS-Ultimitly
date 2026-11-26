// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LandingDemo } from "@/components/marketing/landing-demo";

// ---------------------------------------------------------------------------
// U13 (kurucu 10-22): ana sayfa demosu yalnız İKİ durum gösterir — "otomatik gönderilirdi" / "ev sahibinin onayına bırakılır". Sebep
// ("riskli konu", "güven eşiğin altında") ve puan gösterilmez; sunucu alanı gelmezse güvenli taraf (onaya bırakılır).
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function ask(body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }));
  render(<LandingDemo />);
  fireEvent.click(screen.getAllByRole("button")[0]);
}

describe("LandingDemo — iki durum", () => {
  it("gönderilirdi", async () => {
    await ask({ reply: "Wi-Fi şifresi bilgi kartında.", wouldAutoSend: true });
    await screen.findByText(/kendiliğinden gönderilirdi/);
  });

  it("onaya bırakılır — sebep / puan YOK", async () => {
    await ask({ reply: "x", wouldAutoSend: false });
    await screen.findByText("Bu mesaj ev sahibinin onayına bırakılır.");
    // Eski sebep cümleleri ("riskli/hassas konu tespit etti", "güven eşiğin altında", "insan onayı gerektiren sınıf") yok.
    expect(document.body.textContent).not.toMatch(/güven eşiğ|konu tespit etti|insan onayı gerektiren|Güvenlik kapısı tam olarak/i);
  });

  it("alan gelmezse (eski önbellek) güvenli taraf: onaya bırakılır", async () => {
    await ask({ reply: "x" });
    await screen.findByText("Bu mesaj ev sahibinin onayına bırakılır.");
  });
});
