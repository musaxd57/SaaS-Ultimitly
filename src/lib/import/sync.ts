import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { parseIcs } from "@/lib/import/ics";
import { createReservationTasks, removeAutoTasksForCancelledReservation } from "@/lib/automation";
import { isPrivateHost, resolvesToPrivate } from "@/lib/net/private-host";
import { fetchFeedText } from "@/lib/net/pinned-fetch";
import { ANON_NAME } from "@/lib/data-retention";

export interface SyncResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
}

const FEED_MAX_BYTES = 10 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// #23 Feed-disappearance reconciliation (FAZ 2) — DEFAULT OFF.
//
// Some OTAs (Airbnb) REMOVE a cancelled booking's event instead of marking it
// STATUS:CANCELLED, so a silently-gone UID means an upstream cancellation. Reflecting
// that is valuable, but a naive "gone this run → cancel" mass-cancels the feed's OWN
// rows on a partial/transient response (the reason the old inline block stayed OFF).
// This version is SAFE: a stay is cancelled ONLY after it vanishes from >= THRESHOLD
// CONSECUTIVE RELIABLE runs AND for >= MIN wall-clock, is source-bound, and reappears
// reset it atomically. Empty / suspicious-drop / non-reliable fetches never count.
//
// Cadence note: iCal sync is USER-TRIGGERED (manual /api/calendar/sync — NOT the cron),
// so there is no guaranteed interval → the wall-clock MIN duration is the authoritative
// guard; the count threshold only ensures a single anomalous run can never cancel.
export function feedReconcileEnabled(): boolean {
  return process.env.ICAL_DISAPPEARANCE_RECONCILE_ENABLED === "1";
}

const FEED_MISSING_THRESHOLD = 2; //            >= 2 consecutive reliable runs missing it
const FEED_MISSING_MIN_MS = 24 * 60 * 60_000; // AND gone >= 24h (user-driven cadence → wall-clock rules)
const SUSPICIOUS_DROP_MIN_BASE = 5; //          only guard a drop when the baseline had >= 5 UIDs
const SUSPICIOUS_DROP_RATIO = 0.5; //           a drop to < 50% of the baseline is treated as partial
const FEED_LOCK_NS = 23; //                     advisory-lock namespace ("#23"), disjoint from the outbox lock

/** Map a free-text source label to a known reservation channel. */
function channelFromLabel(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("airbnb")) return "airbnb";
  if (l.includes("booking")) return "booking";
  if (l.includes("direct") || l.includes("doğrudan")) return "direct";
  return "other";
}

/**
 * Fetch an external iCal feed, parse it, and upsert reservations for the
 * given property. Existing reservations (matched by sourceReference / UID)
 * are updated in place; new ones are created. Never throws — failures are
 * captured in the returned result and persisted on the source row.
 */
