import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Public health probe. NO auth, NO tenant data and NO external-service calls —
// Paddle/Hospitable/OpenAI state must never flip this endpoint. It reads exactly
// two signals: DB connectivity and the scheduler heartbeat.
//
// NORMAL /api/health — Railway readiness + basic uptime monitor:
//   200 ⇔ the app answers and the DB is reachable. Scheduler state is REPORTED
//   (sync / lastSyncAgeSec) but never fails the probe, so a fresh deploy (no
//   heartbeat row yet) or a post-deploy gap can't flap readiness.
//   DB unreachable → 503 { reason: "db_unreachable" }.
//
// STRICT /api/health?strict=1 — ops monitor (point a SECOND monitor here):
//   additionally 503 when the scheduler heartbeat is missing/unreadable
//   ("sync_unknown") or older than SYNC_STALE_AFTER_SEC ("sync_stale"), so a
//   silently-dead sync loop actually pages you.
//
// Heartbeat = SystemLock("scheduled-sync").updatedAt: every scheduler pass bumps
// it (acquire + release), INCLUDING passes that do no work — zero orgs, per-org
// Hospitable 402 skips, free-tier automation suppression, or a concurrent run
// still holding the lock (its acquire stamped updatedAt). Healthy means "the
// scheduler ran", never "messages flowed" — an inactive Hospitable subscription
// or an intentionally skipped pass is NOT an outage.
//
// Body is machine-readable: { ok, db, sync, lastSyncAgeSec, reason? }; reason
// appears only on 503. Cache-Control: no-store so no proxy/CDN ever serves a
// stale verdict to a monitor.
// ---------------------------------------------------------------------------

// The loop fires every ~2 min (in-process timer + external cron) and the sync
// lock TTL is 15 min: 15 min of heartbeat silence means every trigger AND the
// lock TTL have lapsed — genuinely dead, not merely a long deep-sync pass.
const SYNC_STALE_AFTER_SEC = 15 * 60;

type Health = {
  ok: boolean;
  db: "up" | "down";
  sync: "ok" | "stale" | "unknown";
  lastSyncAgeSec: number | null;
  reason?: "db_unreachable" | "sync_stale" | "sync_unknown";
};

function respond(body: Health, status: 200 | 503) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const strict = req.nextUrl.searchParams.get("strict") === "1";

  // 1. DB connectivity — fatal in BOTH modes.
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return respond(
      { ok: false, db: "down", sync: "unknown", lastSyncAgeSec: null, reason: "db_unreachable" },
      503,
    );
  }

  // 2. Scheduler heartbeat, best-effort: a failed read is reported as "unknown"
  //    (strict mode decides whether that pages) — never crashes the probe.
  let lastSyncAgeSec: number | null = null;
  let sync: Health["sync"] = "unknown";
  try {
    const lock = await prisma.systemLock.findUnique({
      where: { name: "scheduled-sync" },
      select: { updatedAt: true },
    });
    if (lock) {
      lastSyncAgeSec = Math.max(0, Math.round((Date.now() - lock.updatedAt.getTime()) / 1000));
      sync = lastSyncAgeSec <= SYNC_STALE_AFTER_SEC ? "ok" : "stale";
    }
  } catch {
    // DB answered SELECT 1 but the heartbeat row is unreadable → stay "unknown".
  }

  // 3. Verdict. Normal mode is readiness-only; strict pages on a dead scheduler.
  if (strict && sync !== "ok") {
    return respond(
      { ok: false, db: "up", sync, lastSyncAgeSec, reason: sync === "stale" ? "sync_stale" : "sync_unknown" },
      503,
    );
  }
  return respond({ ok: true, db: "up", sync, lastSyncAgeSec }, 200);
}
