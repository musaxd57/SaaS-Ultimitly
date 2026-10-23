// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { GuestChatReply } from "@/components/guest-chats/reply-box";

// The QR guest-chat is a SHARED channel (first-scan device binding is not guest
// authentication). Host replies land in a thread a wrong-first-scanner could read,
// so the reply box must warn the host to keep secrets (door code / Wi-Fi) out of it
// and use the OTA message instead. Lock that warning in.
describe("GuestChatReply — shared-channel warning", () => {
  afterEach(() => cleanup());

  it("warns the host not to put door codes / Wi-Fi / personal data in the shared channel", () => {
    render(<GuestChatReply conversationId="c1" />);
    expect(screen.getByText(/paylaşılan/i)).toBeTruthy();
    expect(screen.getByText(/Kapı kodu, Wi-Fi şifresi/i)).toBeTruthy();
    expect(screen.getByText(/Airbnb\/Booking mesajından/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 🚨 ENTER = GÖNDER (kurucu, 2026-09-11: "qr sohbetlerinde bu kısımda entera
// basınca atmıyor illa tıklamam lazım entera basıncada atsın").
//
// ÖLÇÜLEN ASİMETRİ: bu davranış ürünün HALKA AÇIK misafir yüzeyinde vardı
// (`components/guest-chat/guest-chat.tsx`) ama ödeyen müşterinin kullandığı
// host yüzeyinde YOKTU ve hiçbir test Enter davranışını pinlemiyordu.
// ---------------------------------------------------------------------------
describe("GuestChatReply — klavye", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("🚨 Enter GÖNDERİR", async () => {
    const user = userEvent.setup();
    render(<GuestChatReply conversationId="c1" />);
    const box = screen.getByPlaceholderText(/Enter gönderir/i);
    await user.type(box, "merhaba");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("/api/guest-chats/c1/reply");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ body: "merhaba" });
  });

  it("🚨 Shift+Enter GÖNDERMEZ (yeni satır) — aşırı uygulama kontrolü", async () => {
    const user = userEvent.setup();
    render(<GuestChatReply conversationId="c1" />);
    const box = screen.getByPlaceholderText(/Enter gönderir/i);
    await user.type(box, "birinci");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(box, "ikinci");
    expect(fetch).not.toHaveBeenCalled();
    expect((box as HTMLTextAreaElement).value).toContain("\n");
  });

  it("boş kutuda Enter hiçbir şey göndermez", async () => {
    const user = userEvent.setup();
    render(<GuestChatReply conversationId="c1" />);
    screen.getByPlaceholderText(/Enter gönderir/i).focus();
    await user.keyboard("{Enter}");
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 🚨 AI'IN SUSACAĞI ÖNCEDEN SÖYLENİR (kurucu, 09-11: "host QR'da tek 'merhaba'
// yazarsa AI o konaklama boyunca susuyor — yazma kutusu bunu önceden
// söylemiyor. bu ne alaka aq onu anlamadım düzelt").
//
// Davranış DEĞİŞMEDİ (devir hâlâ host'un açık kararına bağlı ve süresiz);
// değişen şey, kararın BEDELİNİN karar ANINDA söylenmesi. O cümle üründe
// VARDI ama yalnız `resume-ai-button` üzerinde — yani AI ZATEN sustuktan SONRA.
// ---------------------------------------------------------------------------
describe("GuestChatReply — AI susma uyarısı", () => {
  afterEach(() => cleanup());

  it("🚨 AI henüz susmamışken uyarı GÖRÜNÜR", () => {
    render(<GuestChatReply conversationId="c1" />);
    expect(screen.getByText(/AI bu sohbette susar/i)).toBeTruthy();
  });

  it("AI ZATEN susmuşken uyarı GÖRÜNMEZ (bilgi tekrarı değil) — aşırı uygulama kontrolü", () => {
    render(<GuestChatReply conversationId="c1" aiPaused />);
    expect(screen.queryByText(/AI bu sohbette susar/i)).toBeNull();
    // Anti-vakum: bileşen yine de çiziliyor (koşul kutuyu komple silmedi).
    expect(screen.getByText(/paylaşılan/i)).toBeTruthy();
  });
});
