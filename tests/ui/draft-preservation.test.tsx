// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TASLAK KORUMA + İSTEK SIRASI (Codex 10-07, 15c8663: Y10 · U27 · U28).
//  · Y10: ev sahibi A'yı gönderirken kutu yazılabilir; B'yi yazar; A başarıyla dönünce kutu koşulsuz boşalıyordu → B silindi
//    (QR cevap kutusu + gelen kutusu yazma alanı).
//  · U27: misafir A'yı gönderirken B'yi yazar; A hata alınca alan eski A ile dolduruluyordu → B silindi.
//  · U28: daha yeni bir isteğin 200/açık cevabından SONRA gelen eski 404, sohbeti kapatıp sorgulamayı durduruyordu.
// Her vakanın yanında normal akış (kontrol).
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { GuestChatReply } from "@/components/guest-chats/reply-box";
import { GuestChat } from "@/components/guest-chat/guest-chat";
import { ConversationThread } from "@/components/inbox/conversation-thread";

type Deferred = { resolve: (r: Response) => void; reject: (e: unknown) => void };
function deferredFetch(match: (url: string, init?: RequestInit) => boolean, otherwise: () => Response) {
  const pending: Deferred[] = [];
  const fn = vi.fn((url: string, init?: RequestInit) => {
    if (match(url, init)) return new Promise<Response>((resolve, reject) => pending.push({ resolve, reject }));
    return Promise.resolve(otherwise());
  });
  vi.stubGlobal("fetch", fn);
  return { fn, pending };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Y10 — QR cevap kutusu: başarılı gönderim YENİ taslağı silmez", () => {
  const box = () => screen.getByPlaceholderText(/Misafire yanıt yaz/) as HTMLTextAreaElement;

  it("🚨 A gönderilirken B yazıldı → A başarılı → kutuda B kalır", async () => {
    const { pending } = deferredFetch((_u, i) => i?.method === "POST", () => json(200, {}));
    render(<GuestChatReply conversationId="c1" />);
    fireEvent.change(box(), { target: { value: "A mesajı" } });
    fireEvent.click(screen.getByRole("button", { name: "Yanıtla" }));
    fireEvent.change(box(), { target: { value: "B taslağı" } });
    await act(async () => pending[0].resolve(json(200, {})));
    await waitFor(() => expect(box().value).toBe("B taslağı")); // ⬅️ ARIZADA ""
  });

  it("KONTROL: araya yazılmazsa başarılı gönderim kutuyu boşaltır", async () => {
    const { pending } = deferredFetch((_u, i) => i?.method === "POST", () => json(200, {}));
    render(<GuestChatReply conversationId="c1" />);
    fireEvent.change(box(), { target: { value: "A mesajı" } });
    fireEvent.click(screen.getByRole("button", { name: "Yanıtla" }));
    await act(async () => pending[0].resolve(json(200, {})));
    await waitFor(() => expect(box().value).toBe(""));
  });
});

describe("Y10 — gelen kutusu yazma alanı: başarılı gönderim YENİ taslağı silmez", () => {
  const props = {
    conversationId: "conv-1",
    messages: [{ id: "m1", direction: "inbound", body: "Merhaba", createdAt: new Date("2026-01-01T10:00:00Z"), senderName: "Ada" }],
    status: "new",
    priority: "standard",
    propertyId: "prop-1",
    templateVars: {},
    canReply: true,
  } as unknown as React.ComponentProps<typeof ConversationThread>;
  const area = () => screen.getByPlaceholderText(/Cevabınızı yazın/) as HTMLTextAreaElement;

  it("🚨 A gönderilirken B yazıldı → A başarılı → alanda B kalır", async () => {
    const { pending } = deferredFetch((u) => u.endsWith("/reply"), () => json(200, []));
    render(<ConversationThread {...props} />);
    fireEvent.change(area(), { target: { value: "A cevabı" } });
    fireEvent.click(screen.getByRole("button", { name: /^Gönder$/ }));
    fireEvent.change(area(), { target: { value: "B taslağı" } });
    await act(async () => pending[0].resolve(json(200, { id: "x" })));
    await waitFor(() => expect(area().value).toBe("B taslağı"));
  });

  it("KONTROL: araya yazılmazsa alan boşalır", async () => {
    const { pending } = deferredFetch((u) => u.endsWith("/reply"), () => json(200, []));
    render(<ConversationThread {...props} />);
    fireEvent.change(area(), { target: { value: "A cevabı" } });
    fireEvent.click(screen.getByRole("button", { name: /^Gönder$/ }));
    await act(async () => pending[0].resolve(json(200, { id: "x" })));
    await waitFor(() => expect(area().value).toBe(""));
  });
});

