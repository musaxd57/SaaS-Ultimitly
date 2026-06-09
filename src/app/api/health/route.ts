import { NextResponse } from "next/server";
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
// ---------------------------------------------------------------------------
export async function GET() {
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

  return NextResponse.json({ ok: true, db: "up", lastSyncAgeSec, sync });
}
