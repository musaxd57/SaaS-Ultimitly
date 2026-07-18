import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { ANON_NAME } from "@/lib/data-retention";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { GET, POST } from "@/app/api/reservations/[id]/erase/route";

const ENV = "GUEST_ERASURE_ENABLED";
let origEnv: string | undefined;

function req(id: string, method: "GET" | "POST") {
  return new NextRequest(`http://localhost/api/reservations/${id}/erase`, { method });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function seed(role: SessionPayload["role"] = "owner") {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const user = await prisma.user.create({
    data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role },
  });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Ada Lovelace",
      guestEmail: "ada@example.com",
      sourceReference: "res-rt-1",
      arrivalDate: new Date("2026-06-01"),
      departureDate: new Date("2026-06-04"),
      status: "completed",
      channel: "airbnb",
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId,
      reservationId: reservation.id,
      channel: "airbnb",
      guestIdentifier: "Ada Lovelace",
      status: "answered",
      priority: "standard",
      lastMessageAt: new Date("2026-06-03"),
    },
  });
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "inbound",
      senderName: "Ada Lovelace",
      body: "Merhaba, ben Ada",
      externalId: "rt-m1",
    },
  });
  session = { userId: user.id, organizationId: orgId, role, email: "o@x.com", name: "O", sessionEpoch: 0 };
  return { orgId, reservationId: reservation.id };
}

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  origEnv = process.env[ENV];
  process.env[ENV] = "1";
});
afterEach(() => {
  if (origEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = origEnv;
});

describe("/api/reservations/[id]/erase — KVKK guest erasure surface", () => {
  it("is INVISIBLE (404) while the flag is off — request surface dormant by default", async () => {
    const { reservationId } = await seed("owner");
    delete process.env[ENV];
    expect((await GET(req(reservationId, "GET"), ctx(reservationId))).status).toBe(404);
    expect((await POST(req(reservationId, "POST"), ctx(reservationId))).status).toBe(404);
    // Nothing was touched.
    const res = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    expect(res.guestName).toBe("Ada Lovelace");
  });

  it("GET previews the scope without writing", async () => {
    const { reservationId } = await seed("owner");
    const res = await GET(req(reservationId, "GET"), ctx(reservationId));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.scope).toMatchObject({ conversations: 1, inboundMessages: 1 });
    expect(await prisma.erasureTombstone.count()).toBe(0); // preview = read-only
  });

  it("POST executes: scrub + tombstones + audit with counts ONLY (no guest identifiers)", async () => {
    const { reservationId } = await seed("owner");
    const res = await POST(req(reservationId, "POST"), ctx(reservationId));
    expect(res.status).toBe(200);

    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    expect(row.guestName).toBe(ANON_NAME);
    expect(await prisma.erasureTombstone.count()).toBeGreaterThan(0);

    const audits = await prisma.auditLog.findMany({ where: { action: "kvkk.guest_erasure" } });
    expect(audits).toHaveLength(1);
    const meta = audits[0].metadataJson ?? "";
    expect(meta).toContain(reservationId); // opaque row id — fine
    expect(meta).not.toContain("Ada"); // never the guest's name…
    expect(meta).not.toContain("example.com"); // …or contact details
  });

  it("STAFF cannot erase (withManage 403) and nothing changes", async () => {
    const { reservationId } = await seed("staff");
    const res = await POST(req(reservationId, "POST"), ctx(reservationId));
    expect(res.status).toBe(403);
    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    expect(row.guestName).toBe("Ada Lovelace");
  });

  it("cross-org id fails closed with a generic 404 (IDOR)", async () => {
    const { reservationId } = await seed("owner");
    // Re-point the session at a DIFFERENT org, keep the victim's reservation id.
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    const otherUser = await prisma.user.create({
      data: { organizationId: otherOrg.id, name: "X", email: "x@x.com", passwordHash: "x", role: "owner" },
    });
    session = { userId: otherUser.id, organizationId: otherOrg.id, role: "owner", email: "x@x.com", name: "X", sessionEpoch: 0 };

    expect((await GET(req(reservationId, "GET"), ctx(reservationId))).status).toBe(404);
    expect((await POST(req(reservationId, "POST"), ctx(reservationId))).status).toBe(404);
    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    expect(row.guestName).toBe("Ada Lovelace"); // victim untouched
  });
});
