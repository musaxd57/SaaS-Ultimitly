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

const DRAFT = {
  messageId: "m1",
  reply: "Ödeme bilgisini kontrol edip size dönüş yapacağım.",
  intent: "payment",
  confidence: 0.9,
  availabilityCheck: null,
  internalSourceCheck: false,
};

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

  it("kurucu 10-22: taslak bilginin kaynağını anlatıyorsa ev sahibi uyarıyı görür; anlatmıyorsa uyarı yok", () => {
    render(<ConversationThread {...baseProps} initialDraft={{ ...DRAFT, reply: "Bilgi tabanımda otopark ücretsiz yazıyor.", internalSourceCheck: true }} />);
    expect(screen.getByTestId("internal-source-warning").textContent).toContain("Göndermeden önce o cümleyi çıkarın");
    cleanup();
    render(<ConversationThread {...baseProps} initialDraft={DRAFT} />);
    expect(screen.queryByTestId("internal-source-warning")).toBeNull();
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

  // ---------------------------------------------------------------------------
  // MESAJ M5 (Codex 11-10): geçersizleşen hazır taslak panelde gönderilebilir kalıyordu — sayfa 30 sn'de bir yenilenir, sunucu taslağı artık
  // vermese de (o mesaja cevap gitti) panel eski taslağı "Onayla ve gönder" düğmesiyle tutuyordu.
  // ---------------------------------------------------------------------------
  const withReply = (reply: Record<string, unknown>) =>
    [...(baseProps.messages as object[]), { id: "m-out", direction: "outbound", body: "Hallettik.", createdAtLabel: "10:02", senderName: "Ekip", ...reply }] as Props["messages"];

  it("🚨 M5: o misafir mesajına başka biri cevap verdi (yenilemede taslak yok + yeni giden mesaj) → hazır taslak ve onay düğmesi panelden KALKAR", () => {
    const { rerender } = render(<ConversationThread {...baseProps} initialDraft={DRAFT} />);
    expect(screen.getByText(DRAFT.reply)).toBeTruthy();
    rerender(<ConversationThread {...baseProps} messages={withReply({ authorType: "host" })} initialDraft={null} />);
    expect(screen.queryByText(DRAFT.reply)).toBeNull(); // ⬅️ ESKİDE duruyordu (gönderilebilir)
    expect(screen.queryByTestId("prepared-draft-badge")).toBeNull();
    expect(screen.queryByRole("button", { name: /Onayla ve gönder/ })).toBeNull();
  });

  it("🚨 M5: taslak geçersizleşti ama yeni mesaj yok (sunucu taslağı artık vermiyor) → hazır taslak yine kalkar", () => {
    const { rerender } = render(<ConversationThread {...baseProps} initialDraft={DRAFT} />);
    rerender(<ConversationThread {...baseProps} initialDraft={null} />);
    expect(screen.queryByText(DRAFT.reply)).toBeNull(); // ⬅️ ESKİDE duruyordu
  });

  it("M5: ev sahibinin kendi 'AI cevap öner' sonucu yenilemede (taslak yok, yeni cevap yok) SİLİNMEZ; konuşmaya yeni bir CEVAP gelince kalkar", async () => {
    const rich = { reply: "Zengin öneri metni.", intent: "payment", confidence: 0.8, risk: null, source: "openai", riskLevel: "none", usedSources: [] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(rich), { status: 200 })));
    const { rerender } = render(<ConversationThread {...baseProps} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /AI cevap öner/ }));
    });
    expect(await screen.findByText("Zengin öneri metni.")).toBeTruthy();
    rerender(<ConversationThread {...baseProps} initialDraft={null} />); // 30 sn'lik yenileme, değişiklik yok
    expect(screen.getByText("Zengin öneri metni.")).toBeTruthy();
    // Otomatik şablon mesajı (çıkış hatırlatması) cevap değildir → öneri durur.
    rerender(<ConversationThread {...baseProps} messages={withReply({ id: "m-auto", authorType: "automation" })} initialDraft={null} />);
    expect(screen.getByText("Zengin öneri metni.")).toBeTruthy();
    // Başka bir ekip üyesi cevap verdi → öneri cevaplanmış mesaja ait, kalkar.
    rerender(<ConversationThread {...baseProps} messages={withReply({ authorType: "host" })} initialDraft={null} />);
    expect(screen.queryByText("Zengin öneri metni.")).toBeNull(); // ⬅️ ESKİDE duruyordu
  });

  it("M5: hazır taslağın yerine 'AI cevap öner' sonucu geldiyse, sunucu taslağı sonradan vermese de bu sonuç SİLİNMEZ (yalnız hazır taslak kalkar)", async () => {
    const rich = { reply: "Zengin öneri metni.", intent: "payment", confidence: 0.8, risk: null, source: "openai", riskLevel: "none", usedSources: [] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(rich), { status: 200 })));
    const { rerender } = render(<ConversationThread {...baseProps} initialDraft={DRAFT} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /AI cevap öner/ }));
    });
    expect(await screen.findByText("Zengin öneri metni.")).toBeTruthy();
    rerender(<ConversationThread {...baseProps} initialDraft={null} />);
    expect(screen.getByText("Zengin öneri metni.")).toBeTruthy();
  });

  it("M5: sunucu taslağı geçici olarak vermeyip sonra AYNI taslağı yeniden verirse panel onu yine gösterir (elle kapatılan taslak ise geri gelmez — ↑)", () => {
    const { rerender } = render(<ConversationThread {...baseProps} initialDraft={DRAFT} />);
    rerender(<ConversationThread {...baseProps} initialDraft={null} />);
    expect(screen.queryByText(DRAFT.reply)).toBeNull();
    rerender(<ConversationThread {...baseProps} initialDraft={{ ...DRAFT }} />);
    expect(screen.getByText(DRAFT.reply)).toBeTruthy();
  });

  it("M5: 'AI cevap öner' isteği sürerken konuşmaya bir cevap geldiyse gelen öneri panele KONMAZ (cevaplanmış mesaja ait)", async () => {
    let resolveFetch!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => (resolveFetch = r))));
    const { rerender } = render(<ConversationThread {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /AI cevap öner/ }));
    rerender(<ConversationThread {...baseProps} messages={withReply({ authorType: "host" })} />); // istek sürerken başka biri cevapladı
    await act(async () => {
      resolveFetch(new Response(JSON.stringify({ reply: "Geç gelen öneri.", intent: "payment", confidence: 0.8, risk: null, source: "openai" }), { status: 200 }));
    });
    expect(screen.queryByText("Geç gelen öneri.")).toBeNull();
  });

  it("KONTROL (M5): yeni MİSAFİR mesajı gelince eldeki öneri silinmez (yeni taslak gelirse panel onu gösterir)", () => {
    const { rerender } = render(<ConversationThread {...baseProps} initialDraft={DRAFT} />);
    rerender(
      <ConversationThread
        {...baseProps}
        messages={[...(baseProps.messages as object[]), { id: "m2", direction: "inbound", body: "Bir de fatura?", createdAtLabel: "10:05", senderName: "Ada" }] as Props["messages"]}
        initialDraft={DRAFT}
      />,
    );
    expect(screen.getByText(DRAFT.reply)).toBeTruthy();
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
