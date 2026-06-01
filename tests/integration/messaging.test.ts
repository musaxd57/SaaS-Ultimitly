import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/whatsapp", () => ({ waSendText: vi.fn() }));
vi.mock("@/lib/hospitable", () => ({ sendMessage: vi.fn() }));

import { waSendText } from "@/lib/whatsapp";
import { sendMessage } from "@/lib/hospitable";
import { sendOnChannel } from "@/lib/messaging";

const mockWa = vi.mocked(waSendText);
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
    expect(mockHospitable).toHaveBeenCalledWith("res-1", "Merhaba");
    expect(mockWa).not.toHaveBeenCalled();
  });

  it("routes whatsapp conversations to the WhatsApp API", async () => {
    mockWa.mockResolvedValue({ ok: true });

    const outcome = await sendOnChannel(
      { channel: "whatsapp", guestIdentifier: "+905301112233" },
      "Selam",
    );

    expect(outcome.ok).toBe(true);
    expect(mockWa).toHaveBeenCalledWith("+905301112233", "Selam");
    expect(mockHospitable).not.toHaveBeenCalled();
  });

  it("is a no-op for manual threads with nothing to deliver", async () => {
    const outcome = await sendOnChannel({ channel: "manual", guestIdentifier: "Ali" }, "Not");

    expect(outcome).toEqual({ ok: true, skipped: true });
    expect(mockWa).not.toHaveBeenCalled();
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
