import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// Codex #22 — hardenings of the host-supplied iCal feed pipeline:
//  1. Byte-cap / streaming / DNS-rebind pin now live in fetchFeedText (node:https
//     + validating lookup) and are unit-tested with a real socket in
//     pinned-fetch.test.ts; here we prove the SYNC ENGINE surfaces a feed-layer
//     failure ("feed too large") as an error and parses a good feed.
//  2. New calendar sources must be https — feed URLs embed bearer-like secrets,
//     so plaintext http leaks them in transit. (Legacy http rows keep syncing;
//     the rule applies at creation.)

vi.mock("@/lib/net/pinned-fetch", () => ({ fetchFeedText: vi.fn() }));

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { syncCalendarSource } from "@/lib/import/sync";
import { fetchFeedText } from "@/lib/net/pinned-fetch";
import { POST as createSource } from "@/app/api/properties/[id]/calendar-sources/route";

describe("iCal feed hardening", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a feed-layer failure (byte cap tripped in fetchFeedText) is surfaced as a sync error", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics" },
    });
    // The real streaming abort is proven in pinned-fetch.test.ts; here the feed
    // layer throwing "feed too large" must become a persisted sync error.
    vi.mocked(fetchFeedText).mockRejectedValue(new Error("feed too large"));

    const result = await syncCalendarSource(source.id);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.imported).toBe(0);
    const row = await prisma.calendarSource.findUnique({ where: { id: source.id } });
    expect(row?.lastStatus).toBe("error");
  });

  it("normal feeds parse through the feed layer", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics" },
    });
    const ICS = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:ok-1@airbnb.com\nDTSTART;VALUE=DATE:20260710\nDTEND;VALUE=DATE:20260714\nSUMMARY:Ahmet Yılmaz\nEND:VEVENT\nEND:VCALENDAR`;
    vi.mocked(fetchFeedText).mockResolvedValue(ICS);

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
