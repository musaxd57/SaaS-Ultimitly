// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TASLAK KULLANIMI İPUCU (kurucu 11-13, taslak ↔ gönderilen metin bağı): istemci sunucuya taslağı NASIL kullandığını söyler — "Onayla ve gönder"
// → approved · "Taslağı kullan" → (düzenle) → Gönder → seeded · elle yazılan → ipucu yok · alan boşaltılırsa ipucu düşer. Metin farkı sunucuda
// ölçülür; ipucu gönderimi değiştirmez. Bugüne kadar "Taslağı kullan" ile düzeltilen cevap "elle yazıldı" görünüyordu (`aiAssisted: false`).
// ---------------------------------------------------------------------------

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), usePathname: () => "/inbox" }));

import { ConversationThread } from "@/components/inbox/conversation-thread";

type Props = React.ComponentProps<typeof ConversationThread>;
const baseProps = {
  conversationId: "conv-1",
  messages: [{ id: "m1", direction: "inbound", body: "Saat kaçta girebiliriz?", createdAtLabel: "10:00", senderName: "Ada" }],
  status: "new",
  priority: "standard",
  propertyId: "prop-1",
  templateVars: {},
  canReply: true,
} as unknown as Props;
const DRAFT = {
  messageId: "m1",
  reply: "Giriş saatimiz 15:00.",
  intent: "check_in",
  confidence: 0.9,
  availabilityCheck: null,
  internalSourceCheck: false,
};

function bodies(): Record<string, unknown>[] {
  return vi
    .mocked(fetch)
    .mock.calls.filter((c) => String(c[0]).endsWith("/reply"))
    .map((c) => JSON.parse(String((c[1] as RequestInit).body)));
}

describe("ConversationThread — taslak kullanımı ipucu", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "out-1" }), { status: 201 })));
  });

  const composer = () => screen.getByLabelText("Misafire cevabınız") as HTMLTextAreaElement;
  const clickSend = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Gönder$/ }));
    });
  };

  it("'Onayla ve gönder' → draftUse: approved", async () => {
    render(<ConversationThread {...baseProps} initialDraft={DRAFT} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Onayla ve gönder/ }));
    });
    expect(bodies()[0]).toMatchObject({ body: DRAFT.reply, aiAssisted: true, draftUse: "approved" });
  });

  it("🚨 'Taslağı kullan' → düzenle → Gönder → draftUse: seeded (aiAssisted yine false — rapor sayımı değişmez)", async () => {
    render(<ConversationThread {...baseProps} initialDraft={DRAFT} />);
    fireEvent.click(screen.getByRole("button", { name: /Taslağı kullan/ }));
    fireEvent.change(composer(), { target: { value: "Giriş saatimiz 14:00." } });
    await clickSend();
    expect(bodies()[0]).toMatchObject({ body: "Giriş saatimiz 14:00.", aiAssisted: false, draftUse: "seeded" });
  });

  it("KONTROL — elle yazılan cevapta ipucu YOK; taslak alanı boşaltılıp yeniden yazılırsa ipucu düşer", async () => {
    render(<ConversationThread {...baseProps} initialDraft={DRAFT} />);
    fireEvent.change(composer(), { target: { value: "Merhaba" } });
    await clickSend();
    expect(bodies()[0]).not.toHaveProperty("draftUse");
    cleanup();
    vi.mocked(fetch).mockClear();
    render(<ConversationThread {...baseProps} initialDraft={DRAFT} />);
    fireEvent.click(screen.getByRole("button", { name: /Taslağı kullan/ }));
    fireEvent.change(composer(), { target: { value: "" } });
    fireEvent.change(composer(), { target: { value: "Bambaşka bir cevap" } });
    await clickSend();
    expect(bodies()[0]).not.toHaveProperty("draftUse");
  });

  it("gönderimden sonra ipucu sıfırlanır: ikinci elle yazılan mesaj 'seeded' taşımaz", async () => {
    render(<ConversationThread {...baseProps} initialDraft={DRAFT} />);
    fireEvent.click(screen.getByRole("button", { name: /Taslağı kullan/ }));
    await clickSend();
    fireEvent.change(composer(), { target: { value: "Ek bilgi" } });
    await clickSend();
    expect(bodies().map((b) => b.draftUse ?? null)).toEqual(["seeded", null]);
  });
});
