import { type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { drainEmailOutboxOnce, emailOutboxEnabled } from "@/lib/email-outbox";

// ---------------------------------------------------------------------------
// Identity e-mail outbox drain tick (Tur-4). The in-process 15s poller
// (instrumentation.ts) calls this over localhost — same shape as /api/cron/sync:
// instrumentation must not import Prisma/nodemailer, so it triggers the drain
// through this authenticated endpoint instead. An external scheduler MAY also
// call it for faster delivery on INTERNAL_CRON_DISABLED deployments (the 2-min
// /api/cron/sync pass drains too, as the recovery net).
//
// Auth: CRON_SECRET via Authorization: Bearer or x-cron-secret — identical
// contract to /api/cron/sync (never a query param: it would leak into logs).
// ---------------------------------------------------------------------------

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // never expose an unauthenticated trigger
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const provided = bearer ?? req.headers.get("x-cron-secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!emailOutboxEnabled()) {
    return NextResponse.json({ ok: true, disabled: true });
  }
  const out = await drainEmailOutboxOnce();
  return NextResponse.json({ ok: true, ...out });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
