import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { buildIcsCalendar, buildIcalEvents } from "@/lib/export/ics";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Public iCal feed for a single property, secured by an unguessable token.
 * External channels (Airbnb, Booking.com, Google Calendar) subscribe to this
 * URL and block the exported reservation dates. No session is required — the
 * token in the path is the only credential, so it must stay secret.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  // Public + unauthenticated: cap per-IP so a single client can't hammer it.
  // Generous — legitimate calendar subscribers poll infrequently per IP.
  const limited = rateLimit(`ical:${clientIp(req)}`, 60, 60_000);
  if (!limited.ok) {
    return new Response("Too many requests", {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, limited.retryAfter)) },
    });
  }

  const { token } = await params;

  if (!token || token.length < 16) {
    return new Response("Not found", { status: 404 });
  }

  const property = await prisma.property.findUnique({
    where: { icalToken: token },
    include: {
      organization: { select: { icalShowGuestName: true } },
      reservations: {
        where: { status: { in: ["confirmed", "completed", "pending"] } },
        orderBy: { arrivalDate: "asc" },
      },
    },
  });

  if (!property) {
    return new Response("Not found", { status: 404 });
  }

  // KVKK data-minimization: this feed is handed to third parties (Airbnb, Booking,
  // Google), so the guest's real name is HIDDEN by default — the block-dates use
  // case only needs busy windows. A host can opt in (per-org setting) to see the
  // name in their own calendar.
  const showGuestName = property.organization?.icalShowGuestName ?? false;
  const events = buildIcalEvents(property.reservations, showGuestName);

  const ics = buildIcsCalendar(`${property.name} — Lixus AI`, events);

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${property.id}.ics"`,
      "Cache-Control": "no-cache, max-age=0",
    },
  });
}
