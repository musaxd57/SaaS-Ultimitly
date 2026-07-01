// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { GuestChat } from "@/components/guest-chat/guest-chat";

type Msg = { id: string; role: "guest" | "ai" | "host"; text: string };

// A tiny stateful fake server: GET returns the thread; POST appends the guest
// message + an AI reply (mirrors recordGuestChat), then the client re-fetches.
function setupFetch(initial: Msg[]) {
  const server = { messages: [...initial], open: true };
  const fn = vi.fn((_url: string, opts?: RequestInit) => {
    const method = opts?.method ?? "GET";
    if (method === "GET") {
      return Promise.resolve({ ok: true, json: async () => ({ open: server.open, messages: server.messages }) });
    }
    const body = JSON.parse(String(opts!.body)) as { message: string };
    server.messages.push({ id: `g${server.messages.length}`, role: "guest", text: body.message });
    server.messages.push({ id: `a${server.messages.length}`, role: "ai", text: "Çöp salı günü." });
    return Promise.resolve({ ok: true, json: async () => ({ escalated: false, reply: "Çöp salı günü." }) });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function typeAndSend(text: string) {
  fireEvent.change(screen.getByPlaceholderText(/Sorunuzu yazın/), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
}

describe("GuestChat (UI, two-way)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("sends a message and shows the AI reply from the re-fetched history", async () => {
    const fn = setupFetch([]);
    render(<GuestChat token="tok123" propertyName="Nuve 5" />);

    typeAndSend("Çöp ne zaman?");

    await screen.findByText("Çöp ne zaman?"); // guest bubble
    await screen.findByText("Çöp salı günü."); // AI reply (after re-fetch)
    const postCall = fn.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(postCall?.[0]).toBe("/api/chat/tok123");
    expect(JSON.parse(String((postCall![1] as RequestInit).body))).toEqual({ message: "Çöp ne zaman?" });
  });

  it("renders a HOST reply distinctly as 'Ev sahibiniz'", async () => {
    setupFetch([
      { id: "g1", role: "guest", text: "Klima bozuk" },
      { id: "h1", role: "host", text: "Hemen ilgileniyorum, kusura bakmayın." },
    ]);
    render(<GuestChat token="t" propertyName="X" />);

    await screen.findByText("Hemen ilgileniyorum, kusura bakmayın.");
    await screen.findByText(/Ev sahibiniz/); // distinct human label
  });

  it("labels the bot reply as 'Lixus AI'", async () => {
    setupFetch([{ id: "a1", role: "ai", text: "Çöp salı günü." }]);
    render(<GuestChat token="t" propertyName="X" />);
    await screen.findByText("Çöp salı günü.");
    await screen.findByText(/Lixus AI/);
  });

  it("shows a friendly error when the POST fails", async () => {
    const fn = vi.fn((_url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (method === "GET") return Promise.resolve({ ok: true, json: async () => ({ open: true, messages: [] }) });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fn);
    render(<GuestChat token="t" propertyName="X" />);

    typeAndSend("merhaba");

    await screen.findByText(/yanıt veremiyorum/);
  });
});
