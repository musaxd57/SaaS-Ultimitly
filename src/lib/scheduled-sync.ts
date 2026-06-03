import "server-only";

import { prisma } from "@/lib/db";
import { isHospitableConfigured } from "@/lib/hospitable";
import { syncHospitable } from "@/lib/hospitable-sync";
import {
  runDueChannelAutoReplies,
  sendDueWelcomes,
  sendDueCheckouts,
  sendDueAlerts,
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
    checkouts: 0,
    alerts: 0,
  };
}

// Prevents two overlapping passes (e.g. the external cron and the in-process
// timer firing at the same moment) from doing redundant work.
let running = false;

export async function runScheduledSync(): Promise<ScheduledSyncTotals> {
  if (!isHospitableConfigured()) {
    return { ...zero(), ok: false, error: "HOSPITABLE_API_TOKEN not configured" };
  }
  if (running) {
    return { ...zero(), ok: false, error: "already_running" };
  }
  running = true;
  try {
    const totals = zero();
    const orgs = await prisma.organization.findMany({ select: { id: true } });
    totals.organizations = orgs.length;

    for (const org of orgs) {
      try {
        const result = await syncHospitable(org.id);
        // Flag complaints (→ "problem") BEFORE the auto-reply pass so they are
        // routed to a human and never auto-answered.
        const alert = await sendDueAlerts(org.id);
        const auto = await runDueChannelAutoReplies(org.id);
        const welcome = await sendDueWelcomes(org.id);
        const checkout = await sendDueCheckouts(org.id);
        totals.conversations += result.conversations;
        totals.messages += result.messages;
        totals.autoReplies += auto.sent;
        totals.welcomes += welcome.sent;
        totals.checkouts += checkout.sent;
        totals.alerts += alert.alerted;
      } catch (err) {
        // One org failing must not abort the rest.
        console.error(`[scheduled-sync] failed for organization ${org.id}`, err);
      }
    }
    return totals;
  } finally {
    running = false;
  }
}
