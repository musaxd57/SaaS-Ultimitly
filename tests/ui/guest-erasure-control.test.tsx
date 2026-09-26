// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { GuestErasureControl } from "@/components/properties/guest-erasure-control";

// Copy pins (Codex): the control must (a) use deletion/masking language and NEVER
// claim technical "anonimleştirme" (Regulation art. 10 is a higher bar than what
// the mask does), (b) state the m.13 deadline correctly ("en geç 30 gün içinde
// sonuçlandırılır" — not a vague "30 gün"), and (c) stay honest that the
// channel's copy is not ours to delete.
describe("GuestErasureControl — legally-pinned copy", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ scope: { conversations: 1, inboundMessages: 3, outboundMessages: 2, tombstoneKeys: 4 } }),
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("confirm step: deletion/masking wording, correct 30-day sentence, channel-copy honesty — and NO 'anonimleştir' claim", async () => {
    render(<GuestErasureControl reservationId="res-1" initialErased={false} />);
    fireEvent.click(screen.getByRole("button", { name: /KVKK: misafiri kalıcı sil/i }));

    expect(await screen.findByText(/kalıcı olarak silinir \(maskelenir/i)).toBeTruthy();
    expect(screen.getByText(/en geç 30 gün içinde sonuçlandırılır \(KVKK m\.13\)/i)).toBeTruthy();
    expect(screen.getByText(/Airbnb\/Hospitable.*Lixus silemez/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Evet, kalıcı olarak sil/i })).toBeTruthy();
    // The legally-loaded word must not appear anywhere in the flow.
    expect(screen.queryByText(/anonimleştir/i)).toBeNull();
  });

  it("done state: reports deletion (masking), not anonymization", () => {
    render(<GuestErasureControl reservationId="res-1" initialErased={true} />);
    expect(screen.getByText(/kalıcı olarak silindi \(maskelendi/i)).toBeTruthy();
    expect(screen.queryByText(/anonimleştir/i)).toBeNull();
  });
});
