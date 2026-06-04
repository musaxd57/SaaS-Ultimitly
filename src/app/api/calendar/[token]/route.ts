import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { buildIcsCalendar, type IcsEvent } from "@/lib/export/ics";

export const dynamic = "force-dynamic";

/**
 * Public iCal feed for a single property, secured by an unguessable token.
 * External channels (Airbnb, Booking.com, Google Calendar) subscribe to this
 * URL and block the exported reservation dates. No session is required — the
 * token in the path is the only credential, so it must stay secret.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (!token || token.length < 16) {
    return new Response("Not found", { status: 404 });
  }

  const property = await prisma.property.findUnique({
    where: { icalToken: token },
    include: {
      reservations: {
        where: { status: { in: ["confirmed", "completed", "pending"] } },
        orderBy: { arrivalDate: "asc" },
      },
    },
  });

  if (!property) {
    return new Response("Not found", { status: 404 });
  }

  const events: IcsEvent[] = property.reservations.map((r) => ({
    uid: `${r.id}@guestops-ai`,
    summary: r.status === "cancelled" ? `İptal — ${r.guestName}` : `Rezervasyon — ${r.guestName}`,
    start: r.arrivalDate,
    end: r.departureDate,
    description: [
      r.guestName ? `Misafir: ${r.guestName}` : null,
      r.channel ? `Kanal: ${r.channel}` : null,
      r.sourceReference ? `Referans: ${r.sourceReference}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    allDay: true,
  }));

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
