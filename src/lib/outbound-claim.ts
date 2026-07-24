import "server-only";

import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Short-lived, DB-backed duplicate-send guard for MANUAL outbound replies.
// A double-click, a browser/proxy POST retry, or two tabs can hit the reply
// route concurrently — the route had no server-side idempotency, so the same
// text could reach the guest twice. Same primitive as the plan-change nonce:
// SystemLock's unique @id makes create() the atomic claim, which is correct
// across replicas (unlike the in-memory rate limiter).
//
// The key is {conversationId, sha256(body)}. The TTL must EXCEED the worst-case
// delivery duration: the Hospitable client retries up to 4×20s with backoff
// (~87s), and the sweep below deletes expired rows — a TTL shorter than a slow
// in-flight send would let a late browser/proxy retry sweep the live claim and
// deliver twice (adversarial-review finding). 120s covers the worst case; the
// cost is only that the SAME text can't be re-sent for 2 minutes after success
// (a failed send releases immediately). Auto-reply paths have their own
// claim-then-send (conversation/reservation updateMany) and don't use this.
// ---------------------------------------------------------------------------

const CLAIM_TTL_MS = 120_000;
const PREFIX = "outbound-send:";

function claimName(conversationId: string, body: string): string {
  const digest = createHash("sha256").update(body).digest("base64url").slice(0, 24);
  return `${PREFIX}${conversationId}:${digest}`;
}

/**
 * Atomically claim "this exact text is being sent on this conversation right now".
 * "claimed" on the first claim; "duplicate" when an identical send is in flight
 * or just happened (within the TTL); "unavailable" (fail-CLOSED) when the lock
 * store itself errors — with the store down a duplicate delivery could not be
 * detected, so the send is refused instead.
 */
export type OutboundClaim = "claimed" | "duplicate" | "unavailable";

export async function claimOutboundSend(conversationId: string, body: string): Promise<OutboundClaim> {
  const now = new Date();
  // Opportunistic sweep: expired claims can't dedup anything anymore (their TTL
  // has passed), so drop them to keep SystemLock from growing unbounded.
  await prisma.systemLock
    .deleteMany({ where: { name: { startsWith: PREFIX }, lockedUntil: { lt: now } } })
    .catch(() => {});
  try {
    await prisma.systemLock.create({
      data: { name: claimName(conversationId, body), lockedUntil: new Date(now.getTime() + CLAIM_TTL_MS) },
    });
    return "claimed";
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "duplicate";
    // Unknown store error → fail CLOSED (Codex): with the lock store down the
    // post-send persist would fail too, and a user retry would re-deliver to the
    // guest. A 503 "try again shortly" is the safe, honest answer.
    return "unavailable";
  }
}

/** Release after a FAILED delivery so the same text can be retried immediately. */
export async function releaseOutboundSend(conversationId: string, body: string): Promise<void> {
  await prisma.systemLock.deleteMany({ where: { name: claimName(conversationId, body) } }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Keyed variant (QR guest chat, Codex 07-24 r2): the claim key is the caller's
// SCOPE id alone (e.g. qr-in:{reservationId}:{requestId}) and the payload
// digest is stored IN the row (SystemLock.holder). A duplicate can then be
// CLASSIFIED instead of guessed: same digest → a true retry of the same
// composed message ("duplicate" → dedupe); different digest → the id was
// REUSED with different content ("mismatch" → the caller 409s, so the second
// message is neither silently swallowed nor double-processed). The body-in-key
// scheme above cannot make this distinction — a different body just misses the
// existing claim entirely.
// ---------------------------------------------------------------------------

export type KeyedOutboundClaim = "claimed" | "duplicate" | "mismatch" | "unavailable";

export async function claimKeyedOutboundSend(scopeId: string, body: string): Promise<KeyedOutboundClaim> {
  const now = new Date();
  const digest = createHash("sha256").update(body).digest("base64url").slice(0, 24);
  const name = `${PREFIX}${scopeId}`;
  // Same opportunistic sweep as claimOutboundSend: an EXPIRED claim (its holder
  // crashed mid-flight, or the work simply finished long ago) must never block a
  // retry — after the TTL the row is dropped and the retry claims fresh.
  await prisma.systemLock
    .deleteMany({ where: { name: { startsWith: PREFIX }, lockedUntil: { lt: now } } })
    .catch(() => {});
  try {
    await prisma.systemLock.create({
      data: { name, lockedUntil: new Date(now.getTime() + CLAIM_TTL_MS), holder: digest },
    });
    return "claimed";
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      try {
        const row = await prisma.systemLock.findUnique({ where: { name }, select: { holder: true } });
        // Row vanished between the failed create and this read (a racing sweep on
        // a just-expired row) — refuse honestly; the client's next retry claims.
        if (!row) return "unavailable";
        return row.holder === digest ? "duplicate" : "mismatch";
      } catch {
        return "unavailable";
      }
    }
    // Store down → fail CLOSED (same reasoning as claimOutboundSend).
    return "unavailable";
  }
}

/** Release a keyed claim after a failure that recorded NOTHING (the retry must
 *  be processed, not deduped against zero work). */
export async function releaseKeyedOutboundSend(scopeId: string): Promise<void> {
  await prisma.systemLock.deleteMany({ where: { name: `${PREFIX}${scopeId}` } }).catch(() => {});
}
