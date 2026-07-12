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

  it("marks a reservation cancelled when the feed says STATUS:CANCELLED (keeps others)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics" },
    });
    mockFetch(ICS);
    await syncCalendarSource(source.id);
    vi.restoreAllMocks();
    expect(
      (await prisma.reservation.findFirst({ where: { propertyId, sourceReference: "abc-123@airbnb.com" } }))?.status,
    ).toBe("confirmed");

    // Same feed, but the first booking is now STATUS:CANCELLED; the second stays live.
    const withCancel = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:abc-123@airbnb.com
DTSTART;VALUE=DATE:20260710
DTEND;VALUE=DATE:20260714
SUMMARY:Ahmet Yılmaz
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
UID:def-456@airbnb.com
DTSTART;VALUE=DATE:20260720
DTEND;VALUE=DATE:20260722
SUMMARY:Jane Doe
END:VEVENT
END:VCALENDAR`;
    mockFetch(withCancel);
    await syncCalendarSource(source.id);

    const cancelled = await prisma.reservation.findFirst({ where: { propertyId, sourceReference: "abc-123@airbnb.com" } });
    const live = await prisma.reservation.findFirst({ where: { propertyId, sourceReference: "def-456@airbnb.com" } });
    expect(cancelled?.status).toBe("cancelled");
    expect(live?.status).toBe("confirmed"); // still present → untouched
  });

  it("cancels a FUTURE reservation that silently disappears from the feed (reconciliation)", async () => {
    const two = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:fut-1@airbnb.com
DTSTART;VALUE=DATE:20270301
DTEND;VALUE=DATE:20270305
SUMMARY:Guest One
END:VEVENT
BEGIN:VEVENT
UID:fut-2@airbnb.com
DTSTART;VALUE=DATE:20270310
DTEND;VALUE=DATE:20270312
SUMMARY:Guest Two
END:VEVENT
END:VCALENDAR`;
    const onlyFirst = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:fut-1@airbnb.com
DTSTART;VALUE=DATE:20270301
DTEND;VALUE=DATE:20270305
SUMMARY:Guest One
END:VEVENT
END:VCALENDAR`;
    const { propertyId } = await makeOrgWithProperty();
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics" },
    });
    mockFetch(two);
    await syncCalendarSource(source.id);
    vi.restoreAllMocks();
    expect(await prisma.reservation.count({ where: { propertyId, status: "confirmed" } })).toBe(2);

    // fut-2 disappears from the feed → it was cancelled upstream (Airbnb removes).
    mockFetch(onlyFirst);
    await syncCalendarSource(source.id);

    expect(
      (await prisma.reservation.findFirst({ where: { propertyId, sourceReference: "fut-1@airbnb.com" } }))?.status,
    ).toBe("confirmed");
    expect(
      (await prisma.reservation.findFirst({ where: { propertyId, sourceReference: "fut-2@airbnb.com" } }))?.status,
    ).toBe("cancelled");
  });

  it("does NOT mass-cancel when the feed comes back empty (guard)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics" },
    });
    mockFetch(ICS);
    await syncCalendarSource(source.id);
    vi.restoreAllMocks();

    // A transiently empty (but valid) feed must not cancel everything.
    mockFetch(`BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR`);
    await syncCalendarSource(source.id);
    expect(await prisma.reservation.count({ where: { propertyId, status: "cancelled" } })).toBe(0);
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

describe("reconciliation source-binding (mass-cancel guard)", () => {
  afterEach(() => vi.restoreAllMocks());
  const day = (d: number) => new Date(Date.now() + d * 86_400_000);
  const ymd = (d: number) => day(d).toISOString().slice(0, 10).replace(/-/g, "");
  const feedWith = (uid: string) =>
    `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:${uid}\nDTSTART;VALUE=DATE:${ymd(10)}\nDTEND;VALUE=DATE:${ymd(12)}\nSUMMARY:Reserved\nEND:VEVENT\nEND:VCALENDAR`;

  it("NEVER cancels another integration's same-channel booking (e.g. Hospitable) on a feed sync", async () => {
    const { propertyId } = await makeOrgWithProperty();
    // Imported by the HOSPITABLE sync: same channel, but NOT from this feed.
    const hosp = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Hospitable Misafiri",
        arrivalDate: day(10),
        departureDate: day(12),
        status: "confirmed",
        channel: "airbnb",
        sourceReference: "HOSP-1",
      },
    });
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/a.ics" },
    });
    mockFetch(feedWith("ical-1@airbnb.com"));
    await syncCalendarSource(source.id);
    const after = await prisma.reservation.findUnique({ where: { id: hosp.id } });
    expect(after?.status).toBe("confirmed"); // feed must only reconcile ITS OWN rows
  });

  it("two same-channel feeds never cancel each other's bookings", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const s1 = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/1.ics" },
    });
    const s2 = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/2.ics" },
    });
    mockFetch(feedWith("uid-s1@airbnb.com"));
    await syncCalendarSource(s1.id);
    vi.restoreAllMocks();
    mockFetch(feedWith("uid-s2@airbnb.com"));
    await syncCalendarSource(s2.id); // s2's feed does NOT contain s1's UID
    const s1row = await prisma.reservation.findFirst({ where: { propertyId, sourceReference: "uid-s1@airbnb.com" } });
    expect(s1row?.status).toBe("confirmed");
  });
});
