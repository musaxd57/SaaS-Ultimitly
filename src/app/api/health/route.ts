import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Public health probe for an external uptime monitor (UptimeRobot, Better Stack,
// ...). NO auth and NO tenant data — only DB connectivity and how long since the
// sync loop last ran, so an alert can fire if the cron silently dies.
//
//   { ok, db: "up"|"down", lastSyncAgeSec, sync: "ok"|"stale"|"unknown" }
//
// Returns 503 when the database is unreachable so the monitor flags it.
//
// STRICT MODE: add ?strict=1 → also returns 503 when sync is "stale" (the 2-min
// loop hasn't run in >15 min). Point a SECOND uptime monitor at /api/health?strict=1
// so a silently-dead sync loop actually pages you — the default probe stays lenient
// (200 with a sync field) so a transient post-deploy gap doesn't false-alarm.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const strict = req.nextUrl.searchParams.get("strict") === "1";
  // 1. DB connectivity — the one critical signal.
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return NextResponse.json({ ok: false, db: "down", sync: "unknown" }, { status: 503 });
  }

  // 2. Cron liveness: the scheduled sync touches the "scheduled-sync" SystemLock
  //    row on every run (acquire + release bump updatedAt), so its age is a proxy
  //    for "the 2-min loop is alive". > 15 min ⇒ something stopped.
  let lastSyncAgeSec: number | null = null;
  let sync: "ok" | "stale" | "unknown" = "unknown";
  try {
    const lock = await prisma.systemLock.findUnique({
      where: { name: "scheduled-sync" },
      select: { updatedAt: true },
    });
    if (lock) {
      lastSyncAgeSec = Math.max(0, Math.round((Date.now() - lock.updatedAt.getTime()) / 1000));
      sync = lastSyncAgeSec <= 15 * 60 ? "ok" : "stale";
    }
  } catch {
    // DB is up (above) — liveness is best-effort, don't fail the probe.
  }

  // In strict mode a stale sync loop is a failure the monitor should page on.
  const status = strict && sync === "stale" ? 503 : 200;
  return NextResponse.json({ ok: status === 200, db: "up", lastSyncAgeSec, sync }, { status });
}
