import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { buildIcsCalendar, buildIcalEvents } from "@/lib/export/ics";
import { rateLimit, rateLimitClientKey } from "@/lib/rate-limit";

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
  // Public + unauthenticated. 🚨 İKİ KOVA (09-23 inceleme turu): tek kova ağ başına 60/dk idi;
  // IPv6 kovası /64 önekine indirilince Airbnb/Booking/Google'ın AYNI /64'ten birçok müşterinin
  // takvimini çeken sunucuları o tek kovayı paylaşacaktı → 429 → kanal takvimi bayatlar (çift
  // rezervasyon riski). Artık: ağ başına GENİŞ taşma kapısı (geçersiz token seli DB'yi dövmesin)
  // + takvim BAŞINA ağ başına 60/dk (tek abonenin bir takvimi dövmesi). Takvim anahtarı mülk
  // kimliğidir, token DEĞİL (token bir kimlik bilgisidir, sayaç tablosuna yazılmaz).
  const net = rateLimitClientKey(req);
  const flood = await rateLimit(`ical:${net}`, 600, 60_000);
  if (!flood.ok) return tooManyRequests(flood.retryAfter);

  const { token } = await params;

  if (!token || token.length < 16) {
    return new Response("Not found", { status: 404 });
  }

  // Önce hafif arama: takvim başına kova, ağır sorgudan (tüm rezervasyonlar) ÖNCE uygulanır.
  const found = await prisma.property.findUnique({ where: { icalToken: token }, select: { id: true } });
  if (!found) {
    return new Response("Not found", { status: 404 });
  }
  const perFeed = await rateLimit(`ical-feed:${found.id}:${net}`, 60, 60_000);
  if (!perFeed.ok) return tooManyRequests(perFeed.retryAfter);

  const property = await prisma.property.findUnique({
    where: { id: found.id },
    include: {
      organization: { select: { icalShowGuestName: true } },
      reservations: {
        where: { status: { in: ["confirmed", "completed", "pending"] } },
        orderBy: { arrivalDate: "asc" },
      },
    },
  });

  // Arada mülk silinmiş olabilir (token milisaniyeler önce geçerliydi; arada döndürülmesi
  // yeni bir yetki açmaz).
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

function tooManyRequests(retryAfter: number): Response {
  return new Response("Too many requests", {
    status: 429,
    headers: { "Retry-After": String(Math.max(1, retryAfter)) },
  });
}
