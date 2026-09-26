import { describe, it, expect } from "vitest";
import { isDefinitiveSendFailure } from "@/lib/messaging";

// Single source of truth for the claim-then-send rollback decision, shared by the
// manual-reply route and the proactive lifecycle senders (welcome/check-in/checkout).
// DEFINITIVE (nothing delivered → safe to un-claim + retry) vs AMBIGUOUS (may have
// delivered → must NOT re-POST, or the guest gets a duplicate).
describe("isDefinitiveSendFailure", () => {
  it("DEFINITIVE for a provider 4xx rejection — the request was refused, nothing delivered", () => {
    for (const e of [
      "HTTP 400 Bad Request",
      "HTTP 401 Unauthorized",
      "HTTP 403 Forbidden",
      "HTTP 404 Not Found",
      "HTTP 409 Conflict",
      "HTTP 422 Unprocessable Entity",
      "HTTP 429 Too Many Requests", // rate-limited = refused = didn't deliver
      "Hospitable send failed: HTTP 400 invalid recipient",
    ]) {
      expect(isDefinitiveSendFailure(e), e).toBe(true);
    }
  });

  it("AMBIGUOUS for 408 / any 5xx / network / abort / unknown — the message MAY have delivered", () => {
    for (const e of [
      "HTTP 408 Request Timeout", // timeout: the POST may have landed
      "HTTP 500 Internal Server Error",
      "HTTP 502 Bad Gateway",
      "HTTP 503 Service Unavailable",
      "HTTP 504 Gateway Timeout",
      "network error",
      "fetch failed",
      "The operation was aborted",
      "ETIMEDOUT",
      "",
      undefined,
      null,
    ]) {
      expect(isDefinitiveSendFailure(e), String(e)).toBe(false);
    }
  });

  it("does not misread a 4xx-looking number that is not an HTTP status", () => {
    // No "HTTP " prefix → not classified as a definitive HTTP rejection.
    expect(isDefinitiveSendFailure("reservation 404 not linked")).toBe(false);
    expect(isDefinitiveSendFailure("guest paid 400 TL")).toBe(false);
  });
});
