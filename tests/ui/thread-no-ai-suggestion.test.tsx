// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// 3d (kurucu 11-11) — YAPAY ZEKÂ ÇALIŞMIYORKEN PANEL. Söz veren hazır cümle ("Talebinizi aldım… en kısa sürede dönüş yapacağım") yerine
// öneri alanında tek satır not görünür ve kutu boş kalır. Model arızası ev sahibinin elindeki önceki taslağı SİLMEZ. Yalnız kayıtlı
// bilgiden kurulan taslak "yapay zekâ emin" diye değil, kontrol edilmesi gerektiği yazılarak gösterilir.
// ---------------------------------------------------------------------------

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), usePathname: () => "/inbox" }));

import { ConversationThread } from "@/components/inbox/conversation-thread";
import { NO_AI_SUGGESTION_TEXT, FALLBACK_DRAFT_BADGE_TEXT } from "@/lib/ui-labels";

const baseProps = {
  conversationId: "conv-1",
  messages: [{ id: "m1", direction: "inbound", body: "Paramı geri istiyorum.", createdAt: new Date("2026-01-01T10:00:00Z"), senderName: "Ada" }],
  status: "new",
  priority: "standard",
  propertyId: "prop-1",
  templateVars: {},
  canReply: true,
} as unknown as React.ComponentProps<typeof ConversationThread>;

const suggestion = (over: Record<string, unknown>) => ({
  intent: "refund",
  confidence: 0.6,
  reply: "",
  risk: null,
  priority: "standard",
  source: "fallback",
  actionSuggestion: null,
  riskLevel: "none",
  detectedLanguage: "tr",
  riskType: null,
  usedSources: [],
  missingInfo: [],
  availabilityCheck: null,
  earlyCheckin: null,
  internalSourceCheck: false,
  ...over,
});
const respond = (body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
const clickSuggest = () =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /AI cevap öner/ }));
  });

