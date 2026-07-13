import "server-only";

import { prisma } from "@/lib/db";
import { emailService } from "@/lib/email";
import { qrEscalationEmail } from "@/lib/email-templates";
import { appBaseUrl } from "@/lib/auth/email-verify";
import { reportError } from "@/lib/report-error";

// ---------------------------------------------------------------------------
// QR concierge escalation e-mail (Codex #15).
//
// When the public QR chat escalates ("mesajınızı ev sahibine ilettim"), that
// promise is only real if the host actually finds out — today the thread just
// sits in the "Misafir Sohbetleri" tab. This mails the host a MINIMAL alert:
// no guest text, no name, no codes — plain reason + a panel link.
//
// Safety posture:
//   * ENV-GATED, default OFF (QR_ESCALATION_EMAIL_ENABLED=1) — no existing
//     customer gets a surprise e-mail from a deploy.
//   * DEDUPED per stay via an atomic windowed claim on
//     Reservation.qrEscalationEmailAt: an escalation burst (guest repeats the
//     question, cap-hit spam) sends ONE mail; a genuinely new incident after
//     the re-arm window mails again.
//   * NEVER throws / never blocks the chat: a failure releases the claim (so
//     the next escalation retries) and goes to reportError — visible, not
//     swallowed.
//   * Recipient is PER-TENANT: the org's own alertEmail, else the org owner's
//     (oldest user's) account e-mail. NEVER the env ALERT_EMAIL fallback —
//     that's the operator's address, other tenants' alerts must not leak there.
// ---------------------------------------------------------------------------

/** A later escalation re-arms the alert after this long (same-incident bursts
 *  inside the window stay deduped). */
export const QR_ESCALATION_REARM_MS = 6 * 60 * 60 * 1000;

export type QrEscalationReason = "ai_escalated" | "daily_cap";

export function qrEscalationEmailEnabled(): boolean {
  return process.env.QR_ESCALATION_EMAIL_ENABLED === "1";
}

/**
 * Send the host ONE e-mail about an escalated QR-chat message of this stay
 * (windowed dedupe). Fire-safe: never throws, never affects the chat response.
 */
export async function maybeSendQrEscalationEmail(args: {
  organizationId: string;
  propertyName: string;
  reservationId: string;
  reason: QrEscalationReason;
}): Promise<{ sent: boolean; deduped?: boolean }> {
  try {
    if (!qrEscalationEmailEnabled()) return { sent: false };

    // ATOMIC windowed claim — mirrors the trial-mail / alert-claim pattern:
    // whoever flips the timestamp owns the send; concurrent escalations lose
    // the updateMany race and skip. claimedAt is OUR unique marker so a failed
    // send only releases its OWN claim (never a newer one).
    const claimedAt = new Date();
    const rearmBefore = new Date(claimedAt.getTime() - QR_ESCALATION_REARM_MS);
    const claimed = await prisma.reservation.updateMany({
      where: {
        id: args.reservationId,
        OR: [{ qrEscalationEmailAt: null }, { qrEscalationEmailAt: { lt: rearmBefore } }],
      },
      data: { qrEscalationEmailAt: claimedAt },
    });
    if (claimed.count !== 1) return { sent: false, deduped: true };

    const releaseClaim = () =>
      prisma.reservation
        .updateMany({
          where: { id: args.reservationId, qrEscalationEmailAt: claimedAt },
          data: { qrEscalationEmailAt: null },
        })
        .catch(() => {}); // release is best-effort; worst case = one 6h window skipped

    // Per-tenant recipient (sendDueAlerts contract): org alertEmail → owner email.
    const org = await prisma.organization.findUnique({
      where: { id: args.organizationId },
      select: {
        alertEmail: true,
        users: { orderBy: { createdAt: "asc" }, take: 1, select: { email: true } },
      },
    });
    const to = org?.alertEmail?.trim() || org?.users[0]?.email?.trim();
    if (!to) {
      // No one to mail — release so a recipient configured later still gets
      // alerted about a NEW incident (not a stale suppressed window).
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
      // VISIBLE failure (Codex requirement) + claim release so the next
      // escalation retries instead of silently losing the alert for 6 hours.
      await releaseClaim();
      await reportError(
        `qr-escalation-email (org ${args.organizationId})`,
        new Error(result.error ?? "unknown email failure"),
      ).catch(() => {});
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    // The chat's delivery semantics must never depend on the alert path.
    await reportError(`qr-escalation-email (org ${args.organizationId})`, err).catch(() => {});
    return { sent: false };
  }
}
