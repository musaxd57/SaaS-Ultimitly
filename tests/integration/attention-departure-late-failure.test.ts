import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { stayDayInZone } from "../helpers/stay-dates";
import { findAttentionItems } from "@/modules/intelligence/incidents/attention";
import { departureOpenHeadline } from "@/modules/intelligence/incidents/departure-open";

// ---------------------------------------------------------------------------
// ÇIKIŞTAN ÖNCE AÇIK KONU × onaylı geç çıkış OKUNAMAZSA (sert inceleme 11-25). Satır yine çıkar ama saat YAZILMAZ: yanlış saat
// ("11:00'de çıkıyor" — oysa 14:00 onaylı olabilir) yerine saatsiz satır. Veritabanı arızası taklidi öteki testlere sızmasın diye AYRI dosya.
// ---------------------------------------------------------------------------

const TZ = "Europe/Istanbul";
const HOUR = 3_600_000;

describe("çıkış satırı — onaylı geç çıkış okunamazsa", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 okuma hata verirse panel düşmez, satır çıkar, saat yazılmaz", async () => {
    const org = await prisma.organization.create({ data: { name: "Test Org", timezone: TZ } });
    const property = await prisma.property.create({
      data: { organizationId: org.id, name: "Lale 3", checkInTime: "15:00", checkOutTime: "11:00" },
    });
    const departureDate = stayDayInZone(1, TZ);
    const reservation = await prisma.reservation.create({
      data: {
        propertyId: property.id,
        guestName: "Misafir",
        arrivalDate: new Date(departureDate.getTime() - 3 * 24 * HOUR),
        departureDate,
        status: "confirmed",
        channel: "airbnb",
        currency: "EUR",
      },
    });
    const convo = await prisma.conversation.create({
      data: {
        propertyId: property.id,
        reservationId: reservation.id,
        guestIdentifier: "Misafir",
        channel: "airbnb",
        externalReservationId: `res-${reservation.id}`,
        status: "problem",
        lastMessageAt: new Date(Date.now() - HOUR),
      },
    });
    await prisma.message.create({
      data: { conversationId: convo.id, direction: "outbound", senderName: "Ev sahibi", body: "Bakıyoruz.", createdAt: new Date(Date.now() - HOUR) },
    });

    // KONTROL: okuma çalışırken saat yazılır.
    const ok = await findAttentionItems(org.id);
    expect(departureOpenHeadline(ok[0].propertyName, ok[0].departureOpen!)).toBe("Lale 3 yarın 11:00'de çıkıyor");

    const spy = vi.spyOn(prisma.decisionRequest, "findMany").mockRejectedValue(new Error("db down (test)"));
    try {
      const items = await findAttentionItems(org.id);
      expect(spy).toHaveBeenCalled(); // casus boşa kurulmadı
      const row = items.find((i) => i.departureOpen);
      expect(row).toBeDefined();
      expect(departureOpenHeadline(row!.propertyName, row!.departureOpen!)).toBe("Lale 3 yarın çıkıyor");
    } finally {
      spy.mockRestore();
    }
  });
});
