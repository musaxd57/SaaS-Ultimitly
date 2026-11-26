// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { GuestChat } from "@/components/guest-chat/guest-chat";
import { GuestChatReply } from "@/components/guest-chats/reply-box";
import { LandingDemo } from "@/components/marketing/landing-demo";

// ---------------------------------------------------------------------------
// IME ENTER (ajan turu 11-04, S-13 + doğrulayıcı K-4): Japonca / Çince / Korece klavyede aday penceresi açıkken basılan Enter ADAY
// SEÇER — mesajı göndermemeli (misafir QR sohbetinde mesaj yarım gidiyordu). İki işaret: `isComposing` (çoğu tarayıcı) ve `keyCode 229`
// (Safari masaüstü bileşim bitince gelen Enter'da `isComposing` false olabilir). Üç Enter-gönderir yüzeyi aynı kuralla; düz Enter yine
// gönderir (aşırı uygulama kontrolü).
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const posts = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST").length;

describe("misafir QR sohbeti (GuestChat)", () => {
  function setup() {
    const fn = vi.fn((_url: string, opts?: RequestInit) =>
      (opts?.method ?? "GET") === "GET"
        ? Promise.resolve({ ok: true, json: async () => ({ open: true, messages: [] }) })
        : Promise.resolve({ ok: true, json: async () => ({ escalated: false, reply: "x" }) }),
    );
    vi.stubGlobal("fetch", fn);
    render(<GuestChat token="tok123" />);
    const box = screen.getByPlaceholderText(/Sorunuzu yazın/);
    fireEvent.change(box, { target: { value: "日本語" } });
    return { fn, box };
  }

  it("bileşim sürerken Enter (isComposing) göndermez", async () => {
    const { fn, box } = setup();
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    await new Promise((r) => setTimeout(r, 30));
    expect(posts(fn)).toBe(0);
  });

  it("Safari bileşim Enter'ı (keyCode 229) göndermez", async () => {
    const { fn, box } = setup();
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    await new Promise((r) => setTimeout(r, 30));
    expect(posts(fn)).toBe(0);
  });

  it("KONTROL: düz Enter gönderir", async () => {
    const { fn, box } = setup();
    fireEvent.keyDown(box, { key: "Enter", keyCode: 13 });
    await waitFor(() => expect(posts(fn)).toBe(1));
  });
});

describe("ev sahibi QR cevap kutusu (GuestChatReply)", () => {
  function setup() {
    const fn = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fn);
    render(<GuestChatReply conversationId="c1" />);
    const box = screen.getByPlaceholderText(/Enter gönderir/i);
    fireEvent.change(box, { target: { value: "こんにちは" } });
    return { fn, box };
  }

  it("Safari bileşim Enter'ı (keyCode 229) göndermez", async () => {
    const { fn, box } = setup();
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    await new Promise((r) => setTimeout(r, 30));
    expect(fn).not.toHaveBeenCalled();
  });

  it("bileşim sürerken Enter (isComposing) göndermez; KONTROL: düz Enter gönderir", async () => {
    const { fn, box } = setup();
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    await new Promise((r) => setTimeout(r, 30));
    expect(fn).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter", keyCode: 13 });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
  });
});

describe("ana sayfa demosu (LandingDemo)", () => {
  function setup() {
    const fn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ reply: "x", wouldAutoSend: false }) });
    vi.stubGlobal("fetch", fn);
    render(<LandingDemo />);
    const box = screen.getByPlaceholderText(/Misafir mesajını yazın/);
    fireEvent.change(box, { target: { value: "你好" } });
    return { fn, box };
  }

  it("bileşim Enter'ı (isComposing / keyCode 229) çalıştırmaz; KONTROL: düz Enter çalıştırır", async () => {
    const { fn, box } = setup();
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    await new Promise((r) => setTimeout(r, 30));
    expect(fn).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter", keyCode: 13 });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
  });
});
