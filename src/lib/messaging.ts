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
  if (target.externalReservationId) {
    // Multi-tenant: deliver via the connecting org's own Hospitable token.
    const r = await sendMessage(target.externalReservationId, body, token);
    return { ok: r.ok, error: r.error };
  }

  return { ok: true, skipped: true };
}
