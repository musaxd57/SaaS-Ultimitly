import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
// The feed HTTP layer (node:https + pinned lookup + byte-cap) is unit-tested in
// pinned-fetch.test.ts; here we mock it to feed the sync ENGINE fixed ICS text.
vi.mock("@/lib/net/pinned-fetch", () => ({ fetchFeedText: vi.fn() }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));
import { syncCalendarSource } from "@/lib/import/sync";
import { fetchFeedText } from "@/lib/net/pinned-fetch";
import { __reconcileHooks } from "@/lib/import/sync";
import { reportError } from "@/lib/report-error";
import { ANON_NAME } from "@/lib/data-retention";

const reportErrorMock = vi.mocked(reportError);

// Fixture dates are DYNAMIC (relative to the run date). The original hardcoded
// 2026-07-1x dates were a time bomb: the day the first stay's DTEND slipped into
// the past, its checkout cleaning task (only created for future departures)
// stopped being generated and the count assertions broke — with zero code change.
const DAY = 86_400_000;
const icsDate = (daysFromToday: number) =>
  new Date(Date.now() + daysFromToday * DAY).toISOString().slice(0, 10).replace(/-/g, "");
const E1_START = icsDate(5);
const E1_END = icsDate(9);
const E2_START = icsDate(11);
const E2_END = icsDate(13);

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Airbnb//Hosting Calendar//EN
BEGIN:VEVENT
UID:abc-123@airbnb.com
DTSTART;VALUE=DATE:${E1_START}
DTEND;VALUE=DATE:${E1_END}
SUMMARY:Ahmet Yılmaz
END:VEVENT
BEGIN:VEVENT
UID:def-456@airbnb.com
DTSTART;VALUE=DATE:${E2_START}
DTEND;VALUE=DATE:${E2_END}
SUMMARY:Jane Doe
END:VEVENT
END:VCALENDAR`;

// A feed with N distinct valid bookings — used to prove a systematic write outage
// alerts ONCE, not once-per-row. Guest names are distinctive ("Guest 0"…) so the
// test can assert none of them leak into the single aggregate alert.
function bigIcs(n: number): string {
  const events = Array.from(
    { length: n },
    (_, i) =>
      `BEGIN:VEVENT\nUID:bulk-${i}@airbnb.com\nDTSTART;VALUE=DATE:${E1_START}\nDTEND;VALUE=DATE:${E1_END}\nSUMMARY:Guest ${i}\nEND:VEVENT`,
  ).join("\n");
  return `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Airbnb//Hosting Calendar//EN\n${events}\nEND:VCALENDAR`;
}

function mockFetch(body: string, ok = true) {
  return ok
    ? vi.mocked(fetchFeedText).mockResolvedValue(body)
    : vi.mocked(fetchFeedText).mockRejectedValue(new Error("HTTP 500"));
}

