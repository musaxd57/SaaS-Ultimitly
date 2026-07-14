// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ReservationPinControl } from "@/components/properties/reservation-pin-control";

// Faz 5 UX round: explicit removal confirmation ("Vazgeç" / "Kodu kaldır") and
// the "Airbnb mesaj taslağını kopyala" draft — the PIN reaches the clipboard
// only, never any storage, and nothing is auto-sent.

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

describe("ReservationPinControl — PIN reveal + Airbnb draft", () => {
  it("generate reveals the PIN once; the draft copy puts a TR+EN message WITH the code in the clipboard", async () => {
    stubFetch();
    render(<ReservationPinControl reservationId="r1" initialHasPin={false} />);

    fireEvent.click(screen.getByRole("button", { name: /Giriş kodu oluştur/ }));
    await screen.findByText("123456");

    fireEvent.click(screen.getByRole("button", { name: /Airbnb mesaj taslağını kopyala/ }));
    await screen.findByText("Taslak kopyalandı");
    expect(writeText).toHaveBeenCalledTimes(1);
    const draft = writeText.mock.calls[0][0] as string;
    expect(draft).toContain("123456"); // the code the guest needs
    expect(draft).toContain("Giriş kodunuz:"); // TR
    expect(draft).toContain("Your access code:"); // EN for foreign guests
    // Scope disclaimer: optional + money/refund/urgent → Airbnb (product safety line).
    expect(draft).toMatch(/isteğe bağlı/);
    expect(draft).toMatch(/Airbnb mesajlaşmasını/);
    expect(draft).toMatch(/Airbnb messaging/);
    // Nothing persisted anywhere — clipboard only (host approves + sends manually).
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe("ReservationPinControl — removal confirmation", () => {
  it("'Giriş kodunu kaldır' asks first; 'Vazgeç' aborts WITHOUT firing DELETE", async () => {
    const fn = stubFetch();
    render(<ReservationPinControl reservationId="r1" initialHasPin={true} />);

    fireEvent.click(screen.getByRole("button", { name: /Giriş kodunu kaldır/ }));
    await screen.findByText(/giriş kodu kaldırılacak/);
    // Both consequences are spelled out (strict OFF opens, strict ON stays locked).
    screen.getByText(/kod girmeden erişebilir/);
    screen.getByText(/kilitli kalır/);

    fireEvent.click(screen.getByRole("button", { name: /^Vazgeç$/ }));
    await screen.findByRole("button", { name: /Giriş kodunu kaldır/ }); // back to normal row
    expect(fn.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(false);
  });

  it("'Kodu kaldır' confirms → DELETE fires and the control returns to 'Giriş kodu oluştur'", async () => {
    const fn = stubFetch();
    render(<ReservationPinControl reservationId="r1" initialHasPin={true} />);

    fireEvent.click(screen.getByRole("button", { name: /Giriş kodunu kaldır/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Kodu kaldır/ }));

    await screen.findByRole("button", { name: /Giriş kodu oluştur/ }); // hasPin=false now
    const del = fn.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "DELETE");
    expect(del?.[0]).toBe("/api/reservations/r1/chat-pin");
  });
});
