import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { syncCalendarSource } from "@/lib/import/sync";
import { ANON_NAME } from "@/lib/data-retention";

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Airbnb//Hosting Calendar//EN
BEGIN:VEVENT
UID:abc-123@airbnb.com
DTSTART;VALUE=DATE:20260710
DTEND;VALUE=DATE:20260714
SUMMARY:Ahmet Yılmaz
END:VEVENT
BEGIN:VEVENT
UID:def-456@airbnb.com
DTSTART;VALUE=DATE:20260720
DTEND;VALUE=DATE:20260722
SUMMARY:Jane Doe
END:VEVENT
END:VCALENDAR`;

function mockFetch(body: string, ok = true) {
  return vi.spyOn(global, "fetch").mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    text: async () => body,
  } as Response);
}

describe("syncCalendarSource", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("imports reservations from a fetched iCal feed", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics" },
    });
    mockFetch(ICS);

    const result = await syncCalendarSource(source.id);

    expect(result.imported).toBe(2);
    expect(result.updated).toBe(0);
    const count = await prisma.reservation.count({ where: { propertyId } });
    expect(count).toBe(2);
    const first = await prisma.reservation.findFirst({
      where: { propertyId, sourceReference: "abc-123@airbnb.com" },
    });
    expect(first?.guestName).toBe("Ahmet Yılmaz");
    expect(first?.channel).toBe("airbnb");

    // Each imported (future-dated) reservation gets a checkout cleaning task.
    const cleaning = await prisma.task.count({ where: { propertyId, type: "cleaning" } });
    expect(cleaning).toBe(2);
  });

  it("updates instead of duplicating on a second sync", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics" },
    });

    mockFetch(ICS);
    await syncCalendarSource(source.id);
    vi.restoreAllMocks();

    mockFetch(ICS);
    const second = await syncCalendarSource(source.id);

    expect(second.imported).toBe(0);
    expect(second.updated).toBe(2);
    const count = await prisma.reservation.count({ where: { propertyId } });
    expect(count).toBe(2);
    // Re-sync must not duplicate the cleaning tasks.
    const cleaning = await prisma.task.count({ where: { propertyId, type: "cleaning" } });
    expect(cleaning).toBe(2);
  });

  it("does not resurrect a guest name that the retention sweep anonymized", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics" },
    });

    // First sync brings the real name in.
    mockFetch(ICS);
    await syncCalendarSource(source.id);
    vi.restoreAllMocks();

    // The retention sweep anonymizes the stay (guestName → sentinel).
    await prisma.reservation.updateMany({
      where: { propertyId, sourceReference: "abc-123@airbnb.com" },
      data: { guestName: ANON_NAME },
    });

    // The feed still carries the real name, with a shifted departure date.
    const shifted = ICS.replace("DTEND;VALUE=DATE:20260714", "DTEND;VALUE=DATE:20260715");
    mockFetch(shifted);
    const second = await syncCalendarSource(source.id);

    expect(second.updated).toBe(2);
    const anon = await prisma.reservation.findFirst({
      where: { propertyId, sourceReference: "abc-123@airbnb.com" },
    });
    // Name stays anonymized — the feed cannot write PII back.
    expect(anon?.guestName).toBe(ANON_NAME);
    // Non-PII dates still refresh so occupancy stays correct.
    expect(anon?.departureDate.toISOString().slice(0, 10)).toBe("2026-07-15");

    // A row that was NOT anonymized still updates its name normally.
    const jane = await prisma.reservation.findFirst({
      where: { propertyId, sourceReference: "def-456@airbnb.com" },
    });
    expect(jane?.guestName).toBe("Jane Doe");
  });

  it("records an error status when the feed cannot be fetched", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Booking", url: "https://example.com/bad.ics" },
    });
    mockFetch("", false);

    const result = await syncCalendarSource(source.id);

    expect(result.errors.length).toBeGreaterThan(0);
    const updated = await prisma.calendarSource.findUnique({ where: { id: source.id } });
    expect(updated?.lastStatus).toBe("error");
  });
});
