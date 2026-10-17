// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// HAZIR TASLAK paneli (kurucu 09-26, "Otomatik hazır dursun"): konuşma açılınca kayıtlı taslak öneri panelinde hazır
// durur ("yüklem var, argüman yok" sınıfı — sunucunun verdiği taslak panele BAĞLI mı). Güven rozeti yerine "Hazır taslak ·
// gönderilmedi"; müsaitlik uyarısı nötr cümleyle; kapatılan taslak 30 sn'lik yenilemede geri gelmez; "AI öner"in zengin
// sonucu aynı mesajın kayıtlı özetiyle ezilmez; yeni mesajın taslağı gelirse panel onu gösterir.
// ---------------------------------------------------------------------------

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), usePathname: () => "/inbox" }));

import { ConversationThread } from "@/components/inbox/conversation-thread";

type Props = React.ComponentProps<typeof ConversationThread>;
const baseProps = {
  conversationId: "conv-1",
  messages: [{ id: "m1", direction: "inbound", body: "IBAN'ınızı atar mısınız?", createdAtLabel: "10:00", senderName: "Ada" }],
  status: "new",
  priority: "standard",
  propertyId: "prop-1",
  templateVars: {},
  canReply: true,
} as unknown as Props;

const DRAFT = { messageId: "m1", reply: "Ödeme bilgisini kontrol edip size dönüş yapacağım.", intent: "payment", confidence: 0.9, availabilityCheck: null };

describe("ConversationThread — hazır taslak", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("taslak yoksa panel yok", () => {
    render(<ConversationThread {...baseProps} />);
    expect(screen.queryByTestId("prepared-draft-badge")).toBeNull();
    expect(screen.queryByText(/AI Önerisi/)).toBeNull();
  });

  it("açılışta hazır: metin + 'Hazır taslak · gönderilmedi' (güven rozeti YOK); 'Taslağı kullan' yazma kutusuna koyar, göndermez", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<ConversationThread {...baseProps} initialDraft={DRAFT} />);
    expect(screen.getByTestId("prepared-draft-badge").textContent).toContain("Hazır taslak · gönderilmedi");
    expect(screen.getByText(DRAFT.reply)).toBeTruthy();
    expect(screen.queryByText(/AI bu cevaptan emin/)).toBeNull();
    expect(screen.getByText(/AI bu taslağı sizin için hazırladı; misafire gönderilmedi/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Taslağı kullan/ }));
    expect((screen.getByLabelText("Misafire cevabınız") as HTMLTextAreaElement).value).toBe(DRAFT.reply);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("müsaitlik uyarısı nötr cümleyle (hangi taraf tetikledi ayrılamaz)", () => {
    render(<ConversationThread {...baseProps} initialDraft={{ ...DRAFT, availabilityCheck: "availability_claim" }} />);
    const w = screen.getByTestId("availability-warning");
    expect(w.textContent).toContain("Bu konuşmada tarih, saat ya da müsaitlik konusu var.");
    expect(w.textContent).not.toContain("kesin bir şey söylüyor");
  });

  it("kapatılan taslak yenilemede (aynı mesaj) geri GELMEZ; yeni mesajın taslağı gelir", () => {
    const { rerender } = render(<ConversationThread {...baseProps} initialDraft={DRAFT} />);
    fireEvent.click(screen.getByRole("button", { name: "AI önerisini kapat" }));
    expect(screen.queryByTestId("prepared-draft-badge")).toBeNull();
    rerender(<ConversationThread {...baseProps} initialDraft={{ ...DRAFT }} />);
    expect(screen.queryByTestId("prepared-draft-badge")).toBeNull();
    const next = { ...DRAFT, messageId: "m2", reply: "Yeni taslak." };
    rerender(
      <ConversationThread
        {...baseProps}
        messages={[...(baseProps.messages as object[]), { id: "m2", direction: "inbound", body: "Bir de fatura?", createdAtLabel: "10:05", senderName: "Ada" }] as Props["messages"]}
        initialDraft={next}
      />,
    );
    expect(screen.getByText("Yeni taslak.")).toBeTruthy();
    // Yeni mesajın taslağı da kapatılınca sonraki yenilemede geri GELMEZ.
    fireEvent.click(screen.getByRole("button", { name: "AI önerisini kapat" }));
    rerender(
      <ConversationThread
        {...baseProps}
        messages={[...(baseProps.messages as object[]), { id: "m2", direction: "inbound", body: "Bir de fatura?", createdAtLabel: "10:05", senderName: "Ada" }] as Props["messages"]}
        initialDraft={{ ...next }}
      />,
    );
    expect(screen.queryByText("Yeni taslak.")).toBeNull();
  });

  it("'AI öner'in sonucu aynı mesajın kayıtlı özetiyle EZİLMEZ (sunucu aynı mesaja kaydetti)", async () => {
    const rich = { reply: "Zengin öneri metni.", intent: "payment", confidence: 0.8, risk: null, source: "openai", riskLevel: "none", usedSources: [] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(rich), { status: 200 })));
    const { rerender } = render(<ConversationThread {...baseProps} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /AI cevap öner/ }));
    });
    expect(await screen.findByText("Zengin öneri metni.")).toBeTruthy();
    // 30 sn'lik yenileme: sayfa artık aynı mesajın kayıtlı taslağını veriyor.
    rerender(<ConversationThread {...baseProps} initialDraft={{ ...DRAFT, reply: "Zengin öneri metni (kayıtlı)." }} />);
    expect(screen.getByText("Zengin öneri metni.")).toBeTruthy();
    expect(screen.queryByTestId("prepared-draft-badge")).toBeNull();
  });
});
