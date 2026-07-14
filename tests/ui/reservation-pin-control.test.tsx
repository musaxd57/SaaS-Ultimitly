// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ReservationPinControl } from "@/components/properties/reservation-pin-control";

// Faz 5 UX rounds: explicit removal confirmation ("Vazgeç" / "Kodu kaldır") and
// TWO guest-facing copy variants (Airbnb chat message + check-in-guide note),
// both built client-side, filter-friendly, English source, nothing persisted.

function stubFetch() {
  const fn = vi.fn((_url: string, opts?: RequestInit) => {
    const method = opts?.method ?? "GET";
    if (method === "POST") return Promise.resolve({ ok: true, json: async () => ({ ok: true, pin: "123456" }) });
    if (method === "DELETE") return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe("ReservationPinControl — PIN reveal + copy variants", () => {
  it("Airbnb message: filter-friendly English text with the code, scope disclaimer, NO 'QR'/link/Turkish", async () => {
    stubFetch();
    render(<ReservationPinControl reservationId="r1" initialHasPin={false} />);

    fireEvent.click(screen.getByRole("button", { name: /Giriş kodu oluştur/ }));
    await screen.findByText("123456");

    fireEvent.click(screen.getByRole("button", { name: /Airbnb mesajı kopyala/ }));
    await screen.findByText("Mesaj kopyalandı");
    const msg = writeText.mock.calls[0][0] as string;
    expect(msg).toContain("123456"); // the code the guest needs
    expect(msg).toContain("Your access code:"); // English source (Airbnb auto-translates)
    expect(msg).toMatch(/optionally/); // scope: optional use
    expect(msg).toMatch(/Airbnb messaging/); // scope: money/refund/urgent → Airbnb
    // Softened for message filters: no "QR" trigger word, no link, no Turkish body.
    expect(msg).not.toMatch(/QR/i);
    expect(msg).not.toMatch(/https?:\/\//);
    expect(msg).not.toMatch(/Giriş kodunuz|Merhaba/);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("check-in note: compact house-manual line with the code + Airbnb-messaging scope", async () => {
    stubFetch();
    render(<ReservationPinControl reservationId="r1" initialHasPin={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Giriş kodu oluştur/ }));
    await screen.findByText("123456");

    fireEvent.click(screen.getByRole("button", { name: /Giriş talimatı \(check-in\) kopyala/ }));
    await screen.findByText("Talimat kopyalandı");
    const note = writeText.mock.calls[0][0] as string;
    expect(note).toContain("123456");
    expect(note).toMatch(/access code/);
    expect(note).toMatch(/Airbnb messaging/);
    expect(note).not.toMatch(/QR/i);
    // The two variants are distinct texts.
    expect(note).not.toContain("Hello!");
  });
});

describe("ReservationPinControl — removal confirmation", () => {
  it("'Giriş kodunu kaldır' asks first; 'Vazgeç' aborts WITHOUT firing DELETE", async () => {
    const fn = stubFetch();
    render(<ReservationPinControl reservationId="r1" initialHasPin={true} />);

    fireEvent.click(screen.getByRole("button", { name: /Giriş kodunu kaldır/ }));
    await screen.findByText(/giriş kodu kaldırılacak/);
    screen.getByText(/kod girmeden erişebilir/); // strict OFF consequence
    screen.getByText(/kilitli kalır/); // strict ON consequence

    fireEvent.click(screen.getByRole("button", { name: /^Vazgeç$/ }));
    await screen.findByRole("button", { name: /Giriş kodunu kaldır/ });
    expect(fn.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(false);
  });

  it("'Kodu kaldır' confirms → DELETE fires and the control returns to 'Giriş kodu oluştur'", async () => {
    const fn = stubFetch();
    render(<ReservationPinControl reservationId="r1" initialHasPin={true} />);

    fireEvent.click(screen.getByRole("button", { name: /Giriş kodunu kaldır/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Kodu kaldır/ }));

    await screen.findByRole("button", { name: /Giriş kodu oluştur/ });
    const del = fn.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "DELETE");
    expect(del?.[0]).toBe("/api/reservations/r1/chat-pin");
  });
});
