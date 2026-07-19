import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// PATCH /api/settings numeric-field hardening. The client blocks a cleared box,
// but a DIRECT API call bypasses that — and Number("") === 0, so an empty string
// used to persist a silent 0 (a 0-hour handoff hold resumes the AI immediately
// after a human-handoff request; a 0-hour auto-reply window is a real value too).
// The server must reject empty / non-numeric strings for these integer fields.

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { PATCH } from "@/app/api/settings/route";

const ctx = { params: Promise.resolve({} as Record<string, never>) };
function patch(body: unknown) {
  return PATCH(
    new NextRequest("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx,
  );
}

describe("PATCH /api/settings — numeric field validation", () => {
  let orgId: string;

  beforeEach(async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Org", handoffHoldHours: 6 } });
    orgId = org.id;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects an EMPTY handoffHoldHours (400) — never silently persists 0", async () => {
    const res = await patch({ handoffHoldHours: "" });
    expect(res.status).toBe(400);
    expect((await res.json()).fields?.handoffHoldHours).toContain("0-72");
    // The stored value is untouched (still the seeded 6).
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { handoffHoldHours: true } });
    expect(org?.handoffHoldHours).toBe(6);
  });

  it("rejects an empty/non-numeric auto-reply hour (400)", async () => {
    expect((await patch({ autoReplyStartHour: "" })).status).toBe(400);
    expect((await patch({ autoReplyStartHour: "abc" })).status).toBe(400);
    expect((await patch({ autoReplyEndHour: "  " })).status).toBe(400);
  });

  it("still ACCEPTS an explicit 0 (a deliberate choice, not a blank)", async () => {
    const res = await patch({ handoffHoldHours: 0 });
    expect(res.status).toBe(200);
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { handoffHoldHours: true } });
    expect(org?.handoffHoldHours).toBe(0);
  });

  it("accepts a numeric STRING (the form sends a number, but a string digit is valid too)", async () => {
    const res = await patch({ handoffHoldHours: "12" });
    expect(res.status).toBe(200);
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { handoffHoldHours: true } });
    expect(org?.handoffHoldHours).toBe(12);
  });
});
