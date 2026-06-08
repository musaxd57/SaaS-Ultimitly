import "server-only";

import { prisma } from "@/lib/db";
import { syncHospitable } from "@/lib/hospitable-sync";
import { reportError } from "@/lib/report-error";
import {
  runDueChannelAutoReplies,
  sendDueWelcomes,
  sendDueCheckins,
  sendDueCheckouts,
  sendDueAlerts,
  refreshStyleProfile,
} from "@/lib/automation";

// ---------------------------------------------------------------------------
// The one scheduled pass: pull new Hospitable messages for every organization,
// then run the auto-reply / welcome / checkout passes. Shared by BOTH triggers:
//   1. The external scheduler hitting /api/cron/sync (cron-job.org).
//   2. The in-process timer in instrumentation.ts (a self-contained backup so a
//      single failing scheduler can't silently stop the whole system).
//
// Idempotent and safe to call concurrently: message import de-duplicates by
// provider id, welcomes/checkouts are stamped once per booking, and auto-reply
// only ever answers the guest's latest UNANSWERED message. An in-process lock
// still skips overlapping runs to avoid wasted work.
// ---------------------------------------------------------------------------

export interface ScheduledSyncTotals {
  ok: boolean;
  error?: string;
  organizations: number;
  conversations: number;
  messages: number;
  autoReplies: number;
  welcomes: number;
  checkins: number;
  checkouts: number;
  alerts: number;
}

function zero(): ScheduledSyncTotals {
  return {
    ok: true,
    organizations: 0,
    conversations: 0,
    messages: 0,
    autoReplies: 0,
    welcomes: 0,
    checkins: 0,
    checkouts: 0,
    alerts: 0,
  };
}

const LOCK_NAME = "scheduled-sync";
const LOCK_TTL_MS = 5 * 60 * 1000; // auto-release if a holder crashes mid-run

// Fast in-process guard (same instance) on top of the cross-instance DB lock.
let running = false;

// Two-speed sweep: most runs use a NARROW reservation window (cheap, ~every 2
// min); a WIDE "catch-up" window runs at most once per HOSPITABLE_DEEP_EVERY_MIN
// so a guest who checked out long ago but messages now is still imported —
// without paying the wide sweep on every run. Starts at 0 so the first run after
// a restart is a deep one.
let lastDeepSyncAt = 0;

/** Take the cross-instance lock if it is free; safe to call from any replica. */
async function acquireLock(): Promise<boolean> {
  const now = new Date();
  const until = new Date(now.getTime() + LOCK_TTL_MS);
  // Ensure the row exists with a past expiry so the first ever run can acquire.
  await prisma.systemLock.upsert({
    where: { name: LOCK_NAME },
    create: { name: LOCK_NAME, lockedUntil: new Date(0) },
    update: {},
  });
  // Atomic: only one caller's updateMany can match a free lock.
  const res = await prisma.systemLock.updateMany({
    where: { name: LOCK_NAME, lockedUntil: { lte: now } },
    data: { lockedUntil: until },
  });
  return res.count === 1;
}

async function releaseLock(): Promise<void> {
  await prisma.systemLock
    .updateMany({ where: { name: LOCK_NAME }, data: { lockedUntil: new Date(0) } })
    .catch(() => {});
}

export async function runScheduledSync(): Promise<ScheduledSyncTotals> {
  // Multi-tenant: no global token gate here. Each org self-gates on ITS OWN
  // Hospitable connection (syncHospitable + the automation senders return early
  // when the org has no token), so orgs that aren't connected are simply skipped.
  if (running) {
    return { ...zero(), ok: false, error: "already_running" };
  }
  running = true;
  try {
    if (!(await acquireLock())) {
      return { ...zero(), ok: false, error: "locked" };
    }
    try {
      const totals = zero();
      const orgs = await prisma.organization.findMany({ select: { id: true } });
      totals.organizations = orgs.length;

      // Decide once per run: narrow (frequent, light) or wide (hourly catch-up).
      // Narrow keeps the every-2-min reservation sweep cheap; the wide window runs
      // at most hourly to still pick up far-future bookings and long-ago guests
      // who message now. All tunable via env, sensible defaults baked in.
      const deepEveryMs = (Number(process.env.HOSPITABLE_DEEP_EVERY_MIN) || 60) * 60_000;
      const deep = Date.now() - lastDeepSyncAt >= deepEveryMs;
      if (deep) lastDeepSyncAt = Date.now();
      const window = deep
        ? {
            backDays: Number(process.env.HOSPITABLE_DEEP_BACK_DAYS) || 540,
            forwardDays: Number(process.env.HOSPITABLE_DEEP_FORWARD_DAYS) || 540,
          }
        : {
            backDays: Number(process.env.HOSPITABLE_SYNC_BACK_DAYS) || 90,
            forwardDays: Number(process.env.HOSPITABLE_SYNC_FORWARD_DAYS) || 120,
          };

      for (const org of orgs) {
        try {
          const result = await syncHospitable(org.id, window);
          // Keep the host's style profile fresh (self-throttles to once a day).
          await refreshStyleProfile(org.id);
          // Flag complaints (→ "problem") BEFORE the auto-reply pass so they are
          // routed to a human and never auto-answered.
          const alert = await sendDueAlerts(org.id);
          const auto = await runDueChannelAutoReplies(org.id);
          const welcome = await sendDueWelcomes(org.id);
          const checkin = await sendDueCheckins(org.id);
          const checkout = await sendDueCheckouts(org.id);
          totals.conversations += result.conversations;
          totals.messages += result.messages;
          totals.autoReplies += auto.sent;
          totals.welcomes += welcome.sent;
          totals.checkins += checkin.sent;
          totals.checkouts += checkout.sent;
          totals.alerts += alert.alerted;
        } catch (err) {
          // One org failing must not abort the rest.
          await reportError(`scheduled-sync org ${org.id}`, err);
        }
      }
      return totals;
    } finally {
      await releaseLock();
    }
  } finally {
    running = false;
  }
}
