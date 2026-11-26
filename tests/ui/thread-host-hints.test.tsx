// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// UX incelemesi 10-21 (ev sahibi ekranı):
//  P — "AI cevap öner" Ayarlar'daki yanıt tonuyla başlar (eskiden her konuşmada "Sıcak"; otomatik cevap ise kayıtlı tonu kullanıyordu).
//  F — "Sorunlu" konuşmada yapay zekâ cevap göndermez; ekran bunu ve nasıl açılacağını söyler.

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), usePathname: () => "/inbox" }));

import { ConversationThread } from "@/components/inbox/conversation-thread";
import { replyToneOrWarm } from "@/lib/constants";

const baseProps = {
  conversationId: "conv-1",
  messages: [{ id: "m1", direction: "inbound", body: "Wifi şifresi nedir?", createdAt: new Date("2026-01-01T10:00:00Z"), senderName: "Ada" }],
  status: "new",
  priority: "standard",
  propertyId: "prop-1",
  templateVars: {},
  canReply: true,
} as unknown as React.ComponentProps<typeof ConversationThread>;

describe("konuşma ekranı — ev sahibi ipuçları", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("P: ton seçimi kayıtlı tonla başlar ve öneri isteği o tonla gider", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ error: "x" }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ConversationThread {...baseProps} defaultTone="formal" />);
    expect((screen.getByLabelText("Ton") as HTMLSelectElement).value).toBe("formal");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /AI cevap öner/ }));
    });
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/ai-suggest"))!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ tone: "formal" });
  });

  it("P: ton verilmezse 'Sıcak'; kayıtlı değer bozuksa da 'Sıcak'", () => {
    render(<ConversationThread {...baseProps} />);
    expect((screen.getByLabelText("Ton") as HTMLSelectElement).value).toBe("warm");
    expect(replyToneOrWarm("luxury")).toBe("luxury");
    expect(replyToneOrWarm("bogus")).toBe("warm");
    expect(replyToneOrWarm(null)).toBe("warm");
  });

  it("F: Sorunlu konuşmada ipucu görünür, diğer durumlarda görünmez", () => {
    render(<ConversationThread {...baseProps} status="problem" />);
    expect(screen.getByText(/Sorunlu konuşmada yapay zekâ cevap göndermez/)).toBeTruthy();
    cleanup();
    render(<ConversationThread {...baseProps} status="answered" />);
    expect(screen.queryByText(/Sorunlu konuşmada yapay zekâ cevap göndermez/)).toBeNull();
  });
});
