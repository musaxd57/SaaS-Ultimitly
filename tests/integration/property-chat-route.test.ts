import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/properties/[id]/chat/route";

function req(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/properties/${id}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const owner = (orgId: string): SessionPayload => ({
  userId: "u",
  organizationId: orgId,
  role: "owner",
  email: "o@x.com",
  name: "O",
});

describe("POST /api/properties/[id]/chat — enable guest QR concierge", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    const p = await prisma.property.create({ data: { organizationId: orgId, name: "Daire 1" } });
    propertyId = p.id;
  });

  it("FORBIDS staff (403) — owner/manager only, nothing changes", async () => {
    session = { userId: "u", organizationId: orgId, role: "staff", email: "s@x.com", name: "S" };
    const res = await POST(req(propertyId, { enabled: true }), { params: Promise.resolve({ id: propertyId }) });
    expect(res.status).toBe(403);
    const after = await prisma.property.findUnique({ where: { id: propertyId } });
    expect(after?.chatEnabled).toBe(false);
    expect(after?.chatToken).toBeNull();
  });

  it("enables for an owner and mints an unguessable token", async () => {
    session = owner(orgId);
    const res = await POST(req(propertyId, { enabled: true }), { params: Promise.resolve({ id: propertyId }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.chatEnabled).toBe(true);
    expect(typeof json.chatToken).toBe("string");
    expect(json.chatToken.length).toBeGreaterThanOrEqual(16);
  });

  it("reuses the same token on disable→re-enable (the printed QR keeps working)", async () => {
    session = owner(orgId);
    const first = await (
      await POST(req(propertyId, { enabled: true }), { params: Promise.resolve({ id: propertyId }) })
    ).json();
    await POST(req(propertyId, { enabled: false }), { params: Promise.resolve({ id: propertyId }) });
    const reenabled = await (
      await POST(req(propertyId, { enabled: true }), { params: Promise.resolve({ id: propertyId }) })
    ).json();
    expect(reenabled.chatToken).toBe(first.chatToken);
  });

  it("REJECTS cross-org access (403) — an owner can't touch another org's apartment", async () => {
    const other = await prisma.organization.create({ data: { name: "Other" } });
    const otherProp = await prisma.property.create({ data: { organizationId: other.id, name: "Yabancı" } });
    session = owner(orgId); // belongs to the FIRST org
    const res = await POST(req(otherProp.id, { enabled: true }), { params: Promise.resolve({ id: otherProp.id }) });
    expect(res.status).toBe(403);
    const after = await prisma.property.findUnique({ where: { id: otherProp.id } });
    expect(after?.chatEnabled).toBe(false);
    expect(after?.chatToken).toBeNull();
  });

  it("validates the body (400 when enabled is not a boolean)", async () => {
    session = owner(orgId);
    const res = await POST(req(propertyId, { enabled: "yes" }), { params: Promise.resolve({ id: propertyId }) });
    expect(res.status).toBe(400);
  });
});
