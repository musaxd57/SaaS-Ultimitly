import "server-only";

import { randomUUID } from "node:crypto";
import { emailService } from "@/lib/email";

// Central error reporter. Always logs a structured error; additionally emails an
// operator when ERROR_ALERT_EMAIL (or ALERT_EMAIL) is configured, throttled so a
// burst of failures can't flood the inbox. Never throws.
//
// This is the project's lightweight observability hook — a single choke point
// where a real monitoring backend (Sentry, etc.) can later be wired in.

let lastEmailAt = 0;
const EMAIL_THROTTLE_MS = 10 * 60 * 1000; // at most one alert email / 10 min

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function reportError(context: string, err: unknown): Promise<void> {
  const detail =
    err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ""}` : String(err);

  // Always log — structured and greppable.
  console.error(`[reportError] ${context} :: ${detail}`);

  // Real error monitoring (optional): send to Sentry when SENTRY_DSN is set.
  // Fire-and-forget, dependency-free, never throws.
  void captureToSentry(context, err, detail);

  const to = process.env.ERROR_ALERT_EMAIL || process.env.ALERT_EMAIL;
  if (!to) return;

  const now = Date.now();
  if (now - lastEmailAt < EMAIL_THROTTLE_MS) return;
  lastEmailAt = now;

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
  lastEmailAt = 0;
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

async function captureToSentry(context: string, err: unknown, detail: string): Promise<void> {
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
      exception: {
        values: [
          {
            type: err instanceof Error ? err.name : "Error",
            value: (err instanceof Error ? err.message : String(err)).slice(0, 1000),
          },
        ],
      },
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
