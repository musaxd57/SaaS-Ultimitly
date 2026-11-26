import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { stayDay } from "../helpers/stay-dates";
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
  // Sızma testi 11-14 (A-1): belirteç biçimi sorgudan ÖNCE. NUL (ya da başka denetim karakteri) taşıyan belirteç PostgreSQL'de sorgu
  // hatasına dönüşüp yakalanmayan istek hatası raporluyordu → kimliksiz biri tek ortak uyarı kovasını doldurarak GERÇEK hata alarmlarını
  // bastırabiliyordu. QR yolu aynı sınıfı 10-01'de (A04) kapatmıştı.
  it("🚨 NUL / denetim karakterli belirteç 404 — sorguya hiç gitmez (hata yok)", async () => {
    for (const bad of ["\u0000".repeat(20), `feed-token-aaaa\u0000aaaaaaaaaaaa`, "feed token aaaaaaaaaaaaaaaa", "a".repeat(201)]) {
      const res = await fetchFeed(bad, "198.51.100.7");
      expect(res.status).toBe(404);
    }
    expect((await fetchFeed(TOKEN_A, "198.51.100.7")).status).toBe(200); // aşırı uygulama yok
  });
});

// ---------------------------------------------------------------------------
// CODEX 09-30 (A2): besleme günü ORG DİLİMİNDE okur — rota org'un saat dilimini dışa aktarıma geçiriyor mu (bağlantı pini).
// ---------------------------------------------------------------------------
describe("takvim beslemesi — gün org diliminde", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
  });

  // Konaklama BUGÜNE GÖRE kurulur (11-13): besleme 60 günden eski çıkışı dışarıda bırakır (`ICAL_FEED_PAST_DAYS`); sabit tarihli konaklama
  // (4–7 Ekim 2026) 6 Aralık'ta pencereden düşecek ve test ürün değişmeden kırmızıya dönecekti (saat 35 gün ileri alınınca görüldü).
  // 21:00Z = İstanbul'da (UTC+3, yaz saati yok) ertesi günün 00:00'ı · New York'ta (UTC-5 / -4) aynı günün öğleden sonrası.
  const at21Z = (daysFromToday: number) => new Date(stayDay(daysFromToday).getTime() + 21 * 3_600_000);
  const icsDay = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const ARRIVAL_IN = 10;
  const DEPARTURE_IN = 13;

  it("🚨 İstanbul org'unda saat dilimli giriş (…T21:00Z) beslemede İstanbul günüyle görünür", async () => {
    const org = await prisma.organization.create({ data: { name: "Org", timezone: "Europe/Istanbul" } });
    const p = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 3", icalToken: TOKEN_A } });
    await prisma.reservation.create({
      data: {
        propertyId: p.id,
        guestName: "Misafir",
        arrivalDate: at21Z(ARRIVAL_IN),
        departureDate: at21Z(DEPARTURE_IN),
        channel: "ics",
        status: "confirmed",
      },
    });
    const text = await (await fetchFeed(TOKEN_A, "203.0.113.9")).text();
    expect(text).toContain(`DTSTART;VALUE=DATE:${icsDay(stayDay(ARRIVAL_IN + 1))}`);
    expect(text).toContain(`DTEND;VALUE=DATE:${icsDay(stayDay(DEPARTURE_IN + 1))}`);
  });

  it("New York org'unda aynı anlar New York günüdür (org dilimi gerçekten okunuyor)", async () => {
    const org = await prisma.organization.create({ data: { name: "Org", timezone: "America/New_York" } });
    const p = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 3", icalToken: TOKEN_A } });
    await prisma.reservation.create({
      data: {
        propertyId: p.id,
        guestName: "Misafir",
        arrivalDate: at21Z(ARRIVAL_IN),
        departureDate: at21Z(DEPARTURE_IN),
        channel: "ics",
        status: "confirmed",
      },
    });
    const text = await (await fetchFeed(TOKEN_A, "203.0.113.9")).text();
    expect(text).toContain(`DTSTART;VALUE=DATE:${icsDay(stayDay(ARRIVAL_IN))}`);
    expect(text).toContain(`DTEND;VALUE=DATE:${icsDay(stayDay(DEPARTURE_IN))}`);
  });

});
