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
  triggerMessageIdOf,
  SUPERSEDED_BY_NEWER_MESSAGE,
  nextReplyIdempotencyKey,
  REEVALUABLE_CANCEL_CODES,
  UNRESOLVED_DELIVERY_STATUSES,
  DELIVERY_UNVERIFIED_REASON,
  sendFailureReason,
} from "@/lib/outbox/state";

describe("outbox state machine — closed set + validated transitions", () => {
  it("has a fixed, closed status set", () => {
    expect([...OUTBOX_STATUSES].sort()).toEqual(
      ["ambiguous", "blocked", "canceled", "failed", "pending", "reconciling", "review", "sending", "sent"].sort(),
    );
    expect(isOutboxStatus("sent")).toBe(true);
    expect(isOutboxStatus("blocked")).toBe(true);
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
    // Hospitable 402 "subscription not active" → park in `blocked` (persistent, not a transient
    // outage); reactivated to `pending` exactly ONCE when the org's sync succeeds again.
    expect(canTransition("sending", "blocked")).toBe(true);
    expect(canTransition("blocked", "pending")).toBe(true);
    // Reconcile path.
    expect(canTransition("ambiguous", "reconciling")).toBe(true);
    expect(canTransition("reconciling", "sent")).toBe(true);
    expect(canTransition("reconciling", "review")).toBe(true);
    // Human requeues (ops screen): review → pending, and failed → pending (a failed row was
    // definitively REJECTED — nothing delivered — so a human retry can't duplicate). No AUTOMATIC
    // path uses failed→pending: enqueue never resurrects (A3) and a 402 parks as `blocked`.
    expect(canTransition("review", "pending")).toBe(true);
    expect(canTransition("failed", "pending")).toBe(true);
  });

  it("rejects illegal transitions (assertTransition throws)", () => {
    expect(() => assertTransition("sent", "pending")).toThrow(/illegal transition/);
    expect(() => assertTransition("pending", "sent")).toThrow(); // must go via "sending"
    expect(() => assertTransition("failed", "sent")).toThrow();
    expect(() => assertTransition("sending", "reconciling")).toThrow();
    expect(() => assertTransition("ambiguous", "sent")).toThrow(); // must go via "reconciling"
    expect(() => assertTransition("blocked", "sent")).toThrow(); // must go via pending → sending
  });

  it("marks the terminal statuses", () => {
    expect(isTerminal("sent")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("review")).toBe(true);
    expect(isTerminal("canceled")).toBe(true);
    expect(isTerminal("blocked")).toBe(true); // terminal-until-reactivated (never auto-claimed)
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
  it("a 402 → blocked (subscription not active — persistent, park; NOT a definitive_failure)", () => {
    expect(classifySendResult({ ok: false, error: "Hospitable API hatası (HTTP 402)" })).toBe("blocked");
    // Must NOT be misread as a plain 4xx definitive failure (that would consume attempts + loop).
    expect(classifySendResult({ ok: false, error: "HTTP 402 Subscription not active" })).not.toBe("definitive_failure");
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

describe("triggerMessageIdOf — yapay zekâ satırının cevapladığı mesaj (Codex 09-30 C2)", () => {
  it("oto-yanıt ve kapanış anahtarlarından tetik mesajını okur", () => {
    expect(triggerMessageIdOf("auto:c1:m1", "c1")).toBe("m1");
    expect(triggerMessageIdOf("closing:c1:m9", "c1")).toBe("m9");
  });
  it("başka konuşmanın / başka biçimin anahtarı tetik DEĞİL", () => {
    expect(triggerMessageIdOf("auto:c2:m1", "c1")).toBeNull();
    expect(triggerMessageIdOf("holding:c1:abc", "c1")).toBeNull();
    expect(triggerMessageIdOf("manual:c1:m1", "c1")).toBeNull();
    expect(triggerMessageIdOf("auto:c1:", "c1")).toBeNull();
    expect(triggerMessageIdOf("auto:c1:m1:x", "c1")).toBeNull();
    expect(triggerMessageIdOf(null, "c1")).toBeNull();
    expect(triggerMessageIdOf(undefined, "c1")).toBeNull();
  });
  it("sebep kodu tek kaynak", () => {
    expect(SUPERSEDED_BY_NEWER_MESSAGE).toBe("superseded_by_newer_message");
  });
});

describe("Tur 7 T7-OB-1 adım 2 — sürüm anahtarı + belirsiz teslim kümesi", () => {
  const base = "auto:c1:m1";
  const row = (idempotencyKey: string, status: string, lastErrorCode: string | null = null) => ({ idempotencyKey, status, lastErrorCode });

  it("tetik okuyucu sürüm ekini (#rN) atar; başka ek tetik DEĞİL", () => {
    expect(triggerMessageIdOf("auto:c1:m1#r2", "c1")).toBe("m1");
    expect(triggerMessageIdOf("auto:c1:m1#r9999", "c1")).toBe("m1");
    expect(triggerMessageIdOf("auto:c1:m1#r", "c1")).toBeNull();
    expect(triggerMessageIdOf("auto:c1:m1#x2", "c1")).toBeNull();
    expect(triggerMessageIdOf("auto:c1:m1#r12345", "c1")).toBeNull();
  });

  it("satır yoksa temel anahtar; gönderilmiş / yolda / belirsiz / başarısız satırın anahtarı AYNEN döner (tekilleştirme çift gönderimi önler)", () => {
    expect(nextReplyIdempotencyKey(base, [])).toBe(base);
    for (const status of ["pending", "sending", "sent", "ambiguous", "reconciling", "review", "failed", "blocked"]) {
      expect(nextReplyIdempotencyKey(base, [row(base, status)]), status).toBe(base);
    }
  });

  it("YENİDEN DEĞERLENDİRİLEBİLİR iptal (duraklatma bitti / konuşma ilerledi) → bir sonraki sürüm; zincir sürer", () => {
    expect(nextReplyIdempotencyKey(base, [row(base, "canceled", "ai_paused")])).toBe(`${base}#r2`);
    expect(nextReplyIdempotencyKey(base, [row(base, "canceled", SUPERSEDED_BY_NEWER_MESSAGE)])).toBe(`${base}#r2`);
    expect(
      nextReplyIdempotencyKey(base, [row(base, "canceled", "ai_paused"), row(`${base}#r2`, "canceled", "ai_paused")]),
    ).toBe(`${base}#r3`);
    // Sıra bağımsız: en yüksek sürüm belirler (veritabanı sırası garanti değil).
    expect(
      nextReplyIdempotencyKey(base, [row(`${base}#r2`, "sent"), row(base, "canceled", "ai_paused")]),
    ).toBe(`${base}#r2`);
  });

  it("BAYAT iptal sürüm AÇMAZ: abonelik / kanal / anahtar kapalı (kurucu Y5 · N1 · W7), şikâyet, rezervasyon, KVKK silmesi, kodsuz", () => {
    for (const code of [
      "auto_reply_disabled",
      "billing_paused",
      "channel_paused",
      "escalated_or_closed",
      "reservation_cancelled",
      "reservation_ended",
      "connection_tenant_mismatch",
      "erased",
      null,
    ]) {
      expect(nextReplyIdempotencyKey(base, [row(base, "canceled", code)]), String(code)).toBe(base);
    }
    expect([...REEVALUABLE_CANCEL_CODES].sort()).toEqual(["ai_paused", SUPERSEDED_BY_NEWER_MESSAGE].sort());
  });

  it("başka tetiğin ya da benzer önekli anahtarın satırı sayılmaz", () => {
    expect(nextReplyIdempotencyKey(base, [row("auto:c1:m10", "canceled", "ai_paused")])).toBe(base);
    expect(nextReplyIdempotencyKey(base, [row(`${base}#rx`, "canceled", "ai_paused")])).toBe(base);
    expect(nextReplyIdempotencyKey(base, [row(`${base}x#r2`, "canceled", "ai_paused")])).toBe(base);
  });

  it("belirsiz teslim kümesi: ambiguous · reconciling · review (yolda olan `sending` DEĞİL); not kodu tek kaynak", () => {
    expect([...UNRESOLVED_DELIVERY_STATUSES].sort()).toEqual(["ambiguous", "reconciling", "review"]);
    expect(DELIVERY_UNVERIFIED_REASON).toBe("delivery_unverified");
    expect(sendFailureReason("ambiguous")).toBe(DELIVERY_UNVERIFIED_REASON);
  });
});
