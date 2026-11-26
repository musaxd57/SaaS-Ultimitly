// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

import { WhatsAppBindingCard } from "@/components/settings/whatsapp-binding-card";

// ---------------------------------------------------------------------------
// Ayarlar › WhatsApp bildirimleri kartı — istemci (tasarım §5.4). Pinlenen: sunucu `available:false` derse kart hiç çizilmez; rıza kutusu
// işaretlenmeden "Kodu al" basılamaz; kod + "WhatsApp'ta aç" bağlantısı gösterilir; bağlı numara maskeli; sunucunun cümlesi aynen gösterilir.
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
function mockFetch(responses: Array<{ ok?: boolean; body: Json }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const r = responses[Math.min(i++, responses.length - 1)]!;
      return { ok: r.ok ?? true, json: async () => r.body } as Response;
    }),
  );
  return calls;
}

const CONSENT = "Misafir sorularının bu WhatsApp numarasına gönderilmesini kabul ediyorum.";

describe("WhatsApp bildirimleri kartı", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("sunucu kapalı derse kart çizilmez", async () => {
    const calls = mockFetch([{ body: { available: false } }]);
    const { container } = render(<WhatsAppBindingCard />);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(container.textContent).toBe("");
  });

  it("rıza işaretlenmeden 'Kodu al' kapalı; işaretlenince kod + WhatsApp'ta aç bağlantısı gelir", async () => {
    const calls = mockFetch([
      { body: { available: true, consentText: CONSENT, binding: null } },
      { body: { code: "LIXUS-7F3K2Q", masked: "+•• ••• ••• •• 67", expiresAt: "2026-10-31T00:00:00Z", link: "https://wa.me/905550000000?text=LIXUS-7F3K2Q" } },
    ]);
    render(<WhatsAppBindingCard />);
    const input = await screen.findByLabelText(/WhatsApp numaranız/i);
    fireEvent.change(input, { target: { value: "+90 532 123 45 67" } });
    const btn = screen.getByRole("button", { name: /Kodu al/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByText(CONSENT)).toBeTruthy();
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(await screen.findByText("LIXUS-7F3K2Q")).toBeTruthy();
    const link = screen.getByRole("link", { name: /WhatsApp'ta aç/i }) as HTMLAnchorElement;
    expect(link.href).toBe("https://wa.me/905550000000?text=LIXUS-7F3K2Q");
    expect(link.rel).toContain("noopener");
    expect(JSON.parse(String(calls[1]!.init!.body))).toEqual({ number: "+90 532 123 45 67", consent: true });
  });

  it("bağlı numara maskeli gösterilir; kaldır DELETE gönderir", async () => {
    const calls = mockFetch([
      { body: { available: true, consentText: CONSENT, binding: { status: "active", masked: "+•• ••• ••• •• 67", expiresAt: null } } },
      { body: { revoked: true } },
      { body: { available: true, consentText: CONSENT, binding: null } },
    ]);
    render(<WhatsAppBindingCard />);
    expect(await screen.findByText("+•• ••• ••• •• 67")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Bağlantıyı kaldır/i }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "DELETE")).toBe(true));
    expect(await screen.findByLabelText(/WhatsApp numaranız/i)).toBeTruthy();
  });

  it("sunucunun genel cümlesi aynen gösterilir (ayrıntı uydurulmaz)", async () => {
    const msg = "Bu numara şu anda bağlanamıyor. Başka bir numara deneyin ya da daha sonra tekrar deneyin.";
    mockFetch([{ body: { available: true, consentText: CONSENT, binding: null } }, { ok: false, body: { error: "Doğrulama hatası", fields: { number: msg } } }]);
    render(<WhatsAppBindingCard />);
    fireEvent.change(await screen.findByLabelText(/WhatsApp numaranız/i), { target: { value: "+90 532 123 45 67" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Kodu al/i }));
    expect((await screen.findByRole("alert")).textContent).toBe(msg);
  });
});
