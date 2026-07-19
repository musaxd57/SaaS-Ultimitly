// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { TimezoneForm } from "@/components/settings/timezone-form";

// Representative dirty-gating check: a settings "Kaydet" is disabled until a field
// actually changes, and disables again after a successful save (baseline resets).
describe("settings save buttons are dirty-gated", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  });
  afterEach(() => cleanup());

  it("TimezoneForm: Kaydet disabled initially → enabled on change → disabled after save", async () => {
    render(<TimezoneForm initial="Europe/Istanbul" />);
    const btn = screen.getByRole("button", { name: /Kaydet/i }) as HTMLButtonElement;
    const select = screen.getByLabelText(/Saat dilimi/i) as HTMLSelectElement;

    // No change yet → nothing to save.
    expect(btn.disabled).toBe(true);

    // Pick a different zone → the button wakes up.
    fireEvent.change(select, { target: { value: "Europe/London" } });
    expect(btn.disabled).toBe(false);

    // Save succeeds → the current value becomes the new baseline → disabled again.
    fireEvent.click(btn);
    await waitFor(() => expect(btn.disabled).toBe(true));
    expect(fetch).toHaveBeenCalledOnce();

    // Changing again re-enables it.
    fireEvent.change(select, { target: { value: "America/New_York" } });
    expect(btn.disabled).toBe(false);
  });
});
