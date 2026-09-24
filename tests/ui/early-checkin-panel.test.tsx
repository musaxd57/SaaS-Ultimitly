// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// DOĞRULANMIŞ ERKEN GİRİŞ — host paneli (09-24). "AI cevap öner" rotasının `earlyCheckin` alanı panele BAĞLI mı
// ("yüklem var, argüman yok" sınıfı): kontrol satırları, yalnız onaylanabilirken hazır cevap + "Bu cevabı kullan"
// (gönderim YOK, yazma kutusuna koyar), erken giriş olmayan istekte panel yok.
// ---------------------------------------------------------------------------

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), usePathname: () => "/inbox" }));

import { ConversationThread } from "@/components/inbox/conversation-thread";

const baseProps = {
  conversationId: "conv-1",
  messages: [{ id: "m1", direction: "inbound", body: "Could we check in at 13:00?", createdAt: new Date("2026-10-14T08:38:00Z"), senderName: "Ada" }],
  status: "new",
  priority: "standard",
  propertyId: "prop-1",
  templateVars: {},
  canReply: true,
} as unknown as React.ComponentProps<typeof ConversationThread>;

const DRAFT = "Hello, the apartment is ready — you can check in from 13:00. The early check-in fee is €30.";

function suggestion(earlyCheckin: Record<string, unknown> | null) {
  return {
    reply: "Thanks! I'll check with the host and get back to you.",
    intent: "early_checkin",
    confidence: 0.9,
    riskLevel: "none",
    availabilityCheck: "availability_unconfirmed",
    earlyCheckin,
  };
}

const FACTS = { arrivalToday: true, requestedTime: "13:00", previousCheckout: "11:00", readiness: "ready", otherOverlaps: 0, previousNightVerifiedVacant: false };

async function openSuggestion(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
  render(<ConversationThread {...baseProps} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /AI cevap öner/ }));
  });
}

describe("ConversationThread — erken giriş kontrol paneli", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("onaylanabilir: kontrol satırları + hazır cevap; 'Bu cevabı kullan' yazma kutusuna koyar, GÖNDERMEZ", async () => {
    await openSuggestion(
      suggestion({ status: "approvable", failed: [], approvedTime: "13:00", fee: { amount: 30, currency: "EUR" }, mode: "draft", draft: DRAFT, facts: FACTS }),
    );
    const panel = await screen.findByTestId("early-checkin-panel");
    expect(panel.textContent).toContain("İstenen saat: 13:00");
    expect(panel.textContent).toContain("Önceki misafirin beklenen çıkışı: 11:00");
    expect(panel.textContent).toContain("Temizlik bitti olarak işaretlendi.");
    expect(screen.getByTestId("early-checkin-draft").textContent).toContain(DRAFT);
    const fetchCalls = vi.mocked(fetch).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /Bu cevabı kullan/ }));
    expect((screen.getByLabelText("Misafire cevabınız") as HTMLTextAreaElement).value).toBe(DRAFT);
    expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCalls);
  });

  it("onaylanabilir ama uyarılı (ör. başka güne işaret): 'Kontroller uygun' DENMEZ; hazır cevap uyarıyla birlikte", async () => {
    await openSuggestion(
      suggestion({ status: "approvable", failed: ["day_unverified"], approvedTime: "13:00", fee: null, mode: "auto", draft: DRAFT, facts: FACTS }),
    );
    const panel = await screen.findByTestId("early-checkin-panel");
    expect(panel.textContent).toContain('Mesajda başka bir güne işaret var (ör. "yarın"); günü kontrol edin.');
    expect(panel.textContent).not.toContain("Kontroller uygun");
    expect(screen.getByTestId("early-checkin-draft").textContent).toContain("yukarıdaki uyarıları kontrol edip gönderin");
  });

  it("insana kalan: düşen kontrol ne yapılacağını söyler; hazır cevap YOK", async () => {
    await openSuggestion(
      suggestion({ status: "needs_host", failed: ["not_ready"], approvedTime: null, fee: null, mode: "auto", draft: null, facts: { ...FACTS, readiness: "not_ready" } }),
    );
    const panel = await screen.findByTestId("early-checkin-panel");
    expect(panel.textContent).toContain("Temizlik henüz bitti olarak işaretlenmedi.");
    expect(screen.queryByTestId("early-checkin-draft")).toBeNull();
  });

  it("erken giriş olmayan istek (ya da alan yok) → panel çizilmez", async () => {
    await openSuggestion(suggestion({ status: "not_early", failed: [], approvedTime: null, fee: null, mode: "auto", draft: null, facts: FACTS }));
    await screen.findByText(/I'll check with the host/);
    expect(screen.queryByTestId("early-checkin-panel")).toBeNull();
    cleanup();
    await openSuggestion(suggestion(null));
    await screen.findByText(/I'll check with the host/);
    expect(screen.queryByTestId("early-checkin-panel")).toBeNull();
  });
});
