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
}

// NOTE: a global Next.js `onRequestError` crash-net was attempted here but reverted
// — importing reportError (→ nodemailer) into instrumentation.ts pulls server-only
// deps into the EDGE bundle and fails the build (same reason register() uses a
// fetch-over-localhost call instead of importing the sync code). A future crash-net
// needs a node-runtime-only entry (e.g. a separate instrumentation file or an
// internal report endpoint). Server route 500s are already surfaced via
// serverError(err) → reportError; this hook would only add RSC-render/throw capture.
