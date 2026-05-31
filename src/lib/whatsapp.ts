import "server-only";

// ---------------------------------------------------------------------------
// WhatsApp Business Cloud API client (Meta Graph API v18.0)
// Official docs: https://developers.facebook.com/docs/whatsapp/cloud-api
//
// Required env vars:
//   WHATSAPP_TOKEN          — permanent access token or system user token
//   WHATSAPP_PHONE_NUMBER_ID — the numeric ID of the registered WA phone number
//
// If either var is missing, send() logs to console and returns false (dev mode).
// Never throws — caller should check the boolean return value.
// ---------------------------------------------------------------------------

const BASE_URL = "https://graph.facebook.com/v18.0";
const TIMEOUT_MS = 15_000;

export interface WaSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

function isConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/**
 * Send a plain-text WhatsApp message to a phone number.
 *
 * @param to   Recipient phone number in E.164 format (e.g. "+905301234567").
 * @param body Message text (max 4096 chars per WhatsApp spec).
 */
export async function waSendText(to: string, body: string): Promise<WaSendResult> {
  if (!to || !body) {
    return { ok: false, error: "Missing 'to' or 'body'" };
  }

  if (!isConfigured()) {
    // Dev/unconfigured — log to console so developers can see what would be sent.
    console.log(
      `\n[WhatsApp DEV] ────────────────────────────────────────\n` +
        `To:   ${to}\n` +
        `Body: ${body.slice(0, 200)}\n` +
        `────────────────────────────────────────────────────────\n`,
    );
    return { ok: true, messageId: "dev-mock" };
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
  const token = process.env.WHATSAPP_TOKEN!;

  try {
    const res = await fetch(`${BASE_URL}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: body.slice(0, 4096) },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errMsg =
        (data as { error?: { message?: string } }).error?.message ??
        `HTTP ${res.status}`;
      console.error("[WhatsApp] Send failed:", errMsg);
      return { ok: false, error: errMsg };
    }

    const msgId =
      (data as { messages?: { id?: string }[] }).messages?.[0]?.id ?? undefined;
    return { ok: true, messageId: msgId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[WhatsApp] Send exception:", msg);
    return { ok: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Webhook payload types (subset of the Meta Cloud API payload we use)
// ---------------------------------------------------------------------------

export interface WaInboundMessage {
  from: string;        // E.164 phone number of the sender
  id: string;          // WA message ID (wamid)
  timestamp: string;   // Unix timestamp string
  type: string;        // "text" | "image" | "audio" | ...
  text?: { body: string };
  displayPhoneNumber?: string; // business phone that received the message
  profileName?: string;        // sender's WhatsApp display name
}

export interface WaWebhookEntry {
  id: string;  // WhatsApp Business Account ID
  changes: Array<{
    value: {
      messaging_product: string;
      metadata: { display_phone_number: string; phone_number_id: string };
      contacts?: Array<{ profile: { name: string }; wa_id: string }>;
      messages?: Array<{
        from: string;
        id: string;
        timestamp: string;
        text?: { body: string };
        type: string;
      }>;
    };
    field: string;
  }>;
}

export interface WaWebhookPayload {
  object: string;
  entry: WaWebhookEntry[];
}

/**
 * Extract all inbound text messages from a webhook payload.
 * Ignores non-text messages (images, reactions, etc.) for now.
 */
export function extractInboundMessages(payload: WaWebhookPayload): WaInboundMessage[] {
  const results: WaInboundMessage[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const { value } = change;
      const messages = value.messages ?? [];
      const contacts = value.contacts ?? [];

      for (const msg of messages) {
        if (msg.type !== "text" || !msg.text?.body) continue;

        const contact = contacts.find((c) => c.wa_id === msg.from);
        results.push({
          from: msg.from,
          id: msg.id,
          timestamp: msg.timestamp,
          type: msg.type,
          text: msg.text,
          displayPhoneNumber: value.metadata.display_phone_number,
          profileName: contact?.profile.name,
        });
      }
    }
  }

  return results;
}