describe("konuşma ekranı — yapay zekâ önerisi hazırlanamadığında (3d)", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("metinler: not kurucunun verdiği hâlde; rozet sade (teknik sözcük yok) ve neyin kontrol edileceğini söyler", () => {
    expect(NO_AI_SUGGESTION_TEXT).toBe("Yapay zekâ önerisi şu an hazırlanamadı.");
    expect(FALLBACK_DRAFT_BADGE_TEXT).toBe("Kayıtlı bilgilerinizden hazırlandı — soruya uygunluğunu kontrol edin");
    expect(FALLBACK_DRAFT_BADGE_TEXT).not.toMatch(/model|fallback|yedek/i);
  });

  it("🚨 model yok + taslak boş → not görünür; öneri kartı, 'Taslağı kullan' ve 'Onayla ve gönder' YOK", async () => {
    respond(suggestion({ reply: "" }));
    render(<ConversationThread {...baseProps} />);
    await clickSuggest();
    expect(screen.getByTestId("no-ai-suggestion").textContent).toBe(NO_AI_SUGGESTION_TEXT);
    expect(screen.queryByRole("button", { name: /Taslağı kullan/ })).toBeNull(); // ⬅️ ESKİDE hazır cümleyle birlikte geliyordu
    expect(screen.queryByRole("button", { name: /Onayla ve gönder/ })).toBeNull();
    expect(screen.queryByText(/AI bu cevaptan emin|AI emin değil/)).toBeNull();
  });

  it("🚨 model arızası önceki taslağı SİLMEZ: kayıtlı hazır taslak yerinde kalır, not eklenir", async () => {
    respond(suggestion({ reply: "" }));
    render(<ConversationThread {...baseProps} initialDraft={{ messageId: "m1", reply: "Önceki taslak metni.", intent: "refund", confidence: 0.8, availabilityCheck: null, internalSourceCheck: false }} />);
    expect(screen.getByText("Önceki taslak metni.")).toBeTruthy();
    await clickSuggest();
    expect(screen.getByTestId("no-ai-suggestion")).toBeTruthy();
    expect(screen.getByText("Önceki taslak metni.")).toBeTruthy(); // ⬅️ boş öneri onun yerine geçmedi
    expect(screen.getByRole("button", { name: /Taslağı kullan/ })).toBeTruthy();
  });

  it("yalnız kayıtlı bilgiden kurulan taslak gösterilir ama 'AI emin' rozeti yerine kontrol uyarısı taşır", async () => {
    respond(suggestion({ intent: "wifi", confidence: 0.9, reply: "Merhaba Ada,\n\nWi-Fi bilgileri: Ağ LaleApt, şifre 12345678", usedSources: ["kb:wifi"] }));
    render(<ConversationThread {...baseProps} />);
    await clickSuggest();
    expect(screen.getByText(/Wi-Fi bilgileri: Ağ LaleApt/)).toBeTruthy();
    expect(screen.getByTestId("fallback-draft-badge").textContent).toBe(FALLBACK_DRAFT_BADGE_TEXT);
    expect(screen.queryByText("AI bu cevaptan emin")).toBeNull(); // ⬅️ ESKİDE güven 0,9 diye "emin" yazıyordu
    expect(screen.queryByTestId("no-ai-suggestion")).toBeNull();
  });

  it("KONTROL: modelin cevabı eskisi gibi — güven rozeti var, not yok; modelin BOŞ cevabı 'hazırlanamadı' sayılmaz", async () => {
    respond(suggestion({ source: "openai", intent: "wifi", confidence: 0.9, reply: "Wi-Fi şifresi 12345678." }));
    render(<ConversationThread {...baseProps} />);
    await clickSuggest();
    expect(screen.getByText("AI bu cevaptan emin")).toBeTruthy();
    expect(screen.queryByTestId("no-ai-suggestion")).toBeNull();
    expect(screen.queryByTestId("fallback-draft-badge")).toBeNull();
    cleanup();
    respond(suggestion({ source: "openai", reply: "" }));
    render(<ConversationThread {...baseProps} />);
    await clickSuggest();
    expect(screen.queryByTestId("no-ai-suggestion")).toBeNull();
  });

  const PREPARED = { messageId: "m1", reply: "Önceki taslak metni.", intent: "refund", confidence: 0.8, availabilityCheck: null, internalSourceCheck: false };

  it("🚨 istek REDDEDİLİRSE de önceki taslak kaybolmaz: hata görünür, taslak yerinde", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Günlük AI işlem sınırına ulaşıldı." }), { status: 429 })));
    render(<ConversationThread {...baseProps} initialDraft={PREPARED} />);
    await clickSuggest();
    expect(screen.getByText("Günlük AI işlem sınırına ulaşıldı.")).toBeTruthy();
    expect(screen.getByText("Önceki taslak metni.")).toBeTruthy(); // ⬅️ ESKİDE istek başlarken silinip geri gelmiyordu
    expect(screen.queryByTestId("no-ai-suggestion")).toBeNull(); // hata ≠ "hazırlanamadı" notu
  });

  it("🚨 bağlantı koparsa da önceki taslak kaybolmaz", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    render(<ConversationThread {...baseProps} initialDraft={PREPARED} />);
    await clickSuggest();
    expect(screen.getByText("Bağlantı hatası. Lütfen tekrar deneyin.")).toBeTruthy();
    expect(screen.getByText("Önceki taslak metni.")).toBeTruthy();
  });

  it("KONTROL: istek sürerken konuşma CEVAPLANDIYSA önceki taslak geri konmaz (cevaplanmış mesajın taslağı)", async () => {
    for (const mode of ["rejected", "no-draft"] as const) {
      cleanup();
      let release: (r: Response) => void = () => {};
      vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
      const view = render(<ConversationThread {...baseProps} initialDraft={PREPARED} />);
      await clickSuggest();
      // Başka bir ekip üyesi bu arada cevap yazdı: konuşmanın sonu artık bir cevap.
      const answered = [...(baseProps.messages as unknown as Record<string, unknown>[]), { id: "m2", direction: "outbound", body: "Cevap gitti.", createdAt: new Date("2026-01-01T10:01:00Z"), senderName: "Ekip" }];
      view.rerender(<ConversationThread {...baseProps} messages={answered as unknown as typeof baseProps.messages} initialDraft={null} />);
      await act(async () => {
        release(mode === "rejected" ? new Response(JSON.stringify({ error: "Hata." }), { status: 500 }) : new Response(JSON.stringify(suggestion({ reply: "" })), { status: 200 }));
      });
      expect(screen.queryByText("Önceki taslak metni."), mode).toBeNull();
      expect(screen.queryByRole("button", { name: /Taslağı kullan/ }), mode).toBeNull();
    }
  });

  it("🚨 KONTROL: sunucu kayıtlı taslağı istek sürerken GERİ ÇEKTİYSE (yeni misafir mesajı geldi) eski hazır taslak geri konmaz", async () => {
    for (const mode of ["rejected", "no-draft"] as const) {
      cleanup();
      let release: (r: Response) => void = () => {};
      vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
      const view = render(<ConversationThread {...baseProps} initialDraft={PREPARED} />);
      await clickSuggest();
      // Yeni misafir mesajı geldi: konuşmanın sonu yine misafir (cevap değil), sunucu m1'in taslağını artık vermiyor.
      const more = [...(baseProps.messages as unknown as Record<string, unknown>[]), { id: "m2", direction: "inbound", body: "Bir şey daha soracaktım.", createdAt: new Date("2026-01-01T10:01:00Z"), senderName: "Ada" }];
      view.rerender(<ConversationThread {...baseProps} messages={more as unknown as typeof baseProps.messages} initialDraft={null} />);
      await act(async () => {
        release(mode === "rejected" ? new Response(JSON.stringify({ error: "Hata." }), { status: 500 }) : new Response(JSON.stringify(suggestion({ reply: "" })), { status: 200 }));
      });
      expect(screen.queryByText("Önceki taslak metni."), mode).toBeNull(); // ⬅️ geri konsaydı geçersiz taslak "Onayla ve gönder"e açılırdı
      expect(screen.queryByRole("button", { name: /Onayla ve gönder/ }), mode).toBeNull();
    }
  });

  it("🚨 KONTROL: istek sürerken panele YENİ mesajın hazır taslağı geldiyse üstüne eskisi yazılmaz", async () => {
    let release: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    const view = render(<ConversationThread {...baseProps} initialDraft={PREPARED} />);
    await clickSuggest();
    const more = [...(baseProps.messages as unknown as Record<string, unknown>[]), { id: "m2", direction: "inbound", body: "Bir şey daha soracaktım.", createdAt: new Date("2026-01-01T10:01:00Z"), senderName: "Ada" }];
    view.rerender(
      <ConversationThread {...baseProps} messages={more as unknown as typeof baseProps.messages} initialDraft={{ ...PREPARED, messageId: "m2", reply: "Yeni mesajın taslağı." }} />,
    );
    await act(async () => {
      release(new Response(JSON.stringify({ error: "Hata." }), { status: 500 }));
    });
    expect(screen.getByText("Yeni mesajın taslağı.")).toBeTruthy();
    expect(screen.queryByText("Önceki taslak metni.")).toBeNull();
  });

  it("KONTROL: önceki öneri ev sahibinin kendi 'AI cevap öner' sonucuysa yeni misafir mesajı gelse de geri konur (o öneri yeni mesajla silinmez)", async () => {
    respond(suggestion({ source: "openai", intent: "wifi", confidence: 0.9, reply: "Wi-Fi şifresi 12345678." }));
    const view = render(<ConversationThread {...baseProps} />);
    await clickSuggest();
    expect(screen.getByText("Wi-Fi şifresi 12345678.")).toBeTruthy();
    let release: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    await clickSuggest();
    const more = [...(baseProps.messages as unknown as Record<string, unknown>[]), { id: "m2", direction: "inbound", body: "Bir şey daha soracaktım.", createdAt: new Date("2026-01-01T10:01:00Z"), senderName: "Ada" }];
    view.rerender(<ConversationThread {...baseProps} messages={more as unknown as typeof baseProps.messages} />);
    await act(async () => {
      release(new Response(JSON.stringify({ error: "Hata." }), { status: 500 }));
    });
    expect(screen.getByText("Wi-Fi şifresi 12345678.")).toBeTruthy();
  });

  it("not bir sonraki denemede temizlenir (yeni istek başlarken)", async () => {
    respond(suggestion({ reply: "" }));
    render(<ConversationThread {...baseProps} />);
    await clickSuggest();
    expect(screen.getByTestId("no-ai-suggestion")).toBeTruthy();
    respond(suggestion({ source: "openai", intent: "wifi", confidence: 0.9, reply: "Wi-Fi şifresi 12345678." }));
    await clickSuggest();
    expect(screen.queryByTestId("no-ai-suggestion")).toBeNull();
    expect(screen.getByText("Wi-Fi şifresi 12345678.")).toBeTruthy();
  });
});