export async function syncCalendarSource(sourceId: string): Promise<SyncResult> {
  const result: SyncResult = { imported: 0, updated: 0, skipped: 0, errors: [] };

  const source = await prisma.calendarSource.findUnique({ where: { id: sourceId } });
  if (!source) {
    result.errors.push("Takvim kaynağı bulunamadı.");
    return result;
  }

  const channel = channelFromLabel(source.label);

  // Fetch-start stamp — the ordering key for the disappearance reconciliation (a slower older
  // run must never overwrite a newer run's result). Captured BEFORE the network call.
  const runStartedAt = new Date();

  let text: string;
  try {
    // SSRF pre-check (cheap, defense-in-depth): reject a literal private target
    // or a hostname that currently RESOLVES private. The AUTHORITATIVE guard is
    // fetchFeedText's pinned lookup, which validates the address the socket
    // actually connects to (closing the DNS-rebind TOCTOU this pre-check can't).
    const feedHost = new URL(source.url).hostname;
    if (isPrivateHost(feedHost) || (await resolvesToPrivate(feedHost))) {
      throw new Error("blocked private host");
    }
    // node:https/http GET with: pinned public-only IP, NO redirect following
    // (a 3xx is a failure, nothing to re-resolve), a declared + streamed byte
    // cap, and a 15s timeout. HTTPS keeps full cert validation.
    text = await fetchFeedText(source.url, {
      maxBytes: FEED_MAX_BYTES,
      timeoutMs: 15000,
      userAgent: "Lixus-AI/1.0",
    });
  } catch {
    result.errors.push("Bağlantıya ulaşılamadı — takvim (.ics) bağlantısını kontrol edin.");
    await prisma.calendarSource.update({
      where: { id: sourceId },
      data: { lastSyncedAt: new Date(), lastStatus: "error", lastResult: result.errors[0] },
    });
    return result;
  }

  const rows = parseIcs(text);
  // Every UID seen in THIS feed (incl. cancelled ones) → used below to reconcile
  // reservations that silently disappeared from the feed.
  const seenRefs = new Set<string>();

  for (const row of rows) {
    if (row.sourceReference) seenRefs.add(row.sourceReference);
    if (!row.guestName || !row.arrivalDate || !row.departureDate) {
      result.skipped++;
      continue;
    }
    if (
      isNaN(row.arrivalDate.getTime()) ||
      isNaN(row.departureDate.getTime()) ||
      row.departureDate <= row.arrivalDate
    ) {
      result.skipped++;
      continue;
    }

    try {
      // BOUND-FIRST lookup (Codex round-5): match a row already owned by THIS
      // source; only a LIVE event may fall back to a legacy calendarSourceId=NULL
      // row (one-time adoption). A CANCELLED event never touches an unowned row —
      // safer default: an upstream-cancelled legacy row simply stays until a live
      // match or manual cleanup (bounded staleness, zero cross-source risk).
      const bound = row.sourceReference
        ? await prisma.reservation.findFirst({
            where: { propertyId: source.propertyId, sourceReference: row.sourceReference, calendarSourceId: source.id },
            select: { id: true, guestName: true, status: true },
          })
        : null;
      const legacy =
        !bound && row.sourceReference && row.status !== "CANCELLED"
          ? await prisma.reservation.findFirst({
              where: { propertyId: source.propertyId, sourceReference: row.sourceReference, calendarSourceId: null },
              select: { id: true, guestName: true, status: true },
            })
          : null;
      const existing = bound ?? legacy;

      // Feed explicitly marks the booking CANCELLED → reflect it locally (cancel +
      // drop the auto tasks), never import it as a live stay.
      if (row.status === "CANCELLED") {
        if (existing && existing.status !== "cancelled") {
          // Only a row ALREADY bound to this source may be cancelled (ownership
          // re-checked atomically inside the UPDATE; legacy NULL is never here —
          // the lookup above excludes it for CANCELLED events).
          const resC = await prisma.reservation.updateMany({
            where: { id: existing.id, calendarSourceId: source.id },
            data: { status: "cancelled" },
          });
          if (resC.count === 1) {
            await removeAutoTasksForCancelledReservation(existing.id);
            result.updated++;
          } else {
            result.skipped++;
          }
        } else {
          result.skipped++;
        }
        continue;
      }

      if (existing) {
        // KVKK resurrection guard: once the retention sweep has anonymized this
        // row (guestName === ANON_NAME), NEVER let a re-import write the guest's
        // name/notes back from the feed. Dates (non-PII) still refresh so
        // occupancy stays correct. Mirrors the hospitable-sync.ts guard.
        const scrubbed = existing.guestName === ANON_NAME;
        // ATOMIC adoption: ownership re-checked inside the UPDATE (count 0 = a
        // concurrent source claimed the legacy NULL row first → not ours, skip).
        const resU = await prisma.reservation.updateMany({
          where: { id: existing.id, OR: [{ calendarSourceId: source.id }, { calendarSourceId: null }] },
          data: {
            ...(scrubbed
              ? {}
              : {
                  guestName: row.guestName.slice(0, 200),
                  notes: row.notes ? row.notes.slice(0, 5000) : null,
                }),
            arrivalDate: row.arrivalDate,
            departureDate: row.departureDate,
            // (Re-)bind to THIS source: legacy pre-binding rows heal on their
            // first match, making them reconcilable again — safely scoped.
            calendarSourceId: source.id,
            // Re-confirm a stay that had been cancelled but now reappears live.
            ...(existing.status === "cancelled" ? { status: "confirmed" } : {}),
          },
        });
        if (resU.count === 0) {
          result.skipped++;
          continue;
        }
        // Backfill tasks for reservations imported before task automation existed.
        await createReservationTasks(existing.id);
        result.updated++;
      } else {
        let created;
        try {
          created = await prisma.reservation.create({
            data: {
              propertyId: source.propertyId,
              guestName: row.guestName.slice(0, 200),
              arrivalDate: row.arrivalDate,
              departureDate: row.departureDate,
              channel,
              status: "confirmed",
              sourceReference: row.sourceReference ? row.sourceReference.slice(0, 200) : null,
              calendarSourceId: source.id,
              notes: row.notes ? row.notes.slice(0, 5000) : null,
              currency: "EUR",
            },
          });
        } catch (err) {
          // DEDUPE-HIT on @@unique([propertyId, sourceReference]) ONLY: the UID
          // already exists on a row BOUND TO ANOTHER SOURCE (our bound-first
          // lookup deliberately doesn't see it) or raced in. Source-binding
          // rule: never mutate another source's row — skip.
          if (isUniqueViolation(err, ["propertyId", "sourceReference"])) {
            result.skipped++;
            continue;
          }
          throw err;
        }
        await createReservationTasks(created.id);
        result.imported++;
      }
    } catch {
      result.errors.push("Kaydetme sırasında bir sorun oluştu, tekrar deneyin.");
      result.skipped++;
    }
  }

  // Feed-disappearance reconciliation (#23, FAZ 2) — DEFAULT OFF. All the mass-cancel guards
  // (consecutive-reliable-miss threshold + wall-clock minimum + suspicious-drop/empty skip +
  // strict source binding + per-source lock + stale-run ordering) live in the function. It only
  // runs after a SUCCESSFUL fetch; the explicit STATUS:CANCELLED path above is unaffected.
  // Best-effort: a reconciliation hiccup must never turn a good import into a failure.
  let reconcileWarning: string | null = null;
  if (feedReconcileEnabled()) {
    try {
      const rec = await reconcileFeedDisappearance({ source, channel, seenRefs, runStartedAt });
      result.updated += rec.cancelled;
      reconcileWarning = rec.warning;
    } catch {
      // never fail the import on reconciliation
    }
  }

  const parts: string[] = [];
  if (result.imported > 0) parts.push(`${result.imported} yeni rezervasyon`);
  if (result.updated > 0) parts.push(`${result.updated} güncellendi`);
  if (result.skipped > 0) parts.push(`${result.skipped} atlandı`);
  if (result.errors.length) parts.push(`${result.errors.length} hata`);
  if (reconcileWarning) parts.push(`⚠ ${reconcileWarning}`);
  const summary = parts.length ? parts.join(", ") : "Yeni rezervasyon bulunamadı";

  await prisma.calendarSource.update({
    where: { id: sourceId },
    data: {
      lastSyncedAt: new Date(),
      lastStatus: result.errors.length && result.imported + result.updated === 0 ? "error" : "ok",
      lastResult: summary,
    },
  });

  return result;
}