describe("U27 / U28 — misafir sohbeti", () => {
  beforeEach(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });
  const input = () => screen.getByPlaceholderText("Sorunuzu yazın…") as HTMLTextAreaElement;

  it("🚨 U27: A gönderilirken B yazıldı → A hata aldı → alanda B kalır", async () => {
    const { pending } = deferredFetch((_u, i) => i?.method === "POST", () => json(200, { open: true, messages: [] }));
    render(<GuestChat token="tok-u27" />);
    await act(async () => Promise.resolve());
    fireEvent.change(input(), { target: { value: "A sorusu" } });
    fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
    fireEvent.change(input(), { target: { value: "B sorusu" } });
    await act(async () => pending[0].resolve(json(500, { error: "x" })));
    await waitFor(() => expect(input().value).toBe("B sorusu")); // ⬅️ ARIZADA "A sorusu"
  });

  it("KONTROL (U27): araya yazılmazsa gönderilemeyen metin geri gelir", async () => {
    const { pending } = deferredFetch((_u, i) => i?.method === "POST", () => json(200, { open: true, messages: [] }));
    render(<GuestChat token="tok-u27b" />);
    await act(async () => Promise.resolve());
    fireEvent.change(input(), { target: { value: "A sorusu" } });
    fireEvent.click(screen.getByRole("button", { name: "Gönder" }));
    await act(async () => pending[0].resolve(json(500, { error: "x" })));
    await waitFor(() => expect(input().value).toBe("A sorusu"));
  });

  it("🚨 U28: daha yeni isteğin 200/açık cevabından SONRA gelen eski 404 sohbeti KAPATMAZ, sorgulama sürer", async () => {
    vi.useFakeTimers();
    let gets = 0;
    const first: Deferred[] = [];
    const fn = vi.fn((_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") !== "GET") return Promise.resolve(json(200, {}));
      gets += 1;
      if (gets === 1) return new Promise<Response>((resolve, reject) => first.push({ resolve, reject }));
      return Promise.resolve(json(200, { open: true, messages: [] }));
    });
    vi.stubGlobal("fetch", fn);
    render(<GuestChat token="tok-u28" />);
    await act(async () => {
      vi.advanceTimersByTime(5_000); // ikinci istek → 200 açık
      await Promise.resolve();
    });
    await act(async () => first[0].resolve(json(404, {}))); // eski istek şimdi 404 ile döner
    expect(screen.queryByPlaceholderText("Sorunuzu yazın…")).not.toBeNull(); // ⬅️ ARIZADA kapanış ekranı
    const before = gets;
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(gets).toBeGreaterThan(before);
  });

  it("KONTROL (U28): en son istek 404 dönerse sohbet kapanır ve sorgulama durur", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(() => Promise.resolve(json(404, {})));
    vi.stubGlobal("fetch", fn);
    render(<GuestChat token="tok-u28b" />);
    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());
    expect(screen.queryByPlaceholderText("Sorunuzu yazın…")).toBeNull();
    const before = fn.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(fn.mock.calls.length).toBe(before);
  });
});
