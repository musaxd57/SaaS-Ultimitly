// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { AutoReplyTestButton } from "@/components/inbox/auto-reply-test-button";

// Codex 07-24 #8: the auto-reply preview modal had role="dialog" but none of the
// modal CONTRACT — Escape close, initial focus, focus trap/restore, body
// scroll-lock. Mirrors the mobile drawer's pattern (app-shell-drawer.test.tsx).

function stubPreviewFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: true, previews: [] }), { status: 200 })),
  );
}

describe("AutoReplyTestButton — modal sözleşmesi", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    document.body.style.overflow = "";
  });

  it("açılınca dialog + body scroll-lock; Escape kapatır, scroll geri gelir, focus tetikleyen butona döner", async () => {
    stubPreviewFetch();
    render(<AutoReplyTestButton />);
    const trigger = screen.getByRole("button", { name: /Oto-yanıt testi/ });
    trigger.focus();
    await act(async () => {
      fireEvent.click(trigger);
    });
    const dialog = await screen.findByRole("dialog", { name: "Oto-yanıt testi (önizleme)" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden"); // arkaplan kilitli
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe(""); // kilit kalktı
    expect(document.activeElement).toBe(trigger); // focus restore
    vi.unstubAllGlobals();
  });

  it("Tab focus-trap: son odaklanabilirden ileri Tab ilk öğeye sarar (arkaplana düşmez)", async () => {
    stubPreviewFetch();
    render(<AutoReplyTestButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Oto-yanıt testi/ }));
    });
    const dialog = await screen.findByRole("dialog");
    const closeBtn = screen.getByRole("button", { name: "Kapat" });
    // Tek odaklanabilir öğe "Kapat" — ondan ileri Tab yine onda kalmalı (wrap).
    closeBtn.focus();
    await act(async () => {
      fireEvent.keyDown(window, { key: "Tab" });
    });
    expect(dialog.contains(document.activeElement)).toBe(true); // trap içinde
    vi.unstubAllGlobals();
  });
});
