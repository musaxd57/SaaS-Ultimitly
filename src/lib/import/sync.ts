import "server-only";
import { prisma } from "@/lib/db";
import { parseIcs } from "@/lib/import/ics";

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
    const res = await fetch(source.url, {
      headers: { "User-Agent": "GuestOps-AI/1.0" },
      // iCal feeds change often; never serve a stale cached copy.
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    text = await res.text();
  } catch (err) {
    result.errors.push(`Bağlantı hatası: ${String(err).slice(0, 120)}`);
    await prisma.calendarSource.update({
      where: { id: sourceId },
      data: { lastSyncedAt: new Date(), lastStatus: "error", lastResult: result.errors[0] },
    });
    return result;
  }

  const rows = parseIcs(text);

  for (const row of rows) {
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
            select: { id: true },
          })
        : null;

      if (existing) {
        await prisma.reservation.update({
          where: { id: existing.id },
          data: {
            guestName: row.guestName,
            arrivalDate: row.arrivalDate,
            departureDate: row.departureDate,
            notes: row.notes ?? null,
          },
        });
        result.updated++;
      } else {
        await prisma.reservation.create({
          data: {
            propertyId: source.propertyId,
            guestName: row.guestName,
            arrivalDate: row.arrivalDate,
            departureDate: row.departureDate,
            channel,
            status: "confirmed",
            sourceReference: row.sourceReference ?? null,
            notes: row.notes ?? null,
            currency: "EUR",
          },
        });
        result.imported++;
      }
    } catch (err) {
      result.errors.push(`Kayıt hatası: ${String(err).slice(0, 80)}`);
      result.skipped++;
    }
  }

  const summary =
    `${result.imported} yeni, ${result.updated} güncellendi, ${result.skipped} atlandı` +
    (result.errors.length ? `, ${result.errors.length} hata` : "");

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
