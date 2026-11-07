// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// Sabah Kararları 62 h (kurucu 10-07): yapay zekâ metni anahtarı açıkken panel taslağı sunucudan ister, onaylı şablon beklerken
// ekranda kalır; ev sahibi metne dokunduysa gelen taslak EZMEZ. Gönderimde metin karar kaydıyla uyuşmazsa uyarı + "Yine de gönder".

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DecisionPanel, type DecisionCardData } from "@/components/inbox/decision-panel";

const card: DecisionCardData = {
  id: "d1",
  kind: "early_checkin",
  title: "13:00 erken giriş",
  statusLabel: "Karar bekliyor",
  open: true,
  unverified: false,
  sending: false,
  version: 0,
  requestedTime: "13:00",
  dayKey: "2026-10-14",
  dayLabel: "14 Ekim (varış günü)",
  askedAt: "13 Eki 10:00",
  requestQuote: "13:00'te girebilir miyiz?",
  standardTime: "15:00",
  lang: "tr",
  fee: null,
  note: null,
  lines: [{ ok: false, text: "Çıkış temizliği henüz bitmedi." }],
  laterGuestMessageId: null,
  factsHash: "h1",
};

const AI_TEXT = "Maalesef 14 Ekim'de saat 13:00'te temizlik henüz sürüyor olacak; daireniz 15:00'te hazır olacak.";

type Handler = (url: string, body: Record<string, unknown>) => { status: number; json: unknown } | Promise<{ status: number; json: unknown }>;
function mockFetch(handler: Handler) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url: String(url), body });
    const r = await handler(String(url), body);
    return new Response(JSON.stringify(r.json), { status: r.status });
  }) as unknown as typeof fetch;
  return calls;
}

const textarea = () => screen.getByLabelText("Misafire gidecek mesaj") as HTMLTextAreaElement;

describe("karar paneli — yapay zekâ taslağı ve metin denetimi", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("anahtar KAPALI: taslak istenmez, onaylı şablon", async () => {
    const calls = mockFetch(() => ({ status: 200, json: {} }));
    render(<DecisionPanel conversationId="c1" decisions={[card]} />);
    fireEvent.click(screen.getByRole("button", { name: /Reddet/ }));
    expect(textarea().value).toContain("erken giriş mümkün olmayacak");
    expect(calls).toHaveLength(0);
  });

  it("anahtar AÇIK: şablon hemen görünür, yapay zekâ taslağı gelince yerine geçer", async () => {
    const calls = mockFetch((url) => (url.endsWith("/draft") ? { status: 200, json: { text: AI_TEXT, source: "ai" } } : { status: 200, json: {} }));
    render(<DecisionPanel conversationId="c1" decisions={[card]} aiText />);
    fireEvent.click(screen.getByRole("button", { name: /Reddet/ }));
    expect(textarea().value).toContain("erken giriş mümkün olmayacak");
    await waitFor(() => expect(textarea().value).toBe(AI_TEXT));
    expect(calls[0].url).toBe("/api/conversations/c1/decisions/d1/draft");
    expect(calls[0].body).toMatchObject({ action: "decline", lang: "tr", includeFee: true, includeNote: true });
    expect(screen.getByTestId("decision-ai-caption").textContent).toContain("Mesajı yapay zekâ yazdı");
  });

  it("ev sahibi yazmaya başladıysa gelen taslak metni EZMEZ", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    mockFetch(async (url) => {
      if (url.endsWith("/draft")) {
        await gate;
        return { status: 200, json: { text: AI_TEXT, source: "ai" } };
      }
      return { status: 200, json: {} };
    });
    render(<DecisionPanel conversationId="c1" decisions={[card]} aiText />);
    fireEvent.click(screen.getByRole("button", { name: /Reddet/ }));
    fireEvent.change(textarea(), { target: { value: "Kendi yazdığım ret mesajı." } });
    release();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(textarea().value).toBe("Kendi yazdığım ret mesajı.");
  });

  it("gönderimde uyuşmazlık → uyarı listesi + 'Yine de gönder' force ile gönderir", async () => {
    const calls = mockFetch((url, body) => {
      if (url.endsWith("/draft")) return { status: 200, json: { text: AI_TEXT, source: "ai" } };
      if (body.force) return { status: 200, json: { status: "declined" } };
      return {
        status: 409,
        json: { code: "text_mismatch", error: "Mesaj karar kaydınızla uyuşmuyor. Düzeltin ya da yine de gönderin.", problems: ["Mesajda 12:30 yazıyor."] },
      };
    });
    render(<DecisionPanel conversationId="c1" decisions={[card]} aiText />);
    fireEvent.click(screen.getByRole("button", { name: /Reddet/ }));
    await waitFor(() => expect(textarea().value).toBe(AI_TEXT));
    fireEvent.click(screen.getByRole("button", { name: "Misafire gönder" }));
    await screen.findByText("Mesajda 12:30 yazıyor.");
    fireEvent.click(screen.getByRole("button", { name: "Yine de gönder" }));
    await waitFor(() => expect(calls.filter((c) => !c.url.endsWith("/draft"))).toHaveLength(2));
    const sends = calls.filter((c) => !c.url.endsWith("/draft"));
    expect(sends[0].body.force).toBeUndefined();
    expect(sends[1].body).toMatchObject({ force: true, action: "decline", body: AI_TEXT, lang: "tr" });
  });
});
