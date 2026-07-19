import "server-only";

import { sendMessage } from "@/lib/hospitable";

// ---------------------------------------------------------------------------
// Unified outbound messaging
//
// Delivers a reply on the guest's original channel, hiding the per-channel
// transport from callers (the reply route and the AI auto-reply both use this).
// ---------------------------------------------------------------------------

export interface ChannelTarget {
  channel: string;
  guestIdentifier: string;
  externalReservationId?: string | null;
}

export interface SendOutcome {
  ok: boolean;
  /** True when there was nothing to deliver externally (manual/email thread). */
  skipped?: boolean;
  error?: string;
  /** The provider's id for the just-sent message, when it returned one. Persist
   *  it as the local Message.externalId so when the sync re-imports this same
   *  message from the channel thread it dedups (matches on externalId) instead
   *  of creating a duplicate outbound row attributed to "Ev sahibi". */
  providerMessageId?: string | null;
}

/**
 * Route an outbound reply to the right transport:
 *   - Hospitable (Airbnb / Booking / ...) when the conversation carries an
 *     externalReservationId,
 *   - otherwise a no-op (internal/manual threads have nothing to deliver).
 */
export async function sendOnChannel(
  target: ChannelTarget,
  body: string,
  token?: string,
): Promise<SendOutcome> {
  // Internal QR-concierge threads ("qr-chat:<propertyId>") have no return channel
  // — the guest is an anonymous web visitor — so record the host's reply locally
  // and deliver nothing externally (never POST a synthetic id to Hospitable).
  const isInternal =
    !target.externalReservationId || target.externalReservationId.startsWith("qr-chat:");

  if (!isInternal) {
    // Multi-tenant: deliver via the connecting org's own Hospitable token.
    // SINGLE-SHOT ({ retries: 0 }), like the durable outbox worker: POST /messages
    // is NON-IDEMPOTENT, so a client-level retry on a 5xx/timeout/network error can
    // re-deliver a message that actually landed on attempt 0 (the response was just
    // lost) → the guest gets it twice. The caller's claim-then-send already owns the
    // ambiguous outcome (hold the claim, never blindly re-POST — see
    // isDefinitiveSendFailure), so retrying inside the client would only re-open the
    // duplicate window the project's "a duplicate is worse than a rare silent miss"
    // invariant forbids. Exactly one POST; the caller decides what to do with a
    // failure. (GET/list calls keep their retries — those are idempotent.)
    const r = await sendMessage(target.externalReservationId!, body, token, { retries: 0 });
    return { ok: r.ok, error: r.error, providerMessageId: r.id ?? null };
  }

  return { ok: true, skipped: true };
}

/**
 * Classify a FAILED send for the claim-then-send rollback decision. DEFINITIVE (the
 * provider rejected the request — HTTP 4xx EXCEPT 408 Request Timeout) means nothing
 * was delivered, so the caller may safely un-claim and retry the same body now.
 * Everything else — a timeout (incl. 408), a network drop, or a 5xx — is AMBIGUOUS:
 * the message MAY have reached the guest despite the error, so the caller MUST NOT
 * re-POST it (that would deliver a duplicate). SINGLE SOURCE OF TRUTH shared by the
 * manual-reply route and the proactive lifecycle senders (welcome/check-in/checkout)
 * so the two can never drift. Matches on the "HTTP <code>" that sendMessage surfaces
 * in `error`; a non-HTTP error (network/abort) has no 4xx and is treated as ambiguous.
 */
export function isDefinitiveSendFailure(error: string | null | undefined): boolean {
  const e = error ?? "";
  return /HTTP (4\d\d)/.test(e) && !/HTTP 408/.test(e);
}
