import "server-only";

import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Duplicate-conversation cleanup
//
// When a channel (e.g. Airbnb via Hospitable) is disconnected and reconnected,
// the provider can re-issue reservation IDs. The same guest thread then ends up
// split across an OLD (stale) and a NEW conversation under the same apartment —
// "Mesajları çek" only ever adds/updates, never deletes, so the stale copy
// lingers in the inbox forever. This removes those stale copies.
//
// SAFE BY DESIGN — never loses a message:
//   * Only Hospitable-sourced conversations (externalReservationId set).
//   * Groups by (propertyId, guest name).
//   * In each group the conversation with the MOST messages is the "keeper".
//   * A duplicate is deleted ONLY when EVERY one of its messages (compared by
//     normalised body) already exists in the keeper — i.e. the keeper is a strict
//     content superset. If a duplicate holds ANY message the keeper lacks, it is
//     LEFT untouched (counted in needsReview) for the host to review by hand.
//
// CONTENT SUBSET IS NOT ENOUGH — IDENTITY MUST BE PROVEN (audit 07-25).
// The body-subset test alone deleted REAL data: a returning guest in the SAME
// apartment produces two DIFFERENT stays whose short/generic messages
// ("Merhaba", "Teşekkürler") trivially make the older thread a subset of the
// newer one. The older stay — messages and all — was destroyed by a manager
// pressing a maintenance button, with no flag and no undo.
//
// So a duplicate is now deleted ONLY when the two rows are PROVABLY the same
// stay:
//   (a) identical non-null local reservationId, OR
//   (b) both link to reservations with the SAME arrival AND departure date —
//       this is the reconnect case the tool exists for (the provider re-issued
//       the reservation id for one real stay).
// No linked reservation on either side ⇒ identity cannot be proven ⇒ review.
// Conflicting non-null externalConversationId ⇒ possibly two genuine provider
// threads ⇒ review, never delete.
//
// Deliberately conservative: needsReview costs the host a manual look; a wrong
// delete costs them a guest's history permanently.
// ---------------------------------------------------------------------------

export interface DuplicateCleanupResult {
  removed: number; // stale duplicate conversations deleted
  groups: number; // guest+property groups that had more than one conversation
  needsReview: number; // duplicates left in place because they held unique messages
}

/** Normalise a message body so trivial whitespace/case differences still match. */
function normBody(body: string): string {
  return body.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Normalise a guest identifier for grouping. */
function normGuest(name: string | null): string {
  return (name ?? "").trim().toLowerCase();
}

/** The identity signals a conversation carries about WHICH stay it belongs to. */
interface StayIdentity {
  reservationId: string | null;
  externalConversationId: string | null;
  reservation: { id: string; arrivalDate: Date; departureDate: Date } | null;
}

/**
 * Are these two rows PROVABLY the same stay? Fail-closed: anything we cannot
 * prove returns false and the caller leaves the row alone.
 *
 * Same local reservation is conclusive. Otherwise the reconnect case — the
 * provider re-issued the reservation id for one real stay — is recognised by
 * two DIFFERENT reservation rows describing the SAME window. Two different
 * stays by the same guest in the same apartment necessarily differ in at least
 * one of those dates, which is exactly what stops them from merging.
 */
function sameStay(a: StayIdentity, b: StayIdentity): boolean {
  if (a.reservationId && b.reservationId && a.reservationId === b.reservationId) return true;
  if (!a.reservation || !b.reservation) return false; // unlinked ⇒ unprovable
  return (
    a.reservation.arrivalDate.getTime() === b.reservation.arrivalDate.getTime() &&
    a.reservation.departureDate.getTime() === b.reservation.departureDate.getTime()
  );
}

/**
 * Two non-null but DIFFERENT provider conversation ids mean the provider itself
 * distinguishes these threads. Whether that is legitimate is unresolved (the
 * codebase contains contradicting claims and the official API docs were not
 * reachable), so this is treated as "hands off, let a human decide".
 */
function conversationIdsConflict(a: StayIdentity, b: StayIdentity): boolean {
  return (
    a.externalConversationId != null &&
    b.externalConversationId != null &&
    a.externalConversationId !== b.externalConversationId
  );
}

export async function cleanupDuplicateConversations(
  organizationId: string,
): Promise<DuplicateCleanupResult> {
  const result: DuplicateCleanupResult = { removed: 0, groups: 0, needsReview: 0 };

  const conversations = await prisma.conversation.findMany({
    where: {
      property: { organizationId },
      externalReservationId: { not: null },
    },
    select: {
      id: true,
      propertyId: true,
      guestIdentifier: true,
      lastMessageAt: true,
      reservationId: true,
      externalConversationId: true,
      // Stay identity: the dates are what make "same stay" provable across a
      // provider id re-issue.
      reservation: { select: { id: true, arrivalDate: true, departureDate: true } },
      messages: { select: { body: true } },
    },
  });

  // Group by property + guest.
  const groups = new Map<string, typeof conversations>();
  for (const c of conversations) {
    const key = `${c.propertyId}::${normGuest(c.guestIdentifier)}`;
    const arr = groups.get(key);
    if (arr) arr.push(c);
    else groups.set(key, [c]);
  }

  for (const convs of groups.values()) {
    if (convs.length < 2) continue; // nothing duplicated for this guest+apartment
    result.groups++;

    // Keeper = the most complete thread (most messages); tie-break on most recent
    // activity so the freshest copy wins.
    const sorted = [...convs].sort((a, b) => {
      if (b.messages.length !== a.messages.length) return b.messages.length - a.messages.length;
      return (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0);
    });
    const keeper = sorted[0];
    const keeperBodies = new Set(keeper.messages.map((m) => normBody(m.body)));

    for (const dup of sorted.slice(1)) {
      // Delete only when the keeper already contains EVERYTHING this duplicate has.
      const isSubset = dup.messages.every((m) => keeperBodies.has(normBody(m.body)));
      if (!isSubset) {
        result.needsReview++; // divergent — never risk losing a message
        continue;
      }
      if (!sameStay(keeper, dup) || conversationIdsConflict(keeper, dup)) {
        result.needsReview++; // identity unproven / two possible provider threads
        continue;
      }
      await prisma.$transaction([
        prisma.message.deleteMany({ where: { conversationId: dup.id } }),
        prisma.conversation.delete({ where: { id: dup.id } }),
      ]);
      result.removed++;
    }
  }

  return result;
}
