import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/hospitable", () => ({ sendMessage: vi.fn() }));

import { sendMessage } from "@/lib/hospitable";
import { sendOnChannel } from "@/lib/messaging";

const mockHospitable = vi.mocked(sendMessage);

describe("sendOnChannel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes Hospitable-backed conversations (externalReservationId) to Hospitable", async () => {
    mockHospitable.mockResolvedValue({ ok: true, id: "1" });

    const outcome = await sendOnChannel(
      { channel: "airbnb", guestIdentifier: "Alex", externalReservationId: "res-1" },
      "Merhaba",
    );

    expect(outcome.ok).toBe(true);
    // Third arg is the per-org token (undefined here → env fallback in the client).
    // Fourth arg pins SINGLE-SHOT delivery: a non-idempotent POST must never be
    // client-retried on a 5xx/timeout (that re-opens the in-fetch duplicate window);
    // the caller's claim-then-send owns the ambiguous outcome. Parity with the outbox.
    expect(mockHospitable).toHaveBeenCalledWith("res-1", "Merhaba", undefined, { retries: 0 });
  });

  it("is a no-op for manual threads with nothing to deliver", async () => {
    const outcome = await sendOnChannel({ channel: "manual", guestIdentifier: "Ali" }, "Not");

    expect(outcome).toEqual({ ok: true, skipped: true });
    expect(mockHospitable).not.toHaveBeenCalled();
  });

  it("NEVER posts an internal qr-chat thread to Hospitable (no return channel) — H1", async () => {
    const outcome = await sendOnChannel(
      { channel: "chat", guestIdentifier: "QR Misafir", externalReservationId: "qr-chat:prop-1" },
      "Size yardımcı olayım",
    );

    expect(outcome).toEqual({ ok: true, skipped: true });
    expect(mockHospitable).not.toHaveBeenCalled();
  });

  it("propagates a failure from the underlying transport", async () => {
    mockHospitable.mockResolvedValue({ ok: false, error: "429" });

    const outcome = await sendOnChannel(
      { channel: "airbnb", guestIdentifier: "Alex", externalReservationId: "res-1" },
      "Merhaba",
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("429");
  });
});
