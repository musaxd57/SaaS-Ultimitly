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
      await prisma.$transaction([
        prisma.message.deleteMany({ where: { conversationId: dup.id } }),
        prisma.conversation.delete({ where: { id: dup.id } }),
      ]);
      result.removed++;
    }
  }

  return result;
}
