import "server-only";

import { waSendText } from "@/lib/whatsapp";
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
 *   - WhatsApp Cloud API for whatsapp conversations,
 *   - otherwise a no-op (internal threads have nothing to deliver).
 */
export async function sendOnChannel(target: ChannelTarget, body: string): Promise<SendOutcome> {
  if (target.externalReservationId) {
    const r = await sendMessage(target.externalReservationId, body);
    return { ok: r.ok, error: r.error };
  }

  if (target.channel === "whatsapp" && target.guestIdentifier) {
    const r = await waSendText(target.guestIdentifier, body);
    return { ok: r.ok, error: r.error };
  }

  return { ok: true, skipped: true };
}
