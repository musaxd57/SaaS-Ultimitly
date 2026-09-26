import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { hashPin, verifyReservationPin } from "@/lib/guest-chat-pin";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST, DELETE } from "@/app/api/reservations/[id]/chat-pin/route";

const ENV = "QR_PIN_ENABLED";
let origEnv: string | undefined;

function req(id: string, method: "POST" | "DELETE") {
  return new NextRequest(`http://localhost/api/reservations/${id}/chat-pin`, { method });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function seed(role: SessionPayload["role"] = "owner") {
  const { orgId, propertyId } = await makeOrgWithProperty();
  // Real user so the audit write (FK on actorUserId) actually persists.
  const user = await prisma.user.create({
    data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role },
  });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId, guestName: "Ada", arrivalDate: daysFromNow(-1), departureDate: daysFromNow(2),
      status: "confirmed", channel: "airbnb",
    },
  });
  session = { userId: user.id, organizationId: orgId, role, email: "o@x.com", name: "O", sessionEpoch: 0 };
  return { orgId, propertyId, reservationId: reservation.id };
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

describe("POST /api/reservations/[id]/chat-pin — generate", () => {
  it("owner generates a 6-digit PIN; DB stores the HASH (never plaintext) + no PIN in audit", async () => {
    const { reservationId } = await seed("owner");
    const res = await POST(req(reservationId, "POST"), ctx(reservationId));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.pin).toMatch(/^\d{6}$/);
    expect(json.chatPinSetAt).toBeTruthy();

    const row = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(row?.chatPinHash).toBe(hashPin(reservationId, json.pin));
    expect(row?.chatPinHash).not.toContain(json.pin);
    // The PIN verifies through the public path.
    expect((await verifyReservationPin(reservationId, json.pin)).status).toBe("ok");

    // Audit written WITHOUT the PIN anywhere in it.
    const audits = await prisma.auditLog.findMany({ where: { action: { contains: "guest_chat.pin" } } });
    expect(audits.length).toBeGreaterThan(0);
    for (const a of audits) expect(a.metadataJson ?? "").not.toContain(json.pin);
  });

  it("PIN response carries Cache-Control: no-store (Codex 5) and leaks the PIN nowhere but the body", async () => {
    const { reservationId } = await seed("owner");
    const res = await POST(req(reservationId, "POST"), ctx(reservationId));
    expect(res.headers.get("cache-control")).toBe("no-store");
    const json = await res.json();
    const pin = json.pin as string;
    // The PIN must NOT appear in any audit metadata row.
    const audits = await prisma.auditLog.findMany();
    for (const a of audits) expect(a.metadataJson ?? "").not.toContain(pin);
    // …nor persisted on the reservation row (only its hash lives there).
    const row = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(JSON.stringify(row)).not.toContain(pin);
  });

  it("manager may generate too (owner|manager surface)", async () => {
    const { reservationId } = await seed("manager");
    const res = await POST(req(reservationId, "POST"), ctx(reservationId));
    expect(res.status).toBe(200);
    expect((await res.json()).pin).toMatch(/^\d{6}$/);
  });

  it("STAFF is refused (403) — staff never sees the credential", async () => {
    const { reservationId } = await seed("staff");
    const res = await POST(req(reservationId, "POST"), ctx(reservationId));
    expect(res.status).toBe(403);
    expect((await prisma.reservation.findUnique({ where: { id: reservationId } }))?.chatPinHash).toBeNull();
  });

  it("REGENERATION returns a different PIN and invalidates the old one", async () => {
    const { reservationId } = await seed("owner");
    const first = (await (await POST(req(reservationId, "POST"), ctx(reservationId))).json()).pin;
    const second = (await (await POST(req(reservationId, "POST"), ctx(reservationId))).json()).pin;
    expect(second).not.toBe(first);
    expect((await verifyReservationPin(reservationId, first)).status).toBe("invalid");
    expect((await verifyReservationPin(reservationId, second)).status).toBe("ok");
  });

  it("CROSS-TENANT: another org's session cannot PIN this reservation (404, nothing written)", async () => {
    const { reservationId } = await seed("owner");
    // Switch the session to a DIFFERENT org.
    const other = await prisma.organization.create({ data: { name: "OtherOrg" } });
    session = { userId: "u2", organizationId: other.id, role: "owner", email: "x@y.com", name: "X", sessionEpoch: 0 };
    const res = await POST(req(reservationId, "POST"), ctx(reservationId));
    expect(res.status).toBe(404);
    expect((await prisma.reservation.findUnique({ where: { id: reservationId } }))?.chatPinHash).toBeNull();
  });

  it("feature flag OFF → 404 (route dormant)", async () => {
    const { reservationId } = await seed("owner");
    delete process.env[ENV];
    const res = await POST(req(reservationId, "POST"), ctx(reservationId));
    expect(res.status).toBe(404);
    expect((await prisma.reservation.findUnique({ where: { id: reservationId } }))?.chatPinHash).toBeNull();
  });
});

describe("DELETE /api/reservations/[id]/chat-pin — clear", () => {
  it("owner clears a PIN; the public path then reports no_pin", async () => {
    const { reservationId } = await seed("owner");
    await POST(req(reservationId, "POST"), ctx(reservationId));
    const res = await DELETE(req(reservationId, "DELETE"), ctx(reservationId));
    expect(res.status).toBe(200);
    const row = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(row?.chatPinHash).toBeNull();
    expect((await verifyReservationPin(reservationId, "000000")).status).toBe("no_pin");
  });

  it("cross-tenant DELETE is refused (404)", async () => {
    const { reservationId } = await seed("owner");
    await POST(req(reservationId, "POST"), ctx(reservationId));
    const other = await prisma.organization.create({ data: { name: "OtherOrg" } });
    session = { userId: "u2", organizationId: other.id, role: "owner", email: "x@y.com", name: "X", sessionEpoch: 0 };
    const res = await DELETE(req(reservationId, "DELETE"), ctx(reservationId));
    expect(res.status).toBe(404);
    expect((await prisma.reservation.findUnique({ where: { id: reservationId } }))?.chatPinHash).not.toBeNull();
  });
});
