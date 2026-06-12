// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { GuestChat } from "@/components/guest-chat/guest-chat";

function typeAndSend(text: string) {
  fireEvent.change(screen.getByPlaceholderText(/Sorunuzu yazın/), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
}

describe("GuestChat (UI)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("sends the message to /api/chat/[token] and renders the AI reply", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reply: "Çöp salı günü.", escalated: false }) }),
    );
    render(<GuestChat token="tok123" propertyName="Nuve 5" />);

    typeAndSend("Çöp ne zaman?");

    await screen.findByText("Çöp ne zaman?"); // guest bubble
    await screen.findByText("Çöp salı günü."); // AI reply
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/chat/tok123");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ message: "Çöp ne zaman?" });
  });

  it("shows the 'escalated to host' note when the server escalates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reply: "Ev sahibine ilettim.", escalated: true }) }),
    );
    render(<GuestChat token="t" propertyName="X" />);

    typeAndSend("daire kirli, şikayetçiyim");

    await screen.findByText("Ev sahibine ilettim.");
    await screen.findByText(/Ev sahibine iletildi/);
  });

  it("surfaces a friendly error when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<GuestChat token="t" propertyName="X" />);

    typeAndSend("merhaba");

    await screen.findByText(/yanıt veremiyorum/);
  });
});
