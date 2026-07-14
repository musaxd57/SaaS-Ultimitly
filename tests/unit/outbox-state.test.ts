import { describe, it, expect } from "vitest";
import {
  OUTBOX_STATUSES,
  assertTransition,
  canTransition,
  classifySendResult,
  isTerminal,
  isOutboxStatus,
  backoffMs,
  attemptsExhausted,
  OUTBOX_MAX_ATTEMPTS,
} from "@/lib/outbox/state";

describe("outbox state machine — closed set + validated transitions", () => {
  it("has a fixed, closed status set", () => {
    expect([...OUTBOX_STATUSES].sort()).toEqual(
      ["ambiguous", "canceled", "failed", "pending", "reconciling", "review", "sending", "sent"].sort(),
    );
    expect(isOutboxStatus("sent")).toBe(true);
    expect(isOutboxStatus("totally_made_up")).toBe(false);
  });

  it("allows exactly the intended transitions", () => {
    // Happy path: pending → sending → sent.
    expect(canTransition("pending", "sending")).toBe(true);
    expect(canTransition("sending", "sent")).toBe(true);
    // Retry / failure / ambiguous branches off "sending".
    expect(canTransition("sending", "pending")).toBe(true); // retryable → back off
    expect(canTransition("sending", "failed")).toBe(true);
    expect(canTransition("sending", "ambiguous")).toBe(true);
    expect(canTransition("sending", "canceled")).toBe(true); // send-time veto (P2)
    // Reconcile path.
    expect(canTransition("ambiguous", "reconciling")).toBe(true);
    expect(canTransition("reconciling", "sent")).toBe(true);
    expect(canTransition("reconciling", "review")).toBe(true);
    // Human requeue.
    expect(canTransition("review", "pending")).toBe(true);
  });

  it("rejects illegal transitions (assertTransition throws)", () => {
    expect(() => assertTransition("sent", "pending")).toThrow(/illegal transition/);
    expect(() => assertTransition("pending", "sent")).toThrow(); // must go via "sending"
    expect(() => assertTransition("failed", "sent")).toThrow();
    expect(() => assertTransition("sending", "reconciling")).toThrow();
    expect(() => assertTransition("ambiguous", "sent")).toThrow(); // must go via "reconciling"
  });

  it("marks the terminal statuses", () => {
    expect(isTerminal("sent")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("review")).toBe(true);
    expect(isTerminal("canceled")).toBe(true);
    expect(isTerminal("pending")).toBe(false);
    expect(isTerminal("ambiguous")).toBe(false);
  });
});

describe("classifySendResult — definitive success / failure vs ambiguous", () => {
  it("ok:true → definitive success", () => {
    expect(classifySendResult({ ok: true })).toBe("definitive_success");
  });
  it("a 4xx (not 408/429) → definitive failure (safe to retry, nothing delivered)", () => {
    expect(classifySendResult({ ok: false, error: "Hospitable API hatası (HTTP 400)" })).toBe("definitive_failure");
    expect(classifySendResult({ ok: false, error: "HTTP 422 unprocessable" })).toBe("definitive_failure");
  });
  it("a 429 → rate_limited (defer to Retry-After, do NOT consume a terminal attempt)", () => {
    expect(classifySendResult({ ok: false, error: "Hospitable API hatası (HTTP 429)" })).toBe("rate_limited");
  });
  it("408 / 5xx → ambiguous (may have delivered)", () => {
    expect(classifySendResult({ ok: false, error: "HTTP 408 request timeout" })).toBe("ambiguous");
    expect(classifySendResult({ ok: false, error: "HTTP 500 server error" })).toBe("ambiguous");
    expect(classifySendResult({ ok: false, error: "HTTP 503" })).toBe("ambiguous");
  });
  it("a network error / timeout with no HTTP status → ambiguous", () => {
    expect(classifySendResult({ ok: false, error: "Hospitable'a ulaşılamadı: aborted" })).toBe("ambiguous");
    expect(classifySendResult({ ok: false, error: null })).toBe("ambiguous");
  });
});

describe("backoff — bounded exponential + deterministic jitter", () => {
  it("grows with attempts but is capped (bounded, no runaway)", () => {
    const seed = "row-1";
    const d1 = backoffMs(1, seed);
    const d3 = backoffMs(3, seed);
    const dHuge = backoffMs(50, seed);
    expect(d3).toBeGreaterThan(d1); // grows
    expect(dHuge).toBeLessThanOrEqual(Math.round(30 * 60_000 * 1.2)); // capped at 30m (+jitter)
  });
  it("is deterministic (no Math.random) and jitter stays within ±20%", () => {
    expect(backoffMs(2, "abc")).toBe(backoffMs(2, "abc")); // deterministic
    const base = 30_000 * 2 ** 1; // attempt 2 exponent
    const d = backoffMs(2, "abc");
    expect(d).toBeGreaterThanOrEqual(Math.round(base * 0.8));
    expect(d).toBeLessThanOrEqual(Math.round(base * 1.2));
    // Different seeds spread out (jitter differs).
    expect(backoffMs(2, "seed-A")).not.toBe(backoffMs(2, "seed-BBBB"));
  });
  it("attemptsExhausted at the ceiling", () => {
    expect(attemptsExhausted(OUTBOX_MAX_ATTEMPTS - 1)).toBe(false);
    expect(attemptsExhausted(OUTBOX_MAX_ATTEMPTS)).toBe(true);
  });
});
