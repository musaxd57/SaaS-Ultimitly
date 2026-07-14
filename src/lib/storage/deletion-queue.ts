import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import { getStorageAdapter, type StorageAdapter } from "./adapter";
import { storageConfigured } from "./config";
import { isSafeObjectKey, orgIdFromKey } from "./keys";

// ---------------------------------------------------------------------------
// Idempotent deletion queue for private object storage.
//
// CONTRACT: the DB operation that orphans an object (task delete, account
// erasure) writes its deletion INTENTS first/atomically and then proceeds — the
// provider is NEVER on the DB operation's critical path. A provider outage
// therefore cannot (a) block or roll back the DB delete, NOR (b) turn it into a
// silent object leak: the pending row persists, is retried with backoff by the
// scheduled drain, and stays visible until the object is truly gone.
//
// Idempotency, twice over: `objectKey @unique` + createMany(skipDuplicates)
// makes double-ENQUEUE a no-op, and the adapter treats deleting a missing
// object as success, so a re-DRAIN of an already-deleted key settles cleanly.
// ---------------------------------------------------------------------------

type Db = PrismaClient | Prisma.TransactionClient;

const DRAIN_BATCH = 25;
const BACKOFF_BASE_MS = 5 * 60_000; // 5 min, doubling
const BACKOFF_CAP_MS = 6 * 60 * 60_000; // 6 h ceiling

function backoffMs(attemptCount: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attemptCount - 1));
}

/** Status-code-only error string (never a provider body / credential). */
function errorCode(err: unknown): string {
  const m = err instanceof Error ? err.message.match(/HTTP \d{3}/) : null;
  return m ? m[0] : "provider_error";
}

/**
 * Record deletion intents for the given object keys. Accepts the transaction
 * client so the intent commits ATOMICALLY with the DB delete that orphans the
 * objects. Returns the number of NEW intents written.
 *
 * TENANT CHOKE POINT: a key is enqueued ONLY when it is well-shaped AND its org
 * segment equals `organizationId`. `photoUrl` is client-settable (the task PATCH
 * route stores it verbatim), so a poisoned value pointing at ANOTHER org's key
 * could otherwise reach here (via task DELETE / account erasure) and delete a
 * different tenant's object from the shared bucket. The org-segment check — the
 * same boundary the serve route enforces at read time — closes that at the one
 * place every deletion flows through. Unsafe/foreign keys are silently dropped;
 * duplicates are a clean no-op.
 */
export async function enqueueStorageDeletions(db: Db, organizationId: string, objectKeys: string[]): Promise<number> {
  const keys = Array.from(
    new Set(objectKeys.filter((k) => isSafeObjectKey(k) && orgIdFromKey(k) === organizationId)),
  );
  if (keys.length === 0) return 0;
  const res = await db.storageDeletion.createMany({
    data: keys.map((objectKey) => ({ objectKey, organizationId })),
    skipDuplicates: true, // objectKey @unique → double-enqueue = dedupe-hit
  });
  return res.count;
}

/** Cheap indexed check — lets the scheduler skip the drain entirely when idle. */
export async function hasPendingStorageDeletions(): Promise<boolean> {
  const n = await prisma.storageDeletion.count({ where: { status: "pending" } });
  return n > 0;
}

export interface StorageDrainResult {
  /** True when no adapter is configured — rows stay pending and WAIT (documented). */
  skipped: boolean;
  deleted: number;
  failed: number;
}

/**
 * Drain due pending deletions: one provider DELETE per row. On success the row
 * is marked `deleted` (kept as an audit/idempotency anchor); on provider error
 * it stays `pending` with attemptCount+1 and a bounded backoff — NEVER marked
 * done on a failure (no fake success). Unconfigured storage ⇒ skip quietly
 * (rows wait for the env to come back; a flag-off rollback keeps draining as
 * long as the credentials remain). Never throws.
 */
export async function drainStorageDeletions(
  deps: { adapter?: StorageAdapter | null; now?: () => Date; batchSize?: number } = {},
): Promise<StorageDrainResult> {
  const adapter = deps.adapter !== undefined ? deps.adapter : storageConfigured() ? getStorageAdapter() : null;
  if (!adapter) return { skipped: true, deleted: 0, failed: 0 };
  const now = deps.now ?? (() => new Date());

  const due = await prisma.storageDeletion.findMany({
    where: { status: "pending", availableAt: { lte: now() } },
    orderBy: { availableAt: "asc" },
    take: deps.batchSize ?? DRAIN_BATCH,
    select: { id: true, objectKey: true, attemptCount: true },
  });

  let deleted = 0;
  let failed = 0;
  for (const row of due) {
    try {
      await adapter.delete(row.objectKey);
      await prisma.storageDeletion.updateMany({
        where: { id: row.id, status: "pending" },
        data: { status: "deleted", deletedAt: now(), lastError: null },
      });
      deleted++;
    } catch (err) {
      failed++;
      await prisma.storageDeletion
        .updateMany({
          where: { id: row.id, status: "pending" },
          data: {
            attemptCount: { increment: 1 },
            availableAt: new Date(now().getTime() + backoffMs(row.attemptCount + 1)),
            lastError: errorCode(err), // status code only — never a body/secret
          },
        })
        .catch(() => {});
    }
  }
  if (failed > 0) {
    // One secret-free breadcrumb per drain (not per row) — visible, never a storm.
    await reportError("storage-deletion-drain", new Error(`storage deletions failing: ${failed} row(s) deferred`)).catch(
      () => {},
    );
  }
  return { skipped: false, deleted, failed };
}
