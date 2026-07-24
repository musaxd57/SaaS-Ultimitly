import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withManage } from "@/lib/route-guard";
import { listProperties, listReservations, listMessages } from "@/lib/hospitable";
import { getOrgHospitableToken } from "@/lib/hospitable-credentials";

// ---------------------------------------------------------------------------
// Hospitable structural diagnostics (dev aid)
//
// Returns the SHAPE (field names + value types) of the reservation and message
// objects — never guest values — so the sync mapping can be written against the
// real API instead of guessed field names. Open this URL in the browser while
// logged in and share the (PII-free) output.
// ---------------------------------------------------------------------------

/** Recursively reduce a value to its structure: keys preserved, values → type names. */
function shapeOf(value: unknown, depth = 0): unknown {
  if (depth > 5) return "…";
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0], depth + 1)] : [];
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = shapeOf(v, depth + 1);
    }
    return out;
  }
  return typeof value;
}

// Channel diagnostics expose the org's property list + internal ids — owner/
// manager/operator only, never staff (withManage).
export const GET = withManage(async (session) => {
  const token = await getOrgHospitableToken(session.organizationId);
  if (!token) {
    return NextResponse.json({ ok: false, error: "Hospitable bağlı değil." });
  }

  const out: Record<string, unknown> = { ok: true };

  try {
    // /reservations requires a properties[] filter, so resolve property IDs first.
    const properties = await listProperties(token);
    const propertyIds = properties.map((p) => p.id);
    out.propertiesCount = propertyIds.length;

    // List every property the API returns (id + name) so duplicates are visible.
    out.properties = properties.map((p) => ({ id: p.id, name: p.name ?? p.public_name ?? "?" }));
    // Flag any name the API returns more than once (e.g. a real "serdarı ekrem 1"
    // twin on the Hospitable side vs. a stale record only in our DB).
    const nameCounts = new Map<string, number>();
    for (const p of properties) {
      const n = p.name ?? p.public_name ?? "?";
      nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
    }
    out.duplicateNames = [...nameCounts.entries()]
      .filter(([, c]) => c > 1)
      .map(([name, count]) => ({ name, count }));

    // ORPHANS: our DB properties whose hospitableId is NO LONGER returned by
    // Hospitable (e.g. a listing whose id changed → a stale duplicate left
    // behind). These are the records that are safe to delete. Read-only.
    const liveIds = new Set(properties.map((p) => p.id));
    const dbProps = await prisma.property.findMany({
      where: { organizationId: session.organizationId },
      select: {
        id: true,
        name: true,
        hospitableId: true,
        _count: { select: { reservations: true, conversations: true } },
      },
    });
    out.dbPropertiesCount = dbProps.length;
    out.orphans = dbProps
      .filter((p) => p.hospitableId !== null && !liveIds.has(p.hospitableId))
      .map((p) => ({
        sil_bunu_lixusId: p.id,
        name: p.name,
        hospitableId: p.hospitableId,
        reservations: p._count.reservations,
        conversations: p._count.conversations,
      }));

    const reservations = await listReservations({ propertyIds }, token);

    // Status breakdown — reveals whether pre-approval / inquiry reservations are
    // returned by this endpoint at all (so we know if they CAN be synced).
    const statusCounts: Record<string, number> = {};
    for (const r of reservations) {
      const raw =
        `${(r as { status?: string }).status ?? ""}|${(r as { reservation_status?: { current?: { category?: string } } }).reservation_status?.current?.category ?? ""}`.trim();
      const key = raw === "|" ? "(boş)" : raw;
      statusCounts[key] = (statusCounts[key] ?? 0) + 1;
    }
    out.reservationStatuses = statusCounts;

    out.reservations = {
      count: reservations.length,
      shape: reservations.length ? shapeOf(reservations[0]) : null,
    };

    const first = reservations[0];
    if (first?.id) {
      try {
        const messages = await listMessages(String(first.id), token);
        out.messages = {
          reservationKeyTried: "id",
          count: messages.length,
          shape: messages.length ? shapeOf(messages[0]) : null,
        };
      } catch (err) {
        out.messages = { error: err instanceof Error ? err.message : String(err) };
      }
    } else {
      out.messages = { skipped: "reservation objesinde 'id' bulunamadı" };
    }
  } catch (err) {
    out.reservations = { error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json(out);
});
