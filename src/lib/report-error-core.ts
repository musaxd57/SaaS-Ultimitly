import { randomUUID } from "node:crypto";

// Pure core of the error reporter: redaction + the dependency-free Sentry
// envelope client. Split from report-error.ts (crypto.ts precedent) so operator
// scripts can exercise the EXACT same redaction + delivery code under tsx,
// where the "server-only" package does not resolve. No email import here —
// the email leg lives in the server-only wrapper.

// Sensitive JSON/kv KEYS whose VALUE must be masked. Deliberately EXCLUDES bare
// "code"/"id"/"status"/"type" so error codes (P2002, invalid_grant), ids and
// HTTP statuses stay visible for debugging.
const SENSITIVE_KEY =
  "(?:pass(?:word|wd)?|pwd|token|access[_-]?token|refresh[_-]?token|" +
  "client[_-]?secret|secret|api[_-]?key|authorization|cookie|set[_-]?cookie|" +
  "e?mail|phone|telephone|gsm|mobile|full[_-]?name|first[_-]?name|last[_-]?name|" +
  "guest[_-]?name|name|address|street|door[_-]?code|access[_-]?code|postal[_-]?code)";
// Value matcher handles BOTH a quoted JSON value (commas/braces INSIDE the quotes
// are part of the value — e.g. "Istanbul, Turkey") and a bare key=value token.
// The old `[^"\n,}{]*` stopped at the first comma, so a quoted address/full_name
// leaked its value un-redacted; the quoted branch below fixes that.
const FIELD_RE = new RegExp(
  `("?)(${SENSITIVE_KEY})\\1\\s*[:=]\\s*("[^"\\n]*"|[^",}{\\n]+)`,
  "gi",
);

/**
 * Mask PII/secret VALUES from an error string before it leaves the process —
 * Sentry is US-hosted (KVKK cross-border egress) and the alert email / logs are
 * retained too. Preserves error TYPE, HTTP status codes, error codes, and stack
 * frames (only values are masked), so reports stay debuggable. Exported for tests.
 */
export function redactSensitive(input: string): string {
  if (!input) return input;
  let s = input;
  // (A) value-shaped secrets
  s = s.replace(/\b[Bb]earer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]");
  s = s.replace(/\bsk-[A-Za-z0-9_-]{12,}/g, "sk-[REDACTED]"); // OpenAI key
  s = s.replace(/\bwhsec_[A-Za-z0-9]+/g, "whsec_[REDACTED]"); // webhook secret
  s = s.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[JWT]");
  s = s.replace(/\b(authorization|cookie|set-cookie)\b\s*[:=]\s*[^\n]+/gi, "$1: [REDACTED]");
  // (B) field-name-aware: catches names/addresses/door-codes of any shape in JSON bodies
  s = s.replace(FIELD_RE, (_m, q, key) => `${q}${key}${q}: [REDACTED]`);
  // (C) unlabelled value-shaped PII
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[EMAIL]");
  s = s.replace(/\+?\d[\d\s().-]{8,}\d/g, "[PHONE]");
  s = s.replace(/\b\d{6,}\b/g, "[NUM]"); // long digit runs (ids/door codes); 3-digit statuses survive
  return s;
}

// --- Sentry (dependency-free) ----------------------------------------------
// Posts an event to Sentry's ingest "envelope" endpoint, derived from the DSN.
// No SDK, no build changes — active only when SENTRY_DSN is configured.

type SentryDsn = { endpoint: string; publicKey: string };

function parseDsn(dsn: string): SentryDsn | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.split("/").filter(Boolean).pop();
    if (!u.username || !projectId) return null;
    return {
      endpoint: `${u.protocol}//${u.host}/api/${projectId}/envelope/`,
      publicKey: u.username,
    };
  } catch {
    return null;
  }
}

export async function captureToSentry(
  context: string,
  errName: string,
  errMessage: string,
  detail: string,
): Promise<void> {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;
  const parsed = parseDsn(dsn);
  if (!parsed) return;

  try {
    const eventId = randomUUID().replace(/-/g, "");
    const header = JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn });
    const itemHeader = JSON.stringify({ type: "event" });
    const event = JSON.stringify({
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "node",
      level: "error",
      logger: "guestops",
      environment: process.env.NODE_ENV ?? "production",
      transaction: context,
      // errName/errMessage/detail must arrive PRE-REDACTED (reportError does this).
      exception: { values: [{ type: errName, value: errMessage.slice(0, 1000) }] },
      extra: { detail: detail.slice(0, 4000) },
    });
    await fetch(parsed.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=guestops/1.0`,
      },
      body: `${header}\n${itemHeader}\n${event}\n`,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Monitoring must never throw or block the caller.
  }
}
