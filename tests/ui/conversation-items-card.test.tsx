// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// "Açık işler" kartı (Codex 11-17 E4 + H8): rozet açık işlerin TOPLAMINDAN; okuma düştüyse kart "iş yok" gibi KAYBOLMAZ — yüklenemedi
// durumunu taşır. Gerçekten öğe yoksa kart bugünkü gibi hiç çizilmez.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ConversationItemsCard, type ConversationItemRow } from "@/components/inbox/conversation-items-card";

afterEach(() => {
  cleanup();
});

const row = (id: string, open: boolean): ConversationItemRow => ({
  id,
  kindLabel: "Fatura / ödeme",
  statusLabel: open ? "Size bırakıldı" : "Tamamlandı",
  tone: open ? "warning" : "success",
  open,
  at: "1 Oca 10:00",
});

describe("ConversationItemsCard", () => {
  it("🚨 okuma düştü (loadFailed) → kart görünür ve yüklenemedi durumunu taşır; satır / düğme yok", () => {
    render(<ConversationItemsCard conversationId="c1" items={[]} openTotal={0} loadFailed canManage />);
    const card = screen.getByTestId("conversation-items");
    expect(card.getAttribute("data-load-failed")).toBe("true");
    expect(screen.queryByText("Bitti olarak işaretle")).toBeNull();
  });

  it("aşırı uygulama: öğe yok + okuma sağlam → kart çizilmez (bugünkü davranış)", () => {
    const { container } = render(<ConversationItemsCard conversationId="c1" items={[]} openTotal={0} canManage />);
    expect(container.innerHTML).toBe("");
  });

  it("rozet açık işlerin TOPLAMINI gösterir (görünen satırlardan sayılmaz)", () => {
    render(<ConversationItemsCard conversationId="c1" items={[row("a", true), row("b", false)]} openTotal={3} canManage />);
    const card = screen.getByTestId("conversation-items");
    expect(card.getAttribute("data-load-failed")).toBeNull();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("açık iş kalmadıysa rozet yok", () => {
    render(<ConversationItemsCard conversationId="c1" items={[row("b", false)]} openTotal={0} canManage />);
    expect(screen.queryByText("0")).toBeNull();
  });
});
