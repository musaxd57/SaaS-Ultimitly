import { type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runScheduledSync } from "@/lib/scheduled-sync";

// ---------------------------------------------------------------------------
// Scheduled sync + night auto-reply (the engine behind 24/7 operation).
//
// A hosting scheduler (Vercel Cron, Railway/Render cron, cron-job.org, a GitHub
// Action, ...) calls this on an interval. For each organization it pulls new
// Hospitable messages and then runs the auto-reply pass — which is a no-op
// unless auto-reply is enabled AND we are inside the active-hours window. So it
// is safe to call frequently around the clock; replies only go out at night.
//
// Auth: requires CRON_SECRET (env), sent via the Authorization: Bearer header
// (Vercel Cron / cron-job.org style) or an x-cron-secret header. The secret is
// NEVER accepted via a ?secret= query param — that would leak it into the
// platform's request logs. Without a configured secret the endpoint refuses to run.
// ---------------------------------------------------------------------------

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // never expose an unauthenticated trigger
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const provided = bearer ?? req.headers.get("x-cron-secret") ?? "";
  // Constant-time compare to avoid a timing side-channel on the shared secret.
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const totals = await runScheduledSync();
  return NextResponse.json(totals);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
