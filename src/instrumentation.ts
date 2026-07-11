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

// The dev default from .env.example — running production with it means every
// session signature is forgeable by anyone who has read the repo.
const DEV_PLACEHOLDER_SECRET = "dev-secret-change-me-please-32-bytes-min";

/**
 * Fail-fast env assertion (production only): a missing or placeholder
 * AUTH_SECRET silently makes session signatures forgeable AND (via the
 * documented fallback) weakens token encryption — refusing to boot loudly is
 * strictly better than running insecure. ENCRYPTION_KEY stays optional by
 * design (falls back to AUTH_SECRET); DATABASE_URL is already enforced earlier
 * by the boot's `prisma migrate deploy`. Exported for tests.
 */
export function assertCriticalEnv(): void {
  const secret = process.env.AUTH_SECRET?.trim() ?? "";
  if (!secret || secret === DEV_PLACEHOLDER_SECRET) {
    throw new Error(
      "[boot] AUTH_SECRET is missing or still the dev placeholder — refusing to start in production (session signatures would be forgeable).",
    );
  }
  if (secret.length < 32) {
    console.warn("[boot] AUTH_SECRET is shorter than 32 chars — use a longer random secret.");
  }
}

export async function register() {
  // Only on the Node.js runtime, only in production, only once per process.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;
  // Misconfig must fail the boot loudly — BEFORE any early cron return below.
  assertCriticalEnv();
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
