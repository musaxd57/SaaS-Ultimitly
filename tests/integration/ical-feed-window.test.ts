import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { GET } from "@/app/api/calendar/[token]/route";

// ---------------------------------------------------------------------------
// U14 (kurucu 10-22, "Son 60 gün olsun ve ilerisi olsun"): takvim aktarım bağlantısı (Airbnb / Booking / Google'a verilen) yalnız son 60
// günde çıkış yapanları + gelecek rezervasyonları taşır. Eskiden hesabın açıldığı günden beri BÜTÜN rezervasyonlar her çekişte gidiyordu
// (ad açıksa geçmiş misafir adları da).
// ---------------------------------------------------------------------------

const TOKEN = "feed-token-windowwwwwwwwww";
const DAY = 86_400_000;
const at = (days: number) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) + days * DAY);

describe("takvim aktarımı — son 60 gün + gelecek", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
  });

  it("90 gün önce biten rezervasyon GİTMEZ; 30 gün önce biten, süren ve gelecek GİDER (ad açıkken adla doğrulanır)", async () => {
    const org = await prisma.organization.create({ data: { name: "Org", icalShowGuestName: true } });
    const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale", icalToken: TOKEN } });
    const mk = (guestName: string, from: number, to: number) =>
      prisma.reservation.create({
        data: { propertyId: property.id, guestName, arrivalDate: at(from), departureDate: at(to), status: "confirmed", channel: "airbnb" },
      });
    await mk("EskiMisafir", -95, -90);
    await mk("YakinGecmis", -35, -30);
    await mk("SimdiKalan", -1, 2);
    await mk("GelecekMisafir", 20, 25);
    const res = await GET(new NextRequest(`http://localhost/api/calendar/${TOKEN}`, { headers: { "x-forwarded-for": "203.0.113.9" } }), {
      params: Promise.resolve({ token: TOKEN }),
    });
    expect(res.status).toBe(200);
    const ics = await res.text();
    expect(ics).not.toContain("EskiMisafir");
    expect(ics).toContain("YakinGecmis");
    expect(ics).toContain("SimdiKalan");
    expect(ics).toContain("GelecekMisafir");
  });
});
