import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isHospitableConfigured } from "@/lib/hospitable";
import { syncHospitable } from "@/lib/hospitable-sync";
import { runDueChannelAutoReplies, sendDueWelcomes, sendDueCheckouts } from "@/lib/automation";

// ---------------------------------------------------------------------------
// Scheduled sync + night auto-reply (the engine behind 24/7 operation).
//
// A hosting scheduler (Vercel Cron, Railway/Render cron, cron-job.org, a GitHub
// Action, ...) calls this on an interval. For each organization it pulls new
// Hospitable messages and then runs the auto-reply pass — which is a no-op
// unless auto-reply is enabled AND we are inside the active-hours window. So it
// is safe to call frequently around the clock; replies only go out at night.
//
// Auth: requires CRON_SECRET (env). Accepts it via the Authorization: Bearer
// header (Vercel Cron style), an x-cron-secret header, or a ?secret= query
// param. Without a configured secret the endpoint refuses to run.
// ---------------------------------------------------------------------------

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // never expose an unauthenticated trigger
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const provided =
    bearer ?? req.headers.get("x-cron-secret") ?? new URL(req.url).searchParams.get("secret");
  return provided === secret;
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isHospitableConfigured()) {
    return NextResponse.json({ ok: false, error: "HOSPITABLE_API_TOKEN not configured" });
  }

  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const totals = {
    organizations: orgs.length,
    conversations: 0,
    messages: 0,
    autoReplies: 0,
    welcomes: 0,
    checkouts: 0,
  };

  for (const org of orgs) {
    try {
      const result = await syncHospitable(org.id);
      const auto = await runDueChannelAutoReplies(org.id);
      const welcome = await sendDueWelcomes(org.id);
      const checkout = await sendDueCheckouts(org.id);
      totals.conversations += result.conversations;
      totals.messages += result.messages;
      totals.autoReplies += auto.sent;
      totals.welcomes += welcome.sent;
      totals.checkouts += checkout.sent;
    } catch (err) {
      // One org failing must not abort the rest.
      console.error(`[cron/sync] failed for organization ${org.id}`, err);
    }
  }

  return NextResponse.json({ ok: true, ...totals });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
