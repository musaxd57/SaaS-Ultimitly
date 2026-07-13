import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { NextRequest } from "next/server";
import { POST } from "@/app/api/reservations/import/route";

// Codex #25 — the CSV import must FAIL CLOSED on a structurally broken file
// (import nothing, return a clear 400) while still doing a partial import that
// skips only semantically bad rows.

function importReq(propertyId: string, csv: string) {
  const form = new FormData();
  form.set("file", new File([csv], "rez.csv", { type: "text/csv" }));
  form.set("propertyId", propertyId);
  return new NextRequest("http://localhost/api/reservations/import", { method: "POST", body: form });
}

describe("POST /api/reservations/import — CSV fail-closed", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("a structurally broken CSV (column mismatch) → 400, imports NOTHING", async () => {
    const csv = "guest_name,arrival,departure\nAda,2026-07-10,2026-07-14,EXTRA";
    const res = await POST(importReq(propertyId, csv), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(0);
  });

  it("an unbalanced-quote CSV → 400, imports NOTHING", async () => {
    const csv = 'guest_name,arrival,departure\n"Ada,2026-07-10,2026-07-14';
    const res = await POST(importReq(propertyId, csv), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(0);
  });

  it("VALIDATE-THEN-IMPORT: first rows valid but the LAST row is broken → 400, ZERO written", async () => {
    // The whole file is tokenized+validated before any DB write, so a corrupt
    // final row rolls back the entire import (no partial persist).
    const csv =
      "guest_name,arrival,departure\n" +
      "Ada,2026-07-10,2026-07-14\n" + // valid
      "Bora,2026-08-01,2026-08-03\n" + // valid
      "Cem,2026-09-01,2026-09-04,EXTRA"; // structural break on the last line
    const res = await POST(importReq(propertyId, csv), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(0); // nothing written
  });

  it("a well-formed CSV imports rows and skips only the semantically bad one", async () => {
    const csv =
      "guest_name,arrival,departure\n" +
      "Ada,2026-07-10,2026-07-14\n" +
      "Bora,31/02/2026,2026-08-03\n" + // invalid calendar date → skipped
      "Cem,2026-09-01,2026-09-04";
    const res = await POST(importReq(propertyId, csv), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const names = (await prisma.reservation.findMany({ where: { propertyId }, select: { guestName: true } })).map(
      (r) => r.guestName,
    );
    expect(names.sort()).toEqual(["Ada", "Cem"]);
  });
});
