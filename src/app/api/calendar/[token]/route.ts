import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { buildIcsCalendar, buildIcalEvents, EXPORTED_CALENDAR_NAME } from "@/lib/export/ics";
import { rateLimit, rateLimitClientKey } from "@/lib/rate-limit";
import { orgTimezone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

/** Belirteç biçimi (16–200, URL-güvenli). Eski satırların belirteci de bu alfabededir; daha dar kalıp eski aboneliği kırabilirdi. */
const CALENDAR_TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,200}$/;

/** Takvim aktarımına giren geçmiş pencere (U14, kurucu 10-22): son bu kadar günde çıkış yapanlar + gelecek. */
const ICAL_FEED_PAST_DAYS = 60;

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

  // Biçim sorgudan ÖNCE (sızma testi 11-14, A-1): `generateCalendarToken` yalnız [0-9a-f] üretir. NUL ya da başka denetim karakteri
  // taşıyan belirteç PostgreSQL'de sorgu hatasına (yakalanmayan istek hatası + ortak uyarı kovası) dönüşüyordu — kimliksiz biri gerçek
  // alarmları bastırabiliyordu. QR yoluyla AYNI kalıp (`GUEST_CHAT_TOKEN_SHAPE`, 10-01 A04).
  if (!token || !CALENDAR_TOKEN_SHAPE.test(token)) {
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
      organization: { select: { icalShowGuestName: true, timezone: true } },
      // U14 (kurucu 10-22, "Son 60 gün olsun ve ilerisi olsun"): yalnız son 60 günde çıkış yapanlar + gelecek. Eskiden hesabın açıldığı
      // günden beri BÜTÜN rezervasyonlar her çekişte üçüncü tarafa (Airbnb / Booking / Google) gidiyordu — ad açıksa geçmiş misafir adları
      // da. Kanallar engel için yalnız bugün ve sonrasını kullanır; 60 gün geriye bakış ev sahibinin kendi takviminde yakın geçmişi korur.
      reservations: {
        where: {
          status: { in: ["confirmed", "completed", "pending"] },
          departureDate: { gte: new Date(Date.now() - ICAL_FEED_PAST_DAYS * 86_400_000) },
        },
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
  // Gün org diliminde okunur (tek tarih kuralı; saat dilimli giriş UTC gününe kaymasın — Codex 09-30 A2).
  const events = buildIcalEvents(property.reservations, showGuestName, orgTimezone(property.organization?.timezone));

  // Başlık genel ad: dairenin iç adı üçüncü taraflara gitmez (K16-1, kurucu 11-26).
  const ics = buildIcsCalendar(EXPORTED_CALENDAR_NAME, events);

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
