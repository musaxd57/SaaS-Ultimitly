import "server-only";

import { prisma } from "@/lib/db";
import { emailService } from "@/lib/email";
import { qrEscalationEmail } from "@/lib/email-templates";
import { appBaseUrl } from "@/lib/auth/email-verify";
import { reportError } from "@/lib/report-error";

// ---------------------------------------------------------------------------
// QR concierge escalation e-mail (Codex #15 + hardening round).
//
// When the public QR chat escalates ("mesajınızı ev sahibine ilettim"), that
// promise is only real if the host actually finds out — this mails the host a
// MINIMAL alert: no guest text, no name, no codes — plain reason + panel link.
//
// Safety posture:
//   * ENV-GATED, default OFF (QR_ESCALATION_EMAIL_ENABLED=1) — no existing
//     customer gets a surprise e-mail from a deploy.
//   * DEDUPE IS BOUND TO THE EVENT (the triggering inbound Message id), not a
//     long window: the SAME event can never double-mail (retries/races lose
//     the conditional updateMany), while a genuinely NEW incident — e.g. a
//     safety emergency hours after a complaint — ALWAYS alerts. A short
//     anti-flood cooldown (minutes) is the only time component, so a hostile
//     guest can't turn the host's inbox into a mail bomb via message spam.
//   * TENANT-BOUND claim: the updateMany matches the reservation ONLY through
//     the caller's organizationId — a cross-tenant id mix-up claims nothing
//     and sends nothing.
//   * NEVER throws / never blocks the chat: ANY failure after the claim
//     (template, recipient lookup, transport — expected or not) releases the
//     claim under an exact (messageId + claimedAt) guard and goes to
//     reportError — visible, and the next escalation retries.
//   * Recipient is PER-TENANT and ROLE-EXPLICIT: the org's own alertEmail,
//     else the org's oldest OWNER account (never an arbitrary oldest user,
//     never the env ALERT_EMAIL — that's the operator's address).
// ---------------------------------------------------------------------------

/** Anti-flood cooldown between DISTINCT alerted events of one stay. Short on
 *  purpose (Codex): a later, separate emergency must still alert — this only
 *  absorbs rapid same-incident bursts / hostile message spam. */
export const QR_ESCALATION_COOLDOWN_MS = 5 * 60 * 1000;

export type QrEscalationReason = "ai_escalated" | "daily_cap";

export function qrEscalationEmailEnabled(): boolean {
  return process.env.QR_ESCALATION_EMAIL_ENABLED === "1";
}

/**
 * Send the host ONE e-mail per escalated QR-chat EVENT (identity = the inbound
 * Message id). Fire-safe: never throws, never affects the chat response.
 */
export async function maybeSendQrEscalationEmail(args: {
  organizationId: string;
  propertyName: string;
  reservationId: string;
  /** The inbound guest Message that forced this escalation — the dedupe identity. */
  triggerMessageId: string;
  reason: QrEscalationReason;
}): Promise<{ sent: boolean; deduped?: boolean }> {
  try {
    if (!qrEscalationEmailEnabled()) return { sent: false };
    if (!args.triggerMessageId) return { sent: false }; // no identity → no claim, no mail

    // ATOMIC claim, bound to (tenant, event): whoever flips the row owns the
    // send. Conditions: the reservation must belong to the caller's org, this
    // exact event must not have been alerted already, and the short anti-flood
    // cooldown must have passed. (Explicit null-branches: Prisma's `not`
    // filter on a nullable column would silently exclude NULL rows.)
    const claimedAt = new Date();
    const cooledBefore = new Date(claimedAt.getTime() - QR_ESCALATION_COOLDOWN_MS);
    const claimed = await prisma.reservation.updateMany({
      where: {
        id: args.reservationId,
        property: { organizationId: args.organizationId }, // tenant bind
        AND: [
          {
            OR: [
              { qrEscalationEmailMessageId: null },
              { qrEscalationEmailMessageId: { not: args.triggerMessageId } }, // same event never re-mails
            ],
          },
          {
            OR: [{ qrEscalationEmailAt: null }, { qrEscalationEmailAt: { lt: cooledBefore } }],
          },
        ],
      },
      data: { qrEscalationEmailAt: claimedAt, qrEscalationEmailMessageId: args.triggerMessageId },
    });
    if (claimed.count !== 1) return { sent: false, deduped: true };

    // Release ONLY our own claim (exact event + exact timestamp guard) so a
    // newer claim can never be clobbered. Best-effort by design.
    const releaseClaim = () =>
      prisma.reservation
        .updateMany({
          where: {
            id: args.reservationId,
            qrEscalationEmailMessageId: args.triggerMessageId,
            qrEscalationEmailAt: claimedAt,
          },
          data: { qrEscalationEmailAt: null, qrEscalationEmailMessageId: null },
        })
        .catch(() => {});

    // EVERYTHING after the claim is guarded: an unexpected exception must not
    // leave the claim consumed with no mail sent (Codex hardening item 3).
    try {
      // Per-tenant recipient: org alertEmail → the org's oldest OWNER account.
      // Role-explicit (Codex item 2): "oldest user" could be a staff member.
      const org = await prisma.organization.findUnique({
        where: { id: args.organizationId },
        select: {
          alertEmail: true,
          users: {
            where: { role: "owner" },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { email: true },
          },
        },
      });
      const to = org?.alertEmail?.trim() || org?.users[0]?.email?.trim();
      if (!to) {
        // No one to mail — release so a recipient configured later still gets
        // alerted about a NEW incident (not a stale suppressed claim).
        await releaseClaim();
        return { sent: false };
      }

      const html = qrEscalationEmail(args.propertyName, args.reason, `${appBaseUrl()}/guest-chats`);
      const result = await emailService.sendReporting(
        to,
        `⚠️ Misafir sohbetinde size devredilen mesaj — ${args.propertyName}`,
        html,
      );
      if (!result.ok) {
        // VISIBLE failure + claim release so the next escalation retries
        // instead of silently losing the alert.
        await releaseClaim();
        await reportError(
          `qr-escalation-email (org ${args.organizationId})`,
          new Error(result.error ?? "unknown email failure"),
        ).catch(() => {});
        return { sent: false };
      }
      return { sent: true };
    } catch (err) {
      await releaseClaim();
      throw err; // outer catch reports it
    }
  } catch (err) {
    // The chat's delivery semantics must never depend on the alert path.
    await reportError(`qr-escalation-email (org ${args.organizationId})`, err).catch(() => {});
    return { sent: false };
  }
}
