import "server-only";

import { prisma } from "@/lib/db";
import { isOutboxStatus, OUTBOX_STATUSES, type OutboxStatus } from "./state";

// ---------------------------------------------------------------------------
// Durable Outbox — host-facing OPERATIONS view (#8 görünürlük).
//
// The read model + the ONE manual action behind the owner/manager "Gönderim
// Kuyruğu" screen (/sent/queue). Deliberately PII-free: the list NEVER selects
// the message body, the guest identity, the idempotency key, the worker claim
// token or the provider message id — only state-machine fields that are safe
// to render. (The thread link resolves content behind its own auth.)
//
// Manual retry is intentionally NARROW:
//   • `failed` ONLY — a definitive provider REJECTION (4xx ≠ 408/429/402):
//     nothing was delivered, so a re-send cannot duplicate. Human-triggered,
//     tenant-bound, idempotent under the status guard.
//   • `blocked` is NOT retryable here: Hospitable 402 "subscription not active"
//     resolves by RECONNECTING the subscription — the sync-success hook then
//     requeues it exactly once (reactivateBlockedOutbox). A manual button would
//     just burn provider calls against a dead subscription.
//   • `review` / `ambiguous` / `reconciling` are NOT retryable: the send MAY
//     have reached the guest (lost HTTP response) — a retry risks a DUPLICATE
//     message. They stay read-only ("sağlayıcıdan doğrulanamadı").
//   • `sent` / `canceled` / `pending` / `sending` are read-only by definition.
// ---------------------------------------------------------------------------

export const OUTBOX_QUEUE_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * May a HUMAN (owner/manager) requeue this row from the ops screen?
 * Only a terminal `failed` (definitively rejected, never delivered) — and even
 * then never a 402: that class parks as `blocked` and is requeued by the
 * sync-success hook, so a legacy failed-402 row must not become a manual
 * hammer-the-dead-subscription loop either.
 */
export function canManualRetry(status: string, lastErrorCode: string | null): boolean {
  return status === "failed" && lastErrorCode !== "HTTP 402";
}

/** One PII-free row of the ops list (safe to render to any manage-capable member). */
export interface OutboxDeliveryRow {
  id: string;
  conversationId: string | null;
  messageType: string | null;
  channel: string;
  status: string;
  attemptCount: number;
  lastErrorKind: string | null;
  lastErrorCode: string | null;
  availableAt: Date;
  sentAt: Date | null;
  createdAt: Date;
  /** Computed: eligible for the tenant-bound manual retry (see canManualRetry). */
  retryable: boolean;
}

export interface OutboxDeliveryList {
  rows: OutboxDeliveryRow[];
  /** Total rows matching the ACTIVE filter (drives pagination). */
  total: number;
  page: number;
  take: number;
  /** Per-status row counts for the WHOLE org (drives the filter pills). */
  counts: Record<OutboxStatus, number>;
}

/**
 * Tenant-scoped, paginated outbox overview. `status` outside the closed set is
 * ignored (→ no filter) so a crafted query string can't turn into a probe; the
 * org id ALWAYS comes from the caller's session, never from input.
 */
export async function listOutboxDeliveries(
  organizationId: string,
  opts: { status?: string | null; page?: number; take?: number } = {},
): Promise<OutboxDeliveryList> {
  const status = opts.status && isOutboxStatus(opts.status) ? opts.status : null;
  const take = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(opts.take ?? OUTBOX_QUEUE_PAGE_SIZE)));
  const requestedPage = Math.max(1, Math.floor(opts.page ?? 1));

  const where = { organizationId, ...(status ? { status } : {}) };
  const [total, grouped] = await Promise.all([
    prisma.messageOutbox.count({ where }),
    prisma.messageOutbox.groupBy({
      by: ["status"],
      where: { organizationId },
      _count: { _all: true },
    }),
  ]);

  // Clamp the page into range AFTER counting so an out-of-range ?page never
  // renders an empty page with live rows hidden behind it.
  const pageCount = Math.max(1, Math.ceil(total / take));
  const page = Math.min(requestedPage, pageCount);

  const raw = await prisma.messageOutbox.findMany({
    where,
    // SAFE fields only — no body, no idempotencyKey, no claimedBy, no provider id.
    select: {
      id: true,
      conversationId: true,
      messageType: true,
      channel: true,
      status: true,
      attemptCount: true,
      lastErrorKind: true,
      lastErrorCode: true,
      availableAt: true,
      sentAt: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * take,
    take,
  });

  const counts = Object.fromEntries(OUTBOX_STATUSES.map((s) => [s, 0])) as Record<OutboxStatus, number>;
  for (const g of grouped) {
    if (isOutboxStatus(g.status)) counts[g.status] = g._count._all;
  }

  return {
    rows: raw.map((r) => ({ ...r, retryable: canManualRetry(r.status, r.lastErrorCode) })),
    total,
    page,
    take,
    counts,
  };
}

export type RequeueResult =
  | { outcome: "requeued" }
  | { outcome: "not_found" }
  | { outcome: "not_retryable"; status: string };

/**
 * Tenant-bound HUMAN retry: move ONE definitively-failed row back to `pending`
 * with a fresh attempt budget, so the next drain tries it once more. The guarded
 * `updateMany` is atomic + idempotent — the WHERE re-checks tenant, `failed`
 * status AND the not-402 class, so a concurrent worker/second click can never
 * double-apply, and a crafted id from another org matches nothing (IDOR-safe).
 */
export async function requeueFailedOutbox(organizationId: string, outboxId: string): Promise<RequeueResult> {
  const res = await prisma.messageOutbox.updateMany({
    where: {
      id: outboxId,
      organizationId,
      status: "failed",
      NOT: { lastErrorCode: "HTTP 402" }, // blocked-class: reconnect requeues it, never a manual hammer
    },
    data: {
      status: "pending",
      attemptCount: 0,
      availableAt: new Date(),
      claimedBy: null,
      claimExpiresAt: null,
      lastErrorKind: null,
      lastErrorCode: null,
    },
  });
  if (res.count === 1) return { outcome: "requeued" };

  // Distinguish "not yours / doesn't exist" (404) from "exists but not retryable" (409).
  const existing = await prisma.messageOutbox.findFirst({
    where: { id: outboxId, organizationId },
    select: { status: true },
  });
  if (!existing) return { outcome: "not_found" };
  return { outcome: "not_retryable", status: existing.status };
}
