// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { AutoReplyToggle } from "@/components/inbox/auto-reply-toggle";

describe("AutoReplyToggle (UI)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });
  afterEach(() => cleanup());

  it("shows the current state and flips on a successful PATCH", async () => {
    render(<AutoReplyToggle field="autoWelcome" label="Otomatik karşılama" enabled={false} />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toContain("Kapalı");

    fireEvent.click(btn);

    await waitFor(() => expect(btn.textContent).toContain("Açık"));
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/settings");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ autoWelcome: true });
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps its state and alerts the user when the PATCH fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    vi.stubGlobal("alert", vi.fn());
    render(<AutoReplyToggle field="autoCheckout" label="Otomatik çıkış" enabled={true} />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toContain("Açık");

    fireEvent.click(btn);

    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(btn.textContent).toContain("Açık"); // unchanged on failure
  });
});
