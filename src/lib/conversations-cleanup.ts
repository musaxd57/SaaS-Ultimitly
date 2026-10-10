import "server-only";

import type { Prisma } from "@prisma/client";
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
//   * A duplicate is deleted ONLY when EVERY one of its messages already exists
//     in the keeper as the SAME message (provider id + direction + body, or —
//     without a provider id — direction + timestamp + body), counted one to one.
//     Body text alone is NOT identity (Codex 09-30: the host's "Merhaba" matched
//     the guest's later "Merhaba"). If a duplicate holds ANY message the keeper
//     lacks, it is LEFT untouched (counted in needsReview) for manual review.
//
// CONTENT SUBSET IS NOT ENOUGH — IDENTITY MUST BE PROVEN (audit 07-25).
// The body-subset test alone deleted REAL data: a returning guest in the SAME
// apartment produces two DIFFERENT stays whose short/generic messages
// ("Merhaba", "Teşekkürler") trivially make the older thread a subset of the
// newer one. The older stay — messages and all — was destroyed by a manager
// pressing a maintenance button, with no flag and no undo.
//
// So a duplicate is now deleted ONLY when the two rows carry an EQUAL
// IDENTIFIER:
//   (a) identical non-null local reservationId, OR
//   (b) identical non-null externalReservationId.
// Missing or DIFFERING identifiers ⇒ review. Conflicting non-null
// externalConversationId ⇒ possibly two genuine provider threads ⇒ review.
//
// Dates are NOT identity. Treating "same arrival+departure" as the same stay
// would bake in the unproven theory that a reconnect re-issues the reservation
// id, and use it to justify an irreversible delete.
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

type MessageIdentity = { externalId: string | null; direction: string; createdAt: Date; body: string };

/**
 * MESAJ KİMLİĞİ (Codex 09-30, A1): yalnız GÖVDE karşılaştırması ev sahibinin "Merhaba"sını misafirin sonraki
 * "Merhaba"sıyla eşliyordu → kopya sohbet "alt küme" sayılıp misafirin mesajı SİLİNİYORDU. Artık aynı mesaj = aynı
 * sağlayıcı kimliği + yön + gövde; sağlayıcı kimliği yoksa aynı yön + aynı an + gövde. Kimliği bir tarafta olup
 * öbüründe olmayan mesaj EŞLEŞMEZ (şüphede inceleme — silme geri alınamaz).
 */
function messageKey(m: MessageIdentity): string {
  return m.externalId
    ? JSON.stringify(["x", m.externalId, m.direction, normBody(m.body)])
    : JSON.stringify(["l", m.direction, m.createdAt.getTime(), normBody(m.body)]);
}

/**
 * Kopyanın HER mesajı tutulan sohbette AYRI bir mesajla eşleşiyor mu (çoklu küme: kopyadaki iki "Tamam", tutulandaki
 * tek "Tamam" ile kapanmaz).
 */
function coveredByKeeper(keeper: readonly MessageIdentity[], dup: readonly MessageIdentity[]): boolean {
  const left = new Map<string, number>();
  for (const m of keeper) {
    const k = messageKey(m);
    left.set(k, (left.get(k) ?? 0) + 1);
  }
  for (const m of dup) {
    const k = messageKey(m);
    const n = left.get(k) ?? 0;
    if (n === 0) return false;
    left.set(k, n - 1);
  }
  return true;
}

/** The identity signals a conversation carries about WHICH stay it belongs to. */
interface StayIdentity {
  reservationId: string | null;
  externalReservationId: string | null;
  externalConversationId: string | null;
}

/**
 * Are these two rows PROVABLY the same stay? Fail-closed: anything we cannot
 * prove returns false and the caller leaves the row alone.
 *
 * Proof means an EQUAL IDENTIFIER — same local reservationId, or same provider
 * externalReservationId. Nothing else counts.
 *
 * DATE EQUALITY IS NOT IDENTITY (Codex). An earlier version treated "two linked
 * reservations covering the same window" as the same stay, on the theory that a
 * reconnect makes the provider re-issue the reservation id. That theory is
 * UNPROVEN — the live Hospitable payload could not be inspected (the founder org's
 * subscription is 402) and the official API reference returned 403 — so it must
 * not license an irreversible delete. Two rows with DIFFERENT
 * externalReservationId values therefore go to review even when their dates
 * match exactly.
 *
 * Consequence, stated plainly: the reconnect cleanup this tool was originally
 * written for is now DISABLED pending that proof. What still auto-dedupes is
 * the race artefact — two rows for ONE provider reservation — which is exactly
 * the population the Conversation unique would constrain.
 */
