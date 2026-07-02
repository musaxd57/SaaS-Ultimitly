import { subMonths, startOfDay } from "date-fns";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// KVKK / data-retention + erasure.
//
//  * anonymizeOldGuestData — automatic retention sweep. OFF by default; only does
//    work when DATA_RETENTION_MONTHS is set (>0). Once a guest's stay is older than
//    that window, their PERSONAL data (name/phone/email + the guest's own message
//    bodies + the guest-identifier on the thread) is irreversibly scrubbed. We
//    ANONYMIZE rather than hard-delete so occupancy/report history stays intact
//    while the personal data is gone. Batched → the cron chips away, no long lock.
//
//  * deleteAccountData — full account erasure (the host's "delete my account" /
//    KVKK right-to-erasure). Deleting the Organization cascades to users,
//    properties → reservations/conversations/messages/tasks/KB/templates/calendar,
//    automation rules, audit logs, subscription, invoices (all onDelete: Cascade).
//    ChatUsage has no FK relation, so it's cleared explicitly first.
// ---------------------------------------------------------------------------

const ANON_NAME = "Eski misafir";
const ANON_ID = "Misafir";
const ANON_BODY = "[saklama süresi doldu — içerik silindi]";

/** How many old reservations to scrub per call — bounds work / lock time. */
const RETENTION_BATCH = 300;

/**
 * Anonymize guest personal data for stays that ended before the retention window.
 * No-op unless DATA_RETENTION_MONTHS is a positive number. Returns how many
 * reservations were scrubbed (0 when disabled or nothing is due).
 */
export async function anonymizeOldGuestData(now: Date = new Date()): Promise<{ anonymized: number }> {
  const months = Number(process.env.DATA_RETENTION_MONTHS);
  if (!Number.isFinite(months) || months <= 0) return { anonymized: 0 }; // disabled by default
  const cutoff = subMonths(startOfDay(now), months);

  let anonymized = 0;

  // (1) Reservation-linked guest data. Reservations whose stay ended before the
  // cutoff and still carry real PII (guestName not yet anonymized). Bounded batch.
  const oldRes = await prisma.reservation.findMany({
    where: { departureDate: { lt: cutoff }, guestName: { not: ANON_NAME } },
    select: { id: true },
    take: RETENTION_BATCH,
  });
  if (oldRes.length > 0) {
    const resIds = oldRes.map((r) => r.id);
    const convs = await prisma.conversation.findMany({
      where: { reservationId: { in: resIds } },
      select: { id: true },
    });
    const convIds = convs.map((c) => c.id);

    await prisma.$transaction([
      // The guest's OWN messages (inbound) carry their words/PII — scrub the body.
      // Outbound (host/AI) content is the host's own record and is left intact.
      ...(convIds.length
        ? [
            prisma.message.updateMany({
              where: { conversationId: { in: convIds }, direction: "inbound", body: { not: ANON_BODY } },
              data: { body: ANON_BODY, senderName: ANON_ID, aiSuggestedReply: null },
            }),
            prisma.conversation.updateMany({
              where: { id: { in: convIds } },
              data: { guestIdentifier: ANON_ID },
            }),
          ]
        : []),
      prisma.reservation.updateMany({
        where: { id: { in: resIds } },
        data: {
          guestName: ANON_NAME,
          guestPhone: null,
          guestEmail: null,
          guestExternalId: null,
          guestCheckoutTime: null,
          notes: null,
        },
      }),
    ]);
    anonymized += resIds.length;
  }

  // (2) Orphaned conversations with NO reservation link. These never reach the
  // reservation-driven sweep above, so their guest PII would otherwise live
  // FOREVER: manual/unmatched threads, or — critically — threads whose reservation
  // the host deleted (Conversation.reservation is onDelete: SetNull). Age them by
  // their own lastMessageAt so the privacy promise ("veriler saklama süresi
  // sonunda anonimleştirilir") actually holds for every thread, not just linked ones.
  const orphanConvs = await prisma.conversation.findMany({
    where: {
      reservationId: null,
      lastMessageAt: { lt: cutoff },
      guestIdentifier: { not: ANON_ID },
    },
    select: { id: true },
    take: RETENTION_BATCH,
  });
  if (orphanConvs.length > 0) {
    const orphanIds = orphanConvs.map((c) => c.id);
    await prisma.$transaction([
      prisma.message.updateMany({
        where: { conversationId: { in: orphanIds }, direction: "inbound", body: { not: ANON_BODY } },
        data: { body: ANON_BODY, senderName: ANON_ID, aiSuggestedReply: null },
      }),
      prisma.conversation.updateMany({
        where: { id: { in: orphanIds } },
        data: { guestIdentifier: ANON_ID },
      }),
    ]);
    anonymized += orphanIds.length;
  }

  return { anonymized };
}

/**
 * Delete marketing leads past the lead-retention window. Prospect PII (name /
 * email / phone / message) has no other lifecycle — Lead has no org link, so it is
 * NOT covered by account erasure or the guest-data sweep — and would otherwise be
 * kept indefinitely. Gated by its OWN env var (default OFF) so a host's active
 * sales pipeline is never silently purged: set LEAD_RETENTION_MONTHS to enable.
 */
export async function purgeOldLeads(now: Date = new Date()): Promise<{ purged: number }> {
  const months = Number(process.env.LEAD_RETENTION_MONTHS);
  if (!Number.isFinite(months) || months <= 0) return { purged: 0 }; // disabled by default
  const cutoff = subMonths(startOfDay(now), months);
  const res = await prisma.lead.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return { purged: res.count };
}

/**
 * Full account erasure for one organization. Irreversible. The caller MUST have
 * already authorized this (owner re-authenticated). Returns silently on success.
 */
export async function deleteAccountData(organizationId: string): Promise<void> {
  // ChatUsage rows key on propertyId but have no FK relation → won't cascade.
  const props = await prisma.property.findMany({
    where: { organizationId },
    select: { id: true },
  });
  const propIds = props.map((p) => p.id);
  if (propIds.length > 0) {
    await prisma.chatUsage.deleteMany({ where: { propertyId: { in: propIds } } });
  }
  // Everything else cascades from the organization row.
  await prisma.organization.delete({ where: { id: organizationId } });
}
