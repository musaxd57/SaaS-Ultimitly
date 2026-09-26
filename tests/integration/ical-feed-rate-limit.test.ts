import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { GET } from "@/app/api/calendar/[token]/route";

// ---------------------------------------------------------------------------
// HALKA AÇIK TAKVİM BESLEMESİ — HIZ SINIRI TAKVİM BAŞINA (09-23 inceleme turu).
//
// Airbnb, Booking ve Google bu adresi kendi sunucularından periyodik olarak çeker. Sınır
// tek kovaydı: ağ başına 60/dk. IPv6 kovası aynı gün /64 önekine indirilince (giriş turu)
// bir platformun AYNI /64'ten birçok müşterinin takvimini çeken sunucuları TEK kovayı
// paylaşacaktı → 61. çekim 429 → kanal takvimi bayatlar → ÇİFT REZERVASYON riski.
// Artık iki kova: ağ başına geniş taşma kapısı (geçersiz token seli DB'yi dövmesin) +
// takvim BAŞINA ağ başına 60/dk (tek abonenin bir takvimi dövmesi).
// ---------------------------------------------------------------------------

const TOKEN_A = "feed-token-aaaaaaaaaaaaaaaa";
const TOKEN_B = "feed-token-bbbbbbbbbbbbbbbb";

function fetchFeed(token: string, ip: string) {
  const req = new NextRequest(`http://localhost/api/calendar/${token}`, {
    headers: { "x-forwarded-for": ip },
  });
  return GET(req, { params: Promise.resolve({ token }) });
}

describe("takvim beslemesi hız sınırı", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await prisma.property.create({ data: { organizationId: org.id, name: "Lale A", icalToken: TOKEN_A } });
    await prisma.property.create({ data: { organizationId: org.id, name: "Lale B", icalToken: TOKEN_B } });
  });

  it("🚨 aynı /64'ten İKİ FARKLI takvimi 60'ar kez çeken platform 429 ALMAZ", async () => {
    const statuses: number[] = [];
    for (let i = 1; i <= 60; i++) {
      statuses.push((await fetchFeed(TOKEN_A, `2001:db8:cafe:1::${i.toString(16)}`)).status);
      statuses.push((await fetchFeed(TOKEN_B, `2001:db8:cafe:1::${(i + 100).toString(16)}`)).status);
    }
    expect(statuses.filter((s) => s !== 200)).toEqual([]);
  });

  it("aynı takvimi aynı ağdan dakikada 60'tan fazla çeken 429 alır; öteki takvim ETKİLENMEZ", async () => {
    for (let i = 1; i <= 60; i++) {
      expect((await fetchFeed(TOKEN_A, `2001:db8:cafe:2::${i.toString(16)}`)).status).toBe(200);
    }
    expect((await fetchFeed(TOKEN_A, "2001:db8:cafe:2::ff")).status).toBe(429);
    expect((await fetchFeed(TOKEN_B, "2001:db8:cafe:2::ff")).status).toBe(200);
  });

  it("taşma kapısı: geçersiz token seli ağ başına sınırlanır (geçerli takvim de o ağdan beklemeye düşer)", async () => {
    for (let i = 0; i < 600; i++) {
      expect((await fetchFeed("x", "2001:db8:cafe:3::1")).status).toBe(404);
    }
    expect((await fetchFeed("x", "2001:db8:cafe:3::2")).status).toBe(429);
    expect((await fetchFeed(TOKEN_A, "2001:db8:cafe:3::3")).status).toBe(429);
    // Başka ağ etkilenmez.
    expect((await fetchFeed(TOKEN_A, "2001:db8:beef:3::1")).status).toBe(200);
  }, 60_000);
});
