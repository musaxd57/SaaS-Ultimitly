// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Sohbet ekranı penceresi (kurucu 11-26 sabah, K2-S) — İSTEMCİ: "Daha eski mesajları göster" listenin ÜSTÜNDE, yalnız sunucu adres verince;
// "AI cevap öner" sonucunun ait olduğu mesaj, son misafir mesajı pencerenin DIŞINDA kalsa da sunucunun verdiği kimlikten (yenilemede
// kayıtlı taslak "AI öner" sonucunun üstüne yazılmaz — pencereden önceki davranışla aynı).
// ---------------------------------------------------------------------------

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), usePathname: () => "/inbox" }));

import { ConversationThread } from "@/components/inbox/conversation-thread";

type Props = React.ComponentProps<typeof ConversationThread>;
const baseProps = {
  conversationId: "conv-1",
  messages: [
    { id: "m2", direction: "outbound", body: "Otopark binanın arkasında.", createdAtLabel: "10:01", senderName: "Ev sahibi", authorType: "host" },
    { id: "m3", direction: "outbound", body: "Giriş saati 15:00.", createdAtLabel: "10:02", senderName: "Ev sahibi", authorType: "host" },
  ],
  status: "new",
  priority: "standard",
  propertyId: "prop-1",
  templateVars: {},
  canReply: true,
} as unknown as Props;

const LABEL = "Daha eski mesajları göster";

describe("konuşma ekranı — daha eski mesajlar", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("adres verilince bağlantı listenin üstünde, ilk mesajdan ÖNCE", () => {
    render(<ConversationThread {...baseProps} olderHref="/inbox/conv-1?eski=1" />);
    const link = screen.getByRole("link", { name: LABEL });
    expect(link.getAttribute("href")).toBe("/inbox/conv-1?eski=1");
    const first = screen.getByText("Otopark binanın arkasında.");
    expect(link.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("adres yoksa (null / verilmedi) bağlantı yok", () => {
    render(<ConversationThread {...baseProps} olderHref={null} />);
    expect(screen.queryByRole("link", { name: LABEL })).toBeNull();
    cleanup();
    render(<ConversationThread {...baseProps} />);
    expect(screen.queryByRole("link", { name: LABEL })).toBeNull();
  });

  it("son misafir mesajı pencerenin dışında: 'AI öner' sonucu yenilemede aynı mesajın kayıtlı taslağıyla EZİLMEZ", async () => {
    const SUGGESTION = {
      intent: "parking",
      confidence: 0.9,
      reply: "Evet, binanın arkasında ücretsiz otopark var.",
      risk: null,
      priority: "standard",
      source: "openai",
      riskLevel: "none",
      detectedLanguage: "tr",
      usedSources: [],
      missingInfo: [],
      availabilityCheck: null,
      earlyCheckin: null,
      internalSourceCheck: false,
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(SUGGESTION), { status: 200 })));
    const { rerender } = render(<ConversationThread {...baseProps} lastInboundMessageId="m1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /AI cevap öner/ }));
    });
    expect(screen.getByText(SUGGESTION.reply)).toBeTruthy();
    // Sunucu "AI öner" sonucunu son misafir mesajına (m1) kaydetti; 30 sn'lik yenileme o kaydı hazır taslak olarak getirir.
    const PREPARED = { messageId: "m1", reply: "Kayıtlı özet taslak.", intent: "parking", confidence: 0.9, availabilityCheck: null, internalSourceCheck: false };
    rerender(<ConversationThread {...baseProps} lastInboundMessageId="m1" initialDraft={PREPARED} />);
    expect(screen.getByText(SUGGESTION.reply)).toBeTruthy();
    expect(screen.queryByText(PREPARED.reply)).toBeNull();
  });
});