function sameStay(a: StayIdentity, b: StayIdentity): boolean {
  if (a.reservationId && b.reservationId && a.reservationId === b.reservationId) return true;
  if (
    a.externalReservationId &&
    b.externalReservationId &&
    a.externalReservationId === b.externalReservationId
  ) {
    return true;
  }
  return false; // missing or differing identifiers ⇒ unprovable ⇒ review
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

const CONVERSATION_SELECT = {
  id: true,
  propertyId: true,
  guestIdentifier: true,
  lastMessageAt: true,
  // Identity: only EQUAL identifiers license a delete (see sameStay).
  reservationId: true,
  externalReservationId: true,
  externalConversationId: true,
  messages: { select: { body: true, externalId: true, direction: true, createdAt: true } },
} as const;

/**
 * Konuşmaya bağlı kayıtları kaybedenden kazanana TAŞI (silmeden ÖNCE, aynı işlemde). Toplu birleştirme betiğiyle
 * (`scripts/apply-conversation-dedupe.ts`) AYNI kural — panel yolu eskiden yalnız mesajları siliyordu ve konuşma silmenin
 * Cascade'i ev sahibinde bekleyen açık isteği, karar kartını, misafire verilmiş sözü ve yapay zekâ izini SESSİZCE götürüyordu
 * (Haiku incelemesi 10-10). Liste, şemadan türetilen envanterle pinli (`conversations-cleanup.test.ts`): yeni bir konuşma
 * referansı eklenip buraya yazılmazsa test kırmızı.
 */
export const CLEANUP_REPOINTED_MODELS = [
  "AiGeneration",
  "ConversationItem",
  "DecisionRequest",
  "GuestCommitment",
  "MessageOutbox",
  "RiskEvent",
  "ShadowVerdict",
  "Signal",
] as const;

async function repointConversationChildren(tx: Prisma.TransactionClient, fromId: string, toId: string): Promise<void> {
  const move = { where: { conversationId: fromId }, data: { conversationId: toId } };
  await tx.aiGeneration.updateMany(move);
  await tx.conversationItem.updateMany(move);
  await tx.decisionRequest.updateMany(move);
  await tx.guestCommitment.updateMany(move);
  await tx.messageOutbox.updateMany(move);
  await tx.riskEvent.updateMany(move);
  await tx.shadowVerdict.updateMany(move);
  await tx.signal.updateMany(move);
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
    select: CONVERSATION_SELECT,
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

    for (const dup of sorted.slice(1)) {
      // Delete only when the keeper already contains EVERYTHING this duplicate has — message by message (identity, not text).
      if (!coveredByKeeper(keeper.messages, dup.messages)) {
        result.needsReview++; // divergent — never risk losing a message
        continue;
      }
      if (!sameStay(keeper, dup) || conversationIdsConflict(keeper, dup)) {
        result.needsReview++; // identity unproven / two possible provider threads
        continue;
      }
      // 🚨 Y2 (Codex 10-07): yukarıdaki karar İŞLEM DIŞI bir anlık görüntüye dayanır; okuma ile silme arasında senkron çift konuşmaya
      // YENİ bir misafir mesajı yazarsa eski kod onu da siliyordu (konuşma silme Cascade'i dahil) ve `needsReview: 0` diyordu. Şimdi:
      // iki konuşma satırı `FOR UPDATE` ile kilitlenir (mesaj eklemenin yabancı anahtar denetimi `FOR KEY SHARE` alır → eşzamanlı ekleme
      // bekler ya da önce işlenir), mesajlar İŞLEMİN İÇİNDE yeniden okunur ve aynı üç koşul yeniden sınanır; tutmuyorsa incelemeye kalır.
      const outcome = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Conversation" WHERE "id" IN (${keeper.id}, ${dup.id}) ORDER BY "id" FOR UPDATE`;
        const fresh = await tx.conversation.findMany({ where: { id: { in: [keeper.id, dup.id] } }, select: CONVERSATION_SELECT });
        const k = fresh.find((c) => c.id === keeper.id);
        const d = fresh.find((c) => c.id === dup.id);
        if (!k || !d) return "gone" as const;
        if (!coveredByKeeper(k.messages, d.messages) || !sameStay(k, d) || conversationIdsConflict(k, d)) return "review" as const;
        await repointConversationChildren(tx, d.id, k.id);
        await tx.message.deleteMany({ where: { conversationId: d.id } });
        await tx.conversation.delete({ where: { id: d.id } });
        return "removed" as const;
      });
      if (outcome === "removed") result.removed++;
      else if (outcome === "review") result.needsReview++;
    }
  }

  return result;
}
