import { NextResponse } from "next/server";
import { requireSession, unauthorized } from "@/lib/api";
import {
  isHospitableConfigured,
  listReservations,
  listMessages,
} from "@/lib/hospitable";

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

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  if (!isHospitableConfigured()) {
    return NextResponse.json({ ok: false, error: "HOSPITABLE_API_TOKEN tanımlı değil." });
  }

  const out: Record<string, unknown> = { ok: true };

  try {
    const reservations = await listReservations();
    out.reservations = {
      count: reservations.length,
      shape: reservations.length ? shapeOf(reservations[0]) : null,
    };

    const first = reservations[0];
    if (first?.id) {
      try {
        const messages = await listMessages(String(first.id));
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
}
