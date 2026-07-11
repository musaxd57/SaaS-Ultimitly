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
 * True on the first claim; false when an identical send is in flight or just
 * happened (within the TTL). Fail-OPEN on an unexpected DB error: a broken lock
 * store must never block the host from answering a guest — the guard is a
 * best-effort dedup, not a delivery gate.
 */
export async function claimOutboundSend(conversationId: string, body: string): Promise<boolean> {
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
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    return true; // unknown DB error → fail-open (never block a legit reply)
  }
}

/** Release after a FAILED delivery so the same text can be retried immediately. */
export async function releaseOutboundSend(conversationId: string, body: string): Promise<void> {
  await prisma.systemLock.deleteMany({ where: { name: claimName(conversationId, body) } }).catch(() => {});
}
