import "server-only";

import { emailService } from "@/lib/email";
import { captureToSentry, redactSensitive } from "./report-error-core";

// Central error reporter. Always logs a structured error; additionally emails an
// operator when ERROR_ALERT_EMAIL (or ALERT_EMAIL) is configured, throttled so a
// burst of failures can't flood the inbox. Never throws.
//
// Redaction + the dependency-free Sentry envelope client live in
// report-error-core.ts (crypto.ts precedent: operator scripts run the same code
// under tsx, where "server-only" doesn't resolve). This wrapper adds the email
// leg and the throttle. App code imports THIS path.

export { redactSensitive } from "./report-error-core";

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
