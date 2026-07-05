import "server-only";

import { randomUUID } from "node:crypto";
import { emailService } from "@/lib/email";

// Central error reporter. Always logs a structured error; additionally emails an
// operator when ERROR_ALERT_EMAIL (or ALERT_EMAIL) is configured, throttled so a
// burst of failures can't flood the inbox. Never throws.
//
// This is the project's lightweight observability hook — a single choke point
// where a real monitoring backend (Sentry, etc.) can later be wired in.

// Throttle per CONTEXT (not globally) so a fleet-wide failure — e.g. sync
// breaking for several orgs at once, each a distinct context — isn't masked as a
// single blip; each distinct failure still gets one alert per window.
const lastEmailAt = new Map<string, number>();
const EMAIL_THROTTLE_MS = 10 * 60 * 1000; // at most one alert email / context / 10 min

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Sensitive JSON/kv KEYS whose VALUE must be masked. Deliberately EXCLUDES bare
// "code"/"id"/"status"/"type" so error codes (P2002, invalid_grant), ids and
// HTTP statuses stay visible for debugging.
const SENSITIVE_KEY =
  "(?:pass(?:word|wd)?|pwd|token|access[_-]?token|refresh[_-]?token|" +
  "client[_-]?secret|secret|api[_-]?key|authorization|cookie|set[_-]?cookie|" +
  "e?mail|phone|telephone|gsm|mobile|full[_-]?name|first[_-]?name|last[_-]?name|" +
  "guest[_-]?name|name|address|street|door[_-]?code|access[_-]?code|postal[_-]?code)";
const FIELD_RE = new RegExp(`("?)(${SENSITIVE_KEY})\\1\\s*[:=]\\s*("?)[^"\\n,}{]*\\3`, "gi");

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

export async function reportError(context: string, err: unknown): Promise<void> {
  const detail = redactSensitive(
    err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ""}` : String(err),
  );
  const errName = err instanceof Error ? err.name : "Error";
  const errMessage = redactSensitive(err instanceof Error ? err.message : String(err));

  // Always log — structured and greppable (redacted: Railway logs are retained).
  console.error(`[reportError] ${context} :: ${detail}`);

  // Real error monitoring (optional): send to Sentry when SENTRY_DSN is set.
  // Fire-and-forget, dependency-free, never throws.
  void captureToSentry(context, errName, errMessage, detail);

  const to = process.env.ERROR_ALERT_EMAIL || process.env.ALERT_EMAIL;
  if (!to) return;

  const now = Date.now();
  if (now - (lastEmailAt.get(context) ?? 0) < EMAIL_THROTTLE_MS) return;
  lastEmailAt.set(context, now);

  try {
    await emailService.send(
      to,
      `⚠️ Lixus AI sistem hatası — ${context}`,
      `<p>Bir sistem hatası oluştu:</p><pre style="white-space:pre-wrap;font-size:13px">${escapeHtml(
        detail,
      ).slice(0, 4000)}</pre>`,
    );
  } catch {
    // Reporting must never throw.
  }
}

/** Test helper: reset the email throttle. */
export function __resetReportThrottle() {
  lastEmailAt.clear();
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

async function captureToSentry(
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
      // errName/errMessage/detail are already redacted by reportError.
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
