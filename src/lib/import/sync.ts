import "server-only";
import { prisma } from "@/lib/db";
import { parseIcs } from "@/lib/import/ics";
import { createReservationTasks, removeAutoTasksForCancelledReservation } from "@/lib/automation";
import { isPrivateHost, resolvesToPrivate } from "@/lib/net/private-host";
import { ANON_NAME } from "@/lib/data-retention";

export interface SyncResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
}

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

  let text: string;
  try {
    // SSRF guard (defense-in-depth for rows created before the route guard):
    // never fetch a loopback / link-local / private / metadata target — neither a
    // LITERAL private address nor a public hostname that currently RESOLVES to a
    // private one (DNS is checked at fetch time; records can change after save).
    const feedHost = new URL(source.url).hostname;
    if (isPrivateHost(feedHost) || (await resolvesToPrivate(feedHost))) {
      throw new Error("blocked private host");
    }
    const res = await fetch(source.url, {
      headers: { "User-Agent": "Lixus-AI/1.0" },
      // iCal feeds change often; never serve a stale cached copy.
      cache: "no-store",
      // SSRF: do NOT follow redirects — a public host could 30x to an internal
      // URL that bypasses the isPrivateHost check on the original hostname. A 3xx
      // then fails the res.ok check below. Bound the fetch so a slow-loris internal
      // endpoint can't wedge the request.
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    // Guard against a runaway feed buffering a huge body into memory on the
    // shared replica (the feed URL is host-supplied). Content-Length when present,
    // plus a post-read length backstop for chunked responses.
    const declared = Number(res.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > 10 * 1024 * 1024) {
      throw new Error("feed too large");
    }
    text = await res.text();
    if (text.length > 10 * 1024 * 1024) {
      throw new Error("feed too large");
    }
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
      const existing = row.sourceReference
        ? await prisma.reservation.findFirst({
            where: { propertyId: source.propertyId, sourceReference: row.sourceReference },
            select: { id: true, guestName: true, status: true },
          })
        : null;

      // Feed explicitly marks the booking CANCELLED → reflect it locally (cancel +
      // drop the auto tasks), never import it as a live stay.
      if (row.status === "CANCELLED") {
        if (existing && existing.status !== "cancelled") {
          await prisma.reservation.update({ where: { id: existing.id }, data: { status: "cancelled" } });
          await removeAutoTasksForCancelledReservation(existing.id);
          result.updated++;
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
        await prisma.reservation.update({
          where: { id: existing.id },
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
        // Backfill tasks for reservations imported before task automation existed.
        await createReservationTasks(existing.id);
        result.updated++;
      } else {
        const created = await prisma.reservation.create({
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
        await createReservationTasks(created.id);
        result.imported++;
      }
    } catch {
      result.errors.push("Kaydetme sırasında bir sorun oluştu, tekrar deneyin.");
      result.skipped++;
    }
  }

  // Reconciliation for OTAs (e.g. Airbnb) that REMOVE a cancelled event instead of
  // marking it STATUS:CANCELLED: a strictly-FUTURE reservation from this feed's
  // channel whose UID is no longer present was cancelled upstream → cancel it +
  // drop its auto tasks. Guarded hard: only when the feed returned events (a
  // transient empty/broken feed must never mass-cancel), only future arrivals
  // (a current/past stay is left alone), best-effort (never fails the import).
  if (rows.length > 0) {
    try {
      const upcoming = await prisma.reservation.findMany({
        where: {
          propertyId: source.propertyId,
          channel,
          // SOURCE BINDING (mass-cancel guard): only rows THIS feed imported are
          // candidates. Another feed's rows, Hospitable's rows, and legacy
          // unbound rows (calendarSourceId NULL) are never touched — a feed can
          // only "disappear" what it once showed.
          calendarSourceId: source.id,
          sourceReference: { not: null },
          status: { in: ["confirmed", "pending"] },
          arrivalDate: { gt: new Date() },
        },
        select: { id: true, sourceReference: true },
      });
      for (const r of upcoming) {
        if (r.sourceReference && !seenRefs.has(r.sourceReference)) {
          await prisma.reservation.update({ where: { id: r.id }, data: { status: "cancelled" } });
          await removeAutoTasksForCancelledReservation(r.id);
          result.updated++;
        }
      }
    } catch {
      // best-effort — reconciliation must not turn a good import into a failure
    }
  }

  const parts: string[] = [];
  if (result.imported > 0) parts.push(`${result.imported} yeni rezervasyon`);
  if (result.updated > 0) parts.push(`${result.updated} güncellendi`);
  if (result.skipped > 0) parts.push(`${result.skipped} atlandı`);
  if (result.errors.length) parts.push(`${result.errors.length} hata`);
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
