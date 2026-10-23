import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// suggestReply must ALWAYS resolve to the deterministic fallback on any OpenAI
// failure (never throw, never leave the guest without a draft) — that behavior
// is unchanged here. What's new: a failure is now also reported (Sentry/alert),
// so a persistently bad key/quota/outage doesn't silently degrade every reply
// with nobody noticing.
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { reportError } from "@/lib/report-error";
import { suggestReply } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";

const mockReportError = vi.mocked(reportError);

const input: SuggestReplyInput = {
  guestMessage: "Wifi şifresi nedir?",
  property: { name: "Galata Loft", checkInTime: "15:00", checkOutTime: "11:00", address: "Galata", city: "İstanbul" },
  reservation: { guestName: "John Smith", arrivalDate: new Date(), departureDate: new Date(), status: "confirmed" },
  knowledgeBase: [],
  tone: "warm",
  language: "tr",
};

describe("suggestReply — OpenAI failure reporting", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    mockReportError.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports a non-OK OpenAI response and still returns the deterministic fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429, statusText: "Too Many Requests" })),
    );
    const result = await suggestReply(input);
    expect(mockReportError).toHaveBeenCalledOnce();
    expect(mockReportError.mock.calls[0][0]).toContain("429");
    // Fallback still answered — the guest is never left without a draft.
    expect(result.source).toBe("fallback");
    expect(result.reply.length).toBeGreaterThan(0);
  });

  it("reports a network/throw failure and still returns the deterministic fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const result = await suggestReply(input);
    expect(mockReportError).toHaveBeenCalledOnce();
    expect(mockReportError.mock.calls[0][0]).toBe("openai-reply");
    expect(result.source).toBe("fallback");
  });

  it("treats a TRUNCATED response (finish_reason=length) as a failure → fallback (never auto-sendable)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ finish_reason: "length", message: { content: '{"intent":"wifi","reply":"Şifre 123' } }],
            }),
          ),
      ),
    );
    const result = await suggestReply(input);
    // source "fallback" (NOT "openai") → the auto-send gate can never ship the
    // cut-off reply, and the failure is reported.
    expect(result.source).toBe("fallback");
    expect(mockReportError).toHaveBeenCalledOnce();
    expect(mockReportError.mock.calls[0][0]).toContain("truncated");
  });

  it("falls back when the model returns invalid/broken JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ finish_reason: "stop", message: { content: '{"intent":"wifi","reply":"Şifre' } }],
            }),
          ),
      ),
    );
    const result = await suggestReply(input);
    expect(result.source).toBe("fallback");
  });

  it("does NOT report anything on a successful OpenAI response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      intent: "wifi",
                      confidence: 0.95,
                      reply: "Şifre: 12345678",
                      risk: null,
                      priority: "standard",
                      actionSuggestion: null,
                      riskLevel: "none",
                      detectedLanguage: "tr",
                      statedCheckoutTime: null,
                    }),
                  },
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const result = await suggestReply(input);
    expect(mockReportError).not.toHaveBeenCalled();
    expect(result.source).toBe("openai");
  });
});
