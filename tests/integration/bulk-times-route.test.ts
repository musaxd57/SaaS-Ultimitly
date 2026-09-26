import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/properties/bulk-times/route";

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/properties/bulk-times", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const ctx = { params: Promise.resolve({} as Record<string, never>) };

describe("POST /api/properties/bulk-times", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("zero-pads H:MM before storing — an un-padded '9:30' can never reach the DB", async () => {
    // Red-first for the type="time" regression: the settings input renders an
    // un-padded value as EMPTY (and dirty=false blocks re-saving), and the
    // property-form validator requires \d{2}:\d{2} — so storage must normalize.
    const res = await POST(req({ checkInTime: "9:30", checkOutTime: "8:05" }), ctx);
    expect(res.status).toBe(200);
    const p = await prisma.property.findUnique({ where: { id: propertyId } });
    expect(p?.checkInTime).toBe("09:30");
    expect(p?.checkOutTime).toBe("08:05");
  });

  it("already-padded HH:MM is stored unchanged and applied to every org property", async () => {
    const p2 = await prisma.property.create({
      data: { organizationId: orgId, name: "İkinci Daire" },
    });
    const res = await POST(req({ checkInTime: "14:00", checkOutTime: "11:00" }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(2);
    for (const id of [propertyId, p2.id]) {
      const p = await prisma.property.findUnique({ where: { id } });
      expect(p?.checkInTime).toBe("14:00");
      expect(p?.checkOutTime).toBe("11:00");
    }
  });

  it("rejects an empty/invalid time with the exact field keys the form maps", async () => {
    const res = await POST(req({ checkInTime: "", checkOutTime: "25:99" }), ctx);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.fields.checkInTime).toBeTruthy();
    expect(data.fields.checkOutTime).toBeTruthy();
  });
});