describe("syncCalendarSource", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    __reconcileHooks.forceError = null;
  });

  it("(Codex 07-23 #6) reconcile ÇÖKSE bile import BOZULMAZ; kaynak-başına TEK aggregate alarm + operatör-görünür ⚠ uyarısı", async () => {
    // Eski kod `catch {}` ile tamamen sessizdi: flag açıkken reconcile sürekli
    // patlarsa feed iptalleri uygulanmıyor ve operatör bunu GÖREMİYORDU.
    vi.stubEnv("ICAL_DISAPPEARANCE_RECONCILE_ENABLED", "1");
    const { propertyId } = await makeOrgWithProperty();
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics" },
    });
    mockFetch(ICS);
    __reconcileHooks.forceError = new Error("simulated reconcile crash");

    const result = await syncCalendarSource(source.id);

    // Import SAĞLAM: rezervasyonlar geldi, koşu başarısız sayılmadı.
    expect(result.imported).toBe(2);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(2);
    // Operatör-görünür uyarı kaynağın lastResult'unda (panel bunu gösterir) ve
    // koşu "error" SAYILMAZ (import başarılı — yalnız reconcile adımı düştü).
    const src = await prisma.calendarSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(src.lastResult).toContain("⚠");
    expect(src.lastResult).toContain("uzlaştırma hatası");
    expect(src.lastStatus).toBe("ok");
    // Kaynak-başına context'li TEK alarm (reportError'ın context-throttle'ı
    // crash-loop'u kaynak başına aggregate'e katlar).
    expect(reportErrorMock).toHaveBeenCalledWith(`ical.reconcile:${source.id}`, expect.any(Error));
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

    // The feed still carries the real name, with a shifted (+1 day) departure date.
    const shiftedEnd = icsDate(10);
    const shifted = ICS.replace(`DTEND;VALUE=DATE:${E1_END}`, `DTEND;VALUE=DATE:${shiftedEnd}`);
    mockFetch(shifted);
    const second = await syncCalendarSource(source.id);

    expect(second.updated).toBe(2);
    const anon = await prisma.reservation.findFirst({
      where: { propertyId, sourceReference: "abc-123@airbnb.com" },
    });
    // Name stays anonymized — the feed cannot write PII back.
    expect(anon?.guestName).toBe(ANON_NAME);
    // Non-PII dates still refresh so occupancy stays correct.
    expect(anon?.departureDate.toISOString().slice(0, 10)).toBe(
      `${shiftedEnd.slice(0, 4)}-${shiftedEnd.slice(4, 6)}-${shiftedEnd.slice(6, 8)}`,
    );

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
DTSTART;VALUE=DATE:${E1_START}
DTEND;VALUE=DATE:${E1_END}
SUMMARY:Ahmet Yılmaz
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
UID:def-456@airbnb.com
DTSTART;VALUE=DATE:${E2_START}
DTEND;VALUE=DATE:${E2_END}
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

  it("disappearance reconciliation is OFF: a silently-missing future row stays confirmed (partial-feed safety)", async () => {
    const two = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:fut-1@airbnb.com
DTSTART;VALUE=DATE:${icsDate(200)}
DTEND;VALUE=DATE:${icsDate(204)}
SUMMARY:Guest One
END:VEVENT
BEGIN:VEVENT
UID:fut-2@airbnb.com
DTSTART;VALUE=DATE:${icsDate(210)}
DTEND;VALUE=DATE:${icsDate(212)}
SUMMARY:Guest Two
END:VEVENT
END:VCALENDAR`;
    const onlyFirst = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:fut-1@airbnb.com
DTSTART;VALUE=DATE:${icsDate(200)}
DTEND;VALUE=DATE:${icsDate(204)}
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
    ).toBe("confirmed");
  });

  it("does NOT mass-cancel when the feed comes back empty (guard)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics" },
    });
    mockFetch(ICS);
    await syncCalendarSource(source.id);
    vi.restoreAllMocks();

    const before = await prisma.reservation.count({ where: { propertyId, status: "confirmed" } });
    // A transiently empty (but valid) feed must not cancel anything.
    mockFetch(`BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR`);
    await syncCalendarSource(source.id);
    expect(await prisma.reservation.count({ where: { propertyId, status: "confirmed" } })).toBe(before);
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

describe("codex round-3 residuals", () => {
  afterEach(() => vi.restoreAllMocks());
  const day = (d: number) => new Date(Date.now() + d * 86_400_000);
  const ymd = (d: number) => day(d).toISOString().slice(0, 10).replace(/-/g, "");
  const ev = (uid: string, extra = "") =>
    `BEGIN:VEVENT\nUID:${uid}\n${extra}DTSTART;VALUE=DATE:${ymd(10)}\nDTEND;VALUE=DATE:${ymd(12)}\nSUMMARY:R\nEND:VEVENT`;
  const cal = (...evs: string[]) => `BEGIN:VCALENDAR\n${evs.join("\n")}\nEND:VCALENDAR`;

  it("SAME UID in two feeds: source-2 neither updates nor cancels source-1's row (incl. STATUS:CANCELLED)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const s1 = await prisma.calendarSource.create({ data: { propertyId, label: "Airbnb", url: "https://e.com/1.ics" } });
    const s2 = await prisma.calendarSource.create({ data: { propertyId, label: "Airbnb", url: "https://e.com/2.ics" } });
    mockFetch(cal(ev("shared-uid")));
    await syncCalendarSource(s1.id);
    vi.restoreAllMocks();
    // Source-2 serves the SAME UID but CANCELLED → must create/affect NOTHING of s1's.
    mockFetch(cal(ev("shared-uid", "STATUS:CANCELLED\n")));
    await syncCalendarSource(s2.id);
    const rows = await prisma.reservation.findMany({ where: { propertyId, sourceReference: "shared-uid" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].calendarSourceId).toBe(s1.id);
    expect(rows[0].status).toBe("confirmed"); // cross-source cancel blocked
  });

  it("PARTIAL non-empty feed does not mass-cancel its own missing rows (disappearance reconciliation off)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const s1 = await prisma.calendarSource.create({ data: { propertyId, label: "Airbnb", url: "https://e.com/3.ics" } });
    mockFetch(cal(ev("u-1"), ev("u-2")));
    await syncCalendarSource(s1.id);
    vi.restoreAllMocks();
    mockFetch(cal(ev("u-1"))); // partial response: u-2 missing but NOT cancelled upstream
    await syncCalendarSource(s1.id);
    const u2 = await prisma.reservation.findFirst({ where: { propertyId, sourceReference: "u-2" } });
    expect(u2?.status).toBe("confirmed");
  });
});

describe("codex round-4: atomic legacy adoption", () => {
  afterEach(() => vi.restoreAllMocks());
  const day = (d: number) => new Date(Date.now() + d * 86_400_000);
  const ymd = (d: number) => day(d).toISOString().slice(0, 10).replace(/-/g, "");
  const ev = (uid: string, extra = "") =>
    `BEGIN:VEVENT\nUID:${uid}\n${extra}DTSTART;VALUE=DATE:${ymd(10)}\nDTEND;VALUE=DATE:${ymd(12)}\nSUMMARY:R\nEND:VEVENT`;
  const cal = (...e: string[]) => `BEGIN:VCALENDAR\n${e.join("\n")}\nEND:VCALENDAR`;

  it("STATUS:CANCELLED NEVER touches a legacy NULL row; a LIVE event still adopts it", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const legacy = await prisma.reservation.create({
      data: { propertyId, guestName: "L", arrivalDate: day(10), departureDate: day(12), status: "confirmed", channel: "airbnb", sourceReference: "leg-1", calendarSourceId: null },
    });
    const s1 = await prisma.calendarSource.create({ data: { propertyId, label: "Airbnb", url: "https://e.com/l.ics" } });
    mockFetch(cal(ev("leg-1", "STATUS:CANCELLED\n")));
    await syncCalendarSource(s1.id);
    let after = await prisma.reservation.findUnique({ where: { id: legacy.id } });
    expect(after?.status).toBe("confirmed"); // an unowned row is never cancelled
    expect(after?.calendarSourceId).toBeNull(); // ...nor adopted by a CANCELLED event
    vi.restoreAllMocks();
    // A LIVE event for the same UID performs the one-time adoption as before.
    mockFetch(cal(ev("leg-1")));
    await syncCalendarSource(s1.id);
    after = await prisma.reservation.findUnique({ where: { id: legacy.id } });
    expect(after?.calendarSourceId).toBe(s1.id);
  });

  it("a row ALREADY bound to another source is never updated even when the read raced (atomic ownership)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const s1 = await prisma.calendarSource.create({ data: { propertyId, label: "Airbnb", url: "https://e.com/x1.ics" } });
    const s2 = await prisma.calendarSource.create({ data: { propertyId, label: "Airbnb", url: "https://e.com/x2.ics" } });
    await prisma.reservation.create({
      data: { propertyId, guestName: "B", arrivalDate: day(10), departureDate: day(12), status: "confirmed", channel: "airbnb", sourceReference: "race-1", calendarSourceId: s2.id },
    });
    mockFetch(cal(ev("race-1", "STATUS:CANCELLED\n")));
    await syncCalendarSource(s1.id); // s1 must not touch s2's row (lookup + atomic WHERE)
    const row = await prisma.reservation.findFirst({ where: { propertyId, sourceReference: "race-1" } });
    expect(row?.status).toBe("confirmed");
    expect(row?.calendarSourceId).toBe(s2.id);
  });

  it("KVKK m40: an explicitly-erased UID re-appearing in the feed is skipped (tombstone guard)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics" },
    });
    // Tombstone the FIRST event's UID (as the erasure executor would); the feed
    // still carries both events — exactly the re-delivery the guard must stop.
    const { tombstoneKeyHash, currentKeyFingerprint } = await import("@/lib/erasure");
    await prisma.erasureTombstone.create({
      data: {
        organizationId: orgId,
        keyType: "source_reference",
        keyHash: tombstoneKeyHash(orgId, "source_reference", "abc-123@airbnb.com")!,
        keyFingerprint: currentKeyFingerprint(), // else the guard fails closed (BLOCK_ALL)
        erasedAt: new Date(),
      },
    });
    mockFetch(ICS); // two bookings: abc-123 (Ahmet) + def-456 (Jane)

    const result = await syncCalendarSource(source.id);

    expect(result.imported).toBe(1); // only Jane
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(await prisma.reservation.count({ where: { sourceReference: "abc-123@airbnb.com" } })).toBe(0);
    const jane = await prisma.reservation.findFirst({ where: { sourceReference: "def-456@airbnb.com" } });
    expect(jane?.guestName).toBe("Jane Doe"); // untombstoned rows import untouched
  });

  it("KVKK m40 STRUCTURAL TOCTOU: erasure (+ row deletion) lands WHILE the feed is being fetched → the in-lock row-TX guard still blocks the re-create", async () => {
    // Codex's exact timing for the iCal path: the sync would load any run-start
    // state BEFORE the fetch; the erasure commits DURING the fetch and the local
    // rows are then gone entirely (no ANON sentinel left to protect them). Only
    // the FRESH in-lock guard read inside the row write-transaction can refuse
    // the re-create — without it (pre-fix) "Ahmet Yılmaz" comes back verbatim.
    const { orgId, propertyId } = await makeOrgWithProperty();
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics" },
    });
    const reservation = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Ahmet Yılmaz",
        sourceReference: "abc-123@airbnb.com",
        calendarSourceId: source.id,
        arrivalDate: new Date(Date.now() + 5 * DAY),
        departureDate: new Date(Date.now() + 9 * DAY),
        status: "confirmed",
        channel: "airbnb",
      },
    });
    const { eraseReservationData } = await import("@/lib/erasure");
    vi.mocked(fetchFeedText).mockImplementation(async () => {
      await eraseReservationData(orgId, reservation.id); // tombstone + mask, mid-fetch
      await prisma.reservation.delete({ where: { id: reservation.id } }); // sentinel gone too
      return ICS; // the feed still carries abc-123 with the real name
    });

    const result = await syncCalendarSource(source.id);

    expect(await prisma.reservation.count({ where: { propertyId, sourceReference: "abc-123@airbnb.com" } })).toBe(0);
    expect(await prisma.reservation.count({ where: { propertyId, guestName: "Ahmet Yılmaz" } })).toBe(0);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    // The untombstoned second event still imports normally (property-scoped
    // count — the paddle-webhook lesson: never assert on a WHERE-less count).
    expect(await prisma.reservation.count({ where: { propertyId, sourceReference: "def-456@airbnb.com" } })).toBe(1);
  });

  it("#4: a mid-import row failure is REPORTED and surfaces as 'error' — not a silent 'ok'", async () => {
    reportErrorMock.mockClear();
    const { propertyId } = await makeOrgWithProperty();
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics" },
    });
    mockFetch(ICS); // two bookings (Ahmet, Jane)

    // Fail the SECOND row's write with a systematic error (NOT a dedupe-hit, which is
    // handled separately). The first row still lands → this is a PARTIAL import.
    // Injection point = the row WRITE-TRANSACTION: since m40's locked row-TX, row
    // writes go through tx.* clients, which a spy on the global delegate can't
    // reach — failing the 2nd $transaction call IS the 2nd row's write failing.
    const realTx = prisma.$transaction.bind(prisma);
    let n = 0;
    vi.spyOn(prisma, "$transaction").mockImplementation(((arg: unknown, opts?: unknown) => {
      n += 1;
      if (n === 2) return Promise.reject(new Error("db blip"));
      return (realTx as (a: unknown, o?: unknown) => Promise<unknown>)(arg, opts);
    }) as never);

    const result = await syncCalendarSource(source.id);

    expect(result.imported).toBe(1); // the first row landed
    expect(result.errors.length).toBe(1); // the second row failed
    expect(reportErrorMock).toHaveBeenCalledTimes(1); // logged (not swallowed), and exactly once per run
    const src = await prisma.calendarSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(src.lastStatus).toBe("error"); // a partial import must NOT report "ok"
  });

  it("#4: a WHOLE-import outage alerts EXACTLY once (no per-row event flood), lastStatus=error", async () => {
    reportErrorMock.mockClear();
    const { propertyId } = await makeOrgWithProperty();
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics" },
    });
    // 100 valid bookings; EVERY write fails (simulates a DB outage / schema drift).
    // Injected at the row write-transaction (see the mid-import test note).
    mockFetch(bigIcs(100));
    vi.spyOn(prisma, "$transaction").mockRejectedValue(new Error("db outage"));

    const result = await syncCalendarSource(source.id);

    expect(result.imported).toBe(0);
    expect(result.errors.length).toBe(100); // all 100 rows failed
    // THE INVARIANT: ONE aggregate alert for the whole run, NOT 100. A per-row
    // reportError would emit 100 Sentry events + 100 log lines on a single outage.
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    const src = await prisma.calendarSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(src.lastStatus).toBe("error");
    // The single alert carries an AGGREGATE COUNT and NO row/guest data.
    const [ctx, reportedErr] = reportErrorMock.mock.calls[0];
    expect(ctx).toBe("import.sync");
    const msg = (reportedErr as Error).message;
    expect(msg).toContain("100 satır"); // aggregate count present
    expect(msg).not.toContain("Guest"); // no guest name / row data leaked in
  });
});
