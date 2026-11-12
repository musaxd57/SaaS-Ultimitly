import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ANON_BODY } from "@/lib/data-retention";
import { isOutboxStatus, OUTBOX_STATUSES, type OutboxStatus } from "./state";
import { operationBaseKey, operationRetryKey } from "./operation-key";

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

  // "Devralınmış satır" hesabı anahtarı ister; anahtar listeye KARIŞMASIN diye ayrı, dar bir okumayla alınır (yalnız sayfada
  // "gönderilemedi" satırı varsa).
  const failedIds = raw.filter((r) => r.status === "failed").map((r) => r.id);
  const superseded =
    failedIds.length === 0
      ? new Set<string>()
      : await supersededOperationRows(
          prisma,
          organizationId,
          await prisma.messageOutbox.findMany({ where: { organizationId, id: { in: failedIds } }, select: { id: true, idempotencyKey: true } }),
        );
  const counts = Object.fromEntries(OUTBOX_STATUSES.map((s) => [s, 0])) as Record<OutboxStatus, number>;
  for (const g of grouped) {
    if (isOutboxStatus(g.status)) counts[g.status] = g._count._all;
  }

  return {
    rows: raw.map((r) => ({ ...r, retryable: canManualRetry(r.status, r.lastErrorCode) && !superseded.has(r.id) })),
    total,
    page,
    take,
    counts,
  };
}

/**
 * Yeniden denemeyle DEVRALINMIŞ işlem satırları (S1, Opus incelemesi 11-11). Yapay zekâ önerisinin gönderimi "gönderilemedi" ile bittikten
 * sonra öneri yeniden onaylandıysa yeni bir gönderim satırı açılmıştır (anahtarı eski satırdan türer). Eski satır elle "yeniden dene" ile
 * kuyruğa alınırsa aynı öneri misafire İKİNCİ kez giderdi → devralınmış satır elle yeniden denenmez. Sayfa başına tek sorgu.
 */
async function supersededOperationRows(
  db: Pick<Prisma.TransactionClient, "messageOutbox">,
  organizationId: string,
  rows: readonly { id: string; idempotencyKey: string }[],
): Promise<Set<string>> {
  const rowBySuccessorKey = new Map<string, string>();
  for (const r of rows) {
    const base = operationBaseKey(r.idempotencyKey);
    if (base) rowBySuccessorKey.set(operationRetryKey(base, r.id), r.id);
  }
  if (rowBySuccessorKey.size === 0) return new Set();
  const successors = await db.messageOutbox.findMany({
    where: { organizationId, idempotencyKey: { in: [...rowBySuccessorKey.keys()] } },
    select: { idempotencyKey: true },
  });
  return new Set(successors.map((x) => rowBySuccessorKey.get(x.idempotencyKey)).filter((id): id is string => Boolean(id)));
}

/** Elle yeniden deneme, yerine yenisi açılmış satıra geldi — işlemi geri alır (yalnız bu dosyada). */
class SupersededRetryError extends Error {}

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
  let res: { count: number };
  try {
    res = await prisma.$transaction(async (tx) => {
      const updated = await tx.messageOutbox.updateMany({
        where: {
          id: outboxId,
          organizationId,
          status: "failed",
          NOT: { lastErrorCode: "HTTP 402" }, // blocked-class: reconnect requeues it, never a manual hammer
          // İKİNCİ SAVUNMA (denetim, 08-01): gövdesi temizlenmiş satır ASLA yeniden
          // kuyruğa alınmaz. Birinci savunma süpürgelerin bu satırı `canceled`
          // yapmasıdır (ERASABLE_STATUSES); bu koşul, süpürge bir bağı kaçırsa bile
          // (yetim satır) silinmiş misafire sentinel metnin tek tıkla gitmesini
          // engeller. `reactivateBlockedOutbox` ile aynı kural.
          body: { not: ANON_BODY },
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
      if (updated.count !== 1) return updated;
      // 🚨 Devralınmış işlem satırı (↑ `supersededOperationRows`): öneri yeniden onaylanıp yeni gönderimi açılmışsa eskisi kuyruğa
      // ALINMAZ (aynı öneri ikinci kez giderdi). Denetim, güncellemenin aldığı SATIR KİLİDİ altında yapılır: yeniden onay da yeni satırı
      // yazmadan önce aynı satırı kilitler (`enqueueOutbound` `supersedes`) → ikisi aynı anda geçemez; biri ötekinin sonucunu görür.
      const row = await tx.messageOutbox.findUnique({ where: { id: outboxId }, select: { id: true, idempotencyKey: true } });
      if (row && (await supersededOperationRows(tx, organizationId, [row])).has(row.id)) throw new SupersededRetryError();
      return updated;
    });
  } catch (err) {
    if (!(err instanceof SupersededRetryError)) throw err;
    return { outcome: "not_retryable", status: "failed" }; // işlem geri alındı: satır "gönderilemedi"de kaldı
  }
  if (res.count === 1) return { outcome: "requeued" };

  // Distinguish "not yours / doesn't exist" (404) from "exists but not retryable" (409).
  const existing = await prisma.messageOutbox.findFirst({
    where: { id: outboxId, organizationId },
    select: { status: true },
  });
  if (!existing) return { outcome: "not_found" };
  return { outcome: "not_retryable", status: existing.status };
}
