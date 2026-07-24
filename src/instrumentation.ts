// Next.js startup hook. Runs once when the server process boots.
//
// We start an in-process timer that triggers the scheduled sync every 2 minutes
// — a self-contained backup so the system keeps pulling messages and sending
// auto-replies even if the external scheduler (cron-job.org) goes down.
//
// The timer calls our own /api/cron/sync endpoint over localhost rather than
// importing the sync code directly: this keeps heavy server-only modules
// (Prisma, nodemailer) out of the instrumentation bundle, and reuses the exact
// same authenticated path the external scheduler uses. Both triggers are
// idempotent and guarded by an in-process lock, so running both is safe.

const INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

// NOTE: critical-env validation (AUTH_SECRET / ENCRYPTION_KEY) is NOT done here.
// It lives in a SINGLE source — the `prestart` gate (scripts/verify-env.mjs), which
// runs as a standalone process BEFORE `next start`. Doing it here as a runtime
// throw was the "Ready but every request 500s" bug: Next could already be serving
// when instrumentation ran. The prestart gate exits non-zero cleanly instead, so a
// misconfigured deploy never becomes live.

export async function register() {
  // Only on the Node.js runtime, only in production, only once per process.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;
  // Opt-out hatch if you rely solely on an external scheduler.
  if (process.env.INTERNAL_CRON_DISABLED === "1") return;
  // Needs the shared secret to call the protected endpoint.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[internal-cron] CRON_SECRET not set — in-process scheduler disabled");
    return;
  }

  const g = globalThis as typeof globalThis & { __guestopsCronStarted?: boolean };
  if (g.__guestopsCronStarted) return;
  g.__guestopsCronStarted = true;

  const port = process.env.PORT || "3000";
  const url = `http://127.0.0.1:${port}/api/cron/sync`;

  const tick = async () => {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        console.error(`[internal-cron] tick HTTP ${res.status}`);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as Record<string, number | boolean>;
      if (data.ok && (data.messages || data.autoReplies || data.welcomes || data.checkouts)) {
        console.log(
          `[internal-cron] messages=${data.messages} autoReplies=${data.autoReplies} welcomes=${data.welcomes} checkouts=${data.checkouts}`,
        );
      }
    } catch (err) {
      console.error("[internal-cron] tick failed", err);
    }
  };

  // Kick once shortly after boot (server is listening), then on a fixed interval.
  setTimeout(tick, 15_000);
  setInterval(tick, INTERVAL_MS);
  console.log("[internal-cron] in-process scheduler started (every 2 min)");

  // ── Identity e-mail outbox poller (Tur-4). NOT a separate worker service —
  // a persistent in-process loop; delivery durability comes from the DB row,
  // this only bounds latency (a reset code is watched for on screen, so the
  // 2-min cron alone is too slow). Same localhost-fetch pattern as above (no
  // Prisma/nodemailer in this bundle); SKIP LOCKED claims make any number of
  // replicas polling concurrently safe. Gated at boot on the flag: a Railway
  // env change restarts the process, so a boot-time read is authoritative —
  // and the endpoint itself no-ops when the flag is off (defence in depth).
  // With INTERNAL_CRON_DISABLED=1 this poller is off too (we returned above);
  // such deployments deliver via the external scheduler's /api/cron/sync pass
  // (worst-case latency = that cron's interval) or by also scheduling
  // /api/cron/email-outbox externally.
  if (process.env.EMAIL_OUTBOX_ENABLED === "1") {
    const g2 = globalThis as typeof globalThis & { __lixusEmailOutboxPollerStarted?: boolean };
    if (!g2.__lixusEmailOutboxPollerStarted) {
      g2.__lixusEmailOutboxPollerStarted = true;
      const outboxUrl = `http://127.0.0.1:${port}/api/cron/email-outbox`;
      const outboxTick = async () => {
        try {
          const res = await fetch(outboxUrl, {
            headers: { Authorization: `Bearer ${secret}` },
            signal: AbortSignal.timeout(30_000),
          });
          if (!res.ok) console.error(`[email-outbox-poller] tick HTTP ${res.status}`);
        } catch (err) {
          console.error("[email-outbox-poller] tick failed", err);
        }
      };
      setTimeout(outboxTick, 20_000);
      setInterval(outboxTick, 15_000);
      console.log("[email-outbox-poller] in-process poller started (every 15s)");
    }
  }
}

// NOTE: a global Next.js `onRequestError` crash-net was attempted here but reverted
// — importing reportError (→ nodemailer) into instrumentation.ts pulls server-only
// deps into the EDGE bundle and fails the build (same reason register() uses a
// fetch-over-localhost call instead of importing the sync code). A future crash-net
// needs a node-runtime-only entry (e.g. a separate instrumentation file or an
// internal report endpoint). Server route 500s are already surfaced via
// serverError(err) → reportError; this hook would only add RSC-render/throw capture.
