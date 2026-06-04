import "server-only";

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

  const to = process.env.ERROR_ALERT_EMAIL || process.env.ALERT_EMAIL;
  if (!to) return;

  const now = Date.now();
  if (now - lastEmailAt < EMAIL_THROTTLE_MS) return;
  lastEmailAt = now;

  try {
    await emailService.send(
      to,
      `⚠️ GuestOps sistem hatası — ${context}`,
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
