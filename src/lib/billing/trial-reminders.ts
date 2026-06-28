import "server-only";

import { prisma } from "@/lib/db";
import { emailService } from "@/lib/email";
import { trialEndingSoonEmail, trialEndedEmail } from "@/lib/email-templates";
import { billingEnforced } from "./subscription";

// ---------------------------------------------------------------------------
// Reverse-trial reminder emails. Fired from the scheduled-sync DEEP pass.
//
// Design (matches the project's safety rules):
//   * ONLY when BILLING_ENFORCED=true — otherwise an expired trial keeps full
//     access, so "your access pauses" would be a lie. Dormant-safe: enforcement
//     off → no trial emails at all.
//   * IDEMPOTENT — each email is "claimed" with an atomic updateMany (stamp the
//     sent-at column only if still null). A second cron pass sends nothing. If
//     the send throws, the stamp is rolled back so it retries next cycle.
//   * Per-tenant recipient = the org owner's own login email (the person who
//     signed up). NEVER an env/operator address.
//   * The "ended" email only fires within a recency window so flipping
//     enforcement on never blasts mails about trials that lapsed long ago.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

// Send the "ending soon" mail when this many whole days (or fewer) remain.
const ENDING_SOON_DAYS = Number(process.env.TRIAL_REMINDER_DAYS) || 2;
// Don't email about a trial that ended more than this long ago (safety bound).
const ENDED_GRACE_DAYS = 30;

/** Absolute settings URL for the email CTA (no request host in cron context). */
function settingsUrl(): string {
  const base = (process.env.APP_BASE_URL || "https://www.lixusai.com").replace(/\/+$/, "");
  return `${base}/settings`;
}

export type TrialReminderResult = { ending: number; ended: number };

export async function sendDueTrialReminders(now: Date = new Date()): Promise<TrialReminderResult> {
  // Truthful only when expiry actually pauses automation.
  if (!billingEnforced()) return { ending: 0, ended: 0 };

  const nowMs = now.getTime();
  const result: TrialReminderResult = { ending: 0, ended: 0 };

  // A lapsed trial keeps status "trialing" (expiry is derived live, no cron
  // flips it), so this one query covers both "ending soon" and "just ended".
  const subs = await prisma.subscription.findMany({
    where: { status: "trialing", trialEndsAt: { not: null } },
    select: {
      id: true,
      trialEndsAt: true,
      trialEndingSentAt: true,
      trialEndedSentAt: true,
      organization: {
        select: {
          users: { orderBy: { createdAt: "asc" }, take: 1, select: { email: true, name: true } },
        },
      },
    },
  });

  for (const sub of subs) {
    const endsAt = sub.trialEndsAt;
    if (!endsAt) continue;
    const owner = sub.organization.users[0];
    const to = owner?.email?.trim();
    if (!to) continue; // no recipient — skip without claiming so it can fire later
    const ownerName = owner?.name?.trim() || "merhaba";
    const endsMs = endsAt.getTime();

    if (endsMs <= nowMs) {
      // TRIAL ENDED — once, within the grace window.
      if (sub.trialEndedSentAt) continue;
      if (nowMs - endsMs > ENDED_GRACE_DAYS * DAY_MS) continue;
      const claimed = await prisma.subscription.updateMany({
        where: { id: sub.id, trialEndedSentAt: null },
        data: { trialEndedSentAt: now },
      });
      if (claimed.count !== 1) continue; // another run won the claim
      try {
        await emailService.send(to, "Lixus AI — Ücretsiz denemeniz sona erdi", trialEndedEmail(ownerName, settingsUrl()));
        result.ended++;
      } catch {
        // Roll back so a transient mail failure retries next cycle.
        await prisma.subscription.update({ where: { id: sub.id }, data: { trialEndedSentAt: null } }).catch(() => {});
      }
    } else {
      // STILL IN TRIAL — send the "ending soon" nudge once, within N days of end.
      if (sub.trialEndingSentAt) continue;
      const daysLeft = Math.ceil((endsMs - nowMs) / DAY_MS);
      if (daysLeft > ENDING_SOON_DAYS) continue;
      const claimed = await prisma.subscription.updateMany({
        where: { id: sub.id, trialEndingSentAt: null },
        data: { trialEndingSentAt: now },
      });
      if (claimed.count !== 1) continue;
      try {
        await emailService.send(
          to,
          `Lixus AI — Pro denemeniz ${daysLeft <= 1 ? "yarın" : daysLeft + " gün sonra"} bitiyor`,
          trialEndingSoonEmail(ownerName, daysLeft, settingsUrl()),
        );
        result.ending++;
      } catch {
        await prisma.subscription.update({ where: { id: sub.id }, data: { trialEndingSentAt: null } }).catch(() => {});
      }
    }
  }

  return result;
}
