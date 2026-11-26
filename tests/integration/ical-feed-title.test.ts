import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { GET } from "@/app/api/calendar/[token]/route";
import { EXPORTED_CALENDAR_NAME } from "@/lib/export/ics";
import { stayDay } from "../helpers/stay-dates";

// ---------------------------------------------------------------------------
// K16-1 (Codex 11-25 ikinci rapor; kurucu 11-26 sabah: "Genel ad"): takvim aktarım bağlantısı üçüncü taraflara (Airbnb / Booking / Google)
// verilir. Başlıkta dairenin işletme içindeki adı yazıyordu ("Lale 3 — arka cephe" gibi iç notlar dışarı çıkıyordu). Başlık artık genel addır;
// etkinlik kimlikleri (UID) ve tarihleri DEĞİŞMEZ (karşı tarafın eşleşmesi bozulmasın).
// ---------------------------------------------------------------------------

const TOKEN = "feed-token-titleeeeeeeeeee";

async function feed(showGuestName: boolean) {
  const org = await prisma.organization.create({ data: { name: "Org", icalShowGuestName: showGuestName } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 3 — arka cephe", icalToken: TOKEN } });
  const res0 = await prisma.reservation.create({
    data: { propertyId: property.id, guestName: "Misafir", arrivalDate: stayDay(3), departureDate: stayDay(6), status: "confirmed", channel: "airbnb" },
  });
  const res = await GET(new NextRequest(`http://localhost/api/calendar/${TOKEN}`, { headers: { "x-forwarded-for": "203.0.113.9" } }), {
    params: Promise.resolve({ token: TOKEN }),
  });
  expect(res.status).toBe(200);
  return { ics: await res.text(), reservationId: res0.id };
}

describe("takvim aktarımı — başlık genel ad", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
  });

  it("🚨 başlıkta dairenin iç adı YOK; genel ad yazar", async () => {
    const { ics } = await feed(false);
    expect(ics).toContain(`X-WR-CALNAME:${EXPORTED_CALENDAR_NAME}`);
    expect(EXPORTED_CALENDAR_NAME).toBe("Lixus AI takvimi");
    expect(ics).not.toContain("Lale 3");
    expect(ics).not.toContain("arka cephe");
  });

  it("misafir adı gösterme açıkken de başlık genel ad (iç ad hiçbir satırda yok)", async () => {
    const { ics } = await feed(true);
    expect(ics).toContain(`X-WR-CALNAME:${EXPORTED_CALENDAR_NAME}`);
    expect(ics).not.toContain("arka cephe");
  });

  it("etkinlik kimliği (UID) değişmedi: rezervasyon kimliğinden kurulur", async () => {
    const { ics, reservationId } = await feed(false);
    const uid = ics.split(/\r?\n/).find((l) => l.startsWith("UID:"));
    expect(uid).toBeDefined();
    expect(uid).toContain(reservationId);
  });
});
