import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// Codex #22 — two hardenings of the host-supplied iCal feed pipeline:
//  1. The fetch used to `await res.text()` and length-check AFTER: a chunked
//     response with no/lying Content-Length buffered its whole body into
//     memory first. Now the byte cap is enforced WHILE streaming.
//  2. New calendar sources must be https — feed URLs embed bearer-like
//     secrets, so plaintext http leaks them in transit. (Legacy http rows
//     keep syncing; the rule applies at creation.)

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { syncCalendarSource } from "@/lib/import/sync";
import { POST as createSource } from "@/app/api/properties/[id]/calendar-sources/route";

describe("iCal feed hardening", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("STREAMING CAP: an endless chunked body is aborted at the cap, not buffered whole", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics" },
    });

    // A hostile/broken feed streaming 1 MB chunks forever, no Content-Length.
    const chunk = new Uint8Array(1024 * 1024).fill(65); // "A"
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        if (pulls > 50) controller.close(); // safety net so a failing impl can't hang the test
        else controller.enqueue(chunk);
      },
    });
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(endless, { status: 200 }));

    const result = await syncCalendarSource(source.id);

    expect(result.errors.length).toBeGreaterThan(0); // feed rejected
    expect(result.imported).toBe(0);
    // The cap (10 MB) fired mid-stream: ~11 pulls, NOT the full 50.
    expect(pulls).toBeLessThanOrEqual(13);
    const row = await prisma.calendarSource.findUnique({ where: { id: source.id } });
    expect(row?.lastStatus).toBe("error");
  });

  it("normal feeds still parse through the streamed reader (real Response body)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics" },
    });
    const ICS = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:ok-1@airbnb.com\nDTSTART;VALUE=DATE:20260710\nDTEND;VALUE=DATE:20260714\nSUMMARY:Ahmet Yılmaz\nEND:VEVENT\nEND:VCALENDAR`;
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(ICS, { status: 200 }));

    const result = await syncCalendarSource(source.id);
    expect(result.errors).toEqual([]);
    expect(result.imported).toBe(1);
  });

  it("CREATE requires https: http URL is rejected, nothing stored", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };

    const res = await createSource(
      new NextRequest(`http://localhost/api/properties/${propertyId}/calendar-sources`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "Airbnb", url: "http://example.com/cal.ics" }),
      }),
      { params: Promise.resolve({ id: propertyId }) },
    );
    expect(res.status).toBe(400);
    expect(await prisma.calendarSource.count({ where: { propertyId } })).toBe(0);
  });

  it("CREATE accepts a valid https URL", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };

    const res = await createSource(
      new NextRequest(`http://localhost/api/properties/${propertyId}/calendar-sources`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "Airbnb", url: "https://example.com/cal.ics" }),
      }),
      { params: Promise.resolve({ id: propertyId }) },
    );
    expect(res.status).toBe(201);
    expect(await prisma.calendarSource.count({ where: { propertyId } })).toBe(1);
  });
});