/**
 * FAZ 2 — reconcile reservations that silently disappeared from a calendar feed. Runs ONLY
 * after a successful fetch, and internally enforces every safety gate:
 *  • per-source advisory lock → two concurrent syncs never double-count a miss;
 *  • stale-run ordering → an older/slower run never overwrites a newer one's result;
 *  • empty / suspicious-drop feed → NEVER counts a miss (audit warning instead);
 *  • a stay is cancelled ONLY after >= THRESHOLD consecutive reliable misses AND >= MIN
 *    wall-clock, is source-bound, and reappearing resets the streak atomically;
 *  • cancel is a one-time status flip (no DELETE); only system auto-tasks are cleared.
 * `now` / `runStartedAt` are injectable for deterministic tests.
 */
export async function reconcileFeedDisappearance(opts: {
  source: { id: string; propertyId: string };
  channel: string;
  seenRefs: Set<string>;
  runStartedAt: Date;
  now?: Date;
}): Promise<{ cancelled: number; warning: string | null }> {
  const { source, channel, seenRefs, runStartedAt } = opts;
  const now = opts.now ?? new Date();
  const eventCount = seenRefs.size;
  const cancelledIds: string[] = [];
  let warning: string | null = null;

  await prisma.$transaction(async (tx) => {
    // Serialize this source's reconciliation (namespaced advisory lock, disjoint from the
    // outbox claim lock). Non-blocking: if another sync holds it, skip — the other run does it.
    const gate = await tx.$queryRaw<Array<{ locked: boolean }>>(
      Prisma.sql`SELECT pg_try_advisory_xact_lock(${FEED_LOCK_NS}::int4, hashtext(${source.id})) AS locked`,
    );
    if (!gate[0]?.locked) return;

    const src = await tx.calendarSource.findUnique({
      where: { id: source.id },
      select: { lastFeedEventCount: true, lastReconcileAt: true },
    });
    if (!src) return;
    // Stale-run guard: a newer reliable run already reconciled → don't let this older run overwrite.
    if (src.lastReconcileAt && runStartedAt <= src.lastReconcileAt) return;

    // RELIABILITY GATE 1 — empty / unparseable feed never mass-cancels (keep the last baseline).
    if (eventCount === 0) {
      warning = "Takvim akışı boş/okunamadı — kayıp uzlaştırması bu turda atlandı.";
      return;
    }
    // RELIABILITY GATE 2 — a suspicious sudden drop is treated as a partial feed: skip miss
    // tracking this run AND keep the TRUSTED baseline (Codex). Earlier this lowered the
    // baseline to the suspicious count, which QUARANTINE-DEFEATED itself: 100→10 skipped once,
    // but baseline became 10, so the SAME partial feed (10) was no longer "suspicious" next run
    // → the 90 missing rows accrued misses and could mass-cancel after 2 misses + 24h. Keeping
    // the high baseline means a sustained partial NEVER reconciles until a FULL feed reappears
    // (≥ ratio of the baseline) — the deliberate, safe bias for this feature (mass-cancel = never
    // again). A genuinely-shrunk feed simply won't auto-cancel; the host sees the rows linger.
    if (
      src.lastFeedEventCount != null &&
      src.lastFeedEventCount >= SUSPICIOUS_DROP_MIN_BASE &&
      eventCount < src.lastFeedEventCount * SUSPICIOUS_DROP_RATIO
    ) {
      warning = `Takvim akışı ${src.lastFeedEventCount} → ${eventCount} ani düşüş (kısmi olabilir) — kayıp uzlaştırması bu turda atlandı.`;
      await tx.calendarSource.update({
        where: { id: source.id },
        data: { lastReconcileAt: runStartedAt }, // baseline KORUNUR — suspicious sayı bazı ezmez
      });
      return;
    }

    // RELIABLE run. Candidates: only FUTURE, source-bound, still-active rows of THIS feed.
    const candidates = await tx.reservation.findMany({
      where: {
        propertyId: source.propertyId,
        channel,
        calendarSourceId: source.id, // source binding — never touch another source / Hospitable / legacy-NULL
        sourceReference: { not: null },
        status: { in: ["confirmed", "pending"] },
        arrivalDate: { gt: now },
      },
      select: { id: true, sourceReference: true, feedMissingCount: true, feedFirstMissingAt: true },
    });

    for (const r of candidates) {
      const present = r.sourceReference != null && seenRefs.has(r.sourceReference);
      if (present) {
        // Reappeared / still there → reset the missing streak atomically.
        await tx.reservation.updateMany({
          where: { id: r.id },
          data: { feedMissingCount: 0, feedFirstMissingAt: null, feedLastSeenAt: runStartedAt },
        });
        continue;
      }
      // Missing this run → grow the streak; anchor firstMissing on the first miss.
      const count = (r.feedMissingCount ?? 0) + 1;
      const firstMissing = r.feedFirstMissingAt ?? runStartedAt;
      await tx.reservation.updateMany({
        where: { id: r.id },
        data: { feedMissingCount: count, feedFirstMissingAt: firstMissing },
      });
      // Cancel ONLY when BOTH thresholds are crossed. One-time, source-bound + still-active
      // re-checked atomically inside the UPDATE.
      if (count >= FEED_MISSING_THRESHOLD && now.getTime() - firstMissing.getTime() >= FEED_MISSING_MIN_MS) {
        const res = await tx.reservation.updateMany({
          where: { id: r.id, calendarSourceId: source.id, status: { in: ["confirmed", "pending"] } },
          data: { status: "cancelled" },
        });
        if (res.count === 1) cancelledIds.push(r.id);
      }
    }

    await tx.calendarSource.update({
      where: { id: source.id },
      data: { lastFeedEventCount: eventCount, lastReconcileAt: runStartedAt },
    });
  });

  // Auto-task cleanup for the cancelled stays — ONLY system-origin tasks (manual/ai preserved).
  // Best-effort, outside the tx so a task hiccup never rolls back a correct cancellation.
  for (const id of cancelledIds) {
    await removeAutoTasksForCancelledReservation(id).catch(() => {});
  }
  return { cancelled: cancelledIds.length, warning };
}

/** Sync every calendar source belonging to an organization. */
export async function syncAllSourcesForOrg(orgId: string): Promise<SyncResult & { sources: number }> {
  const sources = await prisma.calendarSource.findMany({
    where: { property: { organizationId: orgId } },
    select: { id: true },
  });

  const total: SyncResult & { sources: number } = {
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    sources: sources.length,
  };

  for (const s of sources) {
    const r = await syncCalendarSource(s.id);
    total.imported += r.imported;
    total.updated += r.updated;
    total.skipped += r.skipped;
    total.errors.push(...r.errors);
  }

  return total;
}
