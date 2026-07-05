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
    const r = await sendMessage(target.externalReservationId!, body, token);
    return { ok: r.ok, error: r.error, providerMessageId: r.id ?? null };
  }

  return { ok: true, skipped: true };
}
