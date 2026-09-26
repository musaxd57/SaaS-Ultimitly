// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { AutomationPrefsForm } from "@/components/settings/automation-prefs-form";

const PROPS = {
  disclosure: true,
  holdHours: 12,
  holdingAck: false,
  closingReply: false,
  closingText: "",
  lateCheckoutOffer: "",
  taskFromMessage: false,
  supplyRequest: false,
};

describe("AutomationPrefsForm — empty hold-hours guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  });
  afterEach(() => cleanup());

  it("a CLEARED hold-hours box is rejected client-side — Number('')=0 must never be sent", async () => {
    render(<AutomationPrefsForm {...PROPS} />);
    const input = screen.getByLabelText(/İnsan devri bekleme süresi/i) as HTMLInputElement;

    // Clear the field (dirty vs baseline "12" → Kaydet enables) and submit.
    fireEvent.change(input, { target: { value: "" } });
    const btn = screen.getByRole("button", { name: /Kaydet/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);

    // Guarded: a clear error, and NO request left the browser (a silent 0-hour
    // hold would make the AI resume immediately after a human-handoff request).
    expect(await screen.findByText(/boş olamaz/i)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("an explicit 0 is still a legal choice and IS sent", async () => {
    render(<AutomationPrefsForm {...PROPS} />);
    const input = screen.getByLabelText(/İnsan devri bekleme süresi/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /Kaydet/i }));
    expect(fetch).toHaveBeenCalledOnce();
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(String((init as RequestInit).body)).handoffHoldHours).toBe(0);
  });
});
