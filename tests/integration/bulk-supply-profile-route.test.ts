import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/properties/bulk-supply-profile/route";

const ctx = { params: Promise.resolve({} as Record<string, never>) };
function call(body: unknown) {
  const req = new NextRequest("http://localhost/api/properties/bulk-supply-profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req, ctx);
}
const owner = (orgId: string): SessionPayload => ({
  userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0,
});

describe("POST /api/properties/bulk-supply-profile", () => {
  let orgId: string;
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    await prisma.property.create({ data: { organizationId: orgId, name: "nuve 1" } });
    await prisma.property.create({ data: { organizationId: orgId, name: "nuve 2" } });
  });

  it("applies one profile to ALL of the org's properties when no ids given", async () => {
    session = owner(orgId);
    const res = await call({ supplyProfile: { carsaf_takimi: 2, cop_poseti: 1, bilinmeyen: 9 } });
    expect(res.status).toBe(200);
    const props = await prisma.property.findMany({ where: { organizationId: orgId } });
    expect(props).toHaveLength(2);
    for (const p of props) {
      expect(JSON.parse(p.supplyProfileJson!)).toEqual({ carsaf_takimi: 2, cop_poseti: 1 }); // unknown key stripped
    }
  });

  it("applies ONLY to the selected propertyIds when given", async () => {
    session = owner(orgId);
    const props = await prisma.property.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } });
    const target = props[0];
    const res = await call({ supplyProfile: { carsaf_takimi: 3 }, propertyIds: [target.id] });
    expect(res.status).toBe(200);
    const after = await prisma.property.findMany({ where: { organizationId: orgId } });
    for (const p of after) {
      if (p.id === target.id) expect(JSON.parse(p.supplyProfileJson!)).toEqual({ carsaf_takimi: 3 });
      else expect(p.supplyProfileJson).toBeNull(); // unselected untouched
    }
  });

  it("updates nothing for an empty propertyIds array", async () => {
    session = owner(orgId);
    const res = await call({ supplyProfile: { carsaf_takimi: 3 }, propertyIds: [] });
    expect(res.status).toBe(200);
    const after = await prisma.property.findMany({ where: { organizationId: orgId } });
    expect(after.every((p) => p.supplyProfileJson === null)).toBe(true);
  });

  it("ignores a foreign propertyId (no cross-org write)", async () => {
    const other = await prisma.organization.create({ data: { name: "Other" } });
    const foreign = await prisma.property.create({ data: { organizationId: other.id, name: "yabancı" } });
    session = owner(orgId);
    await call({ supplyProfile: { carsaf_takimi: 3 }, propertyIds: [foreign.id] });
    const untouched = await prisma.property.findUnique({ where: { id: foreign.id } });
    expect(untouched?.supplyProfileJson).toBeNull();
  });

  it("forbids staff (403), nothing changes", async () => {
    session = { ...owner(orgId), role: "staff" };
    const res = await call({ supplyProfile: { carsaf_takimi: 2 } });
    expect(res.status).toBe(403);
    const props = await prisma.property.findMany({ where: { organizationId: orgId } });
    expect(props.every((p) => p.supplyProfileJson === null)).toBe(true);
  });

  it("never touches another org's properties (no IDOR, no ids)", async () => {
    const other = await prisma.organization.create({ data: { name: "Other" } });
    const otherProp = await prisma.property.create({ data: { organizationId: other.id, name: "başka daire" } });
    session = owner(orgId);
    await call({ supplyProfile: { carsaf_takimi: 2 } });
    const untouched = await prisma.property.findUnique({ where: { id: otherProp.id } });
    expect(untouched?.supplyProfileJson).toBeNull();
  });

  it("rejects a missing/invalid profile body", async () => {
    session = owner(orgId);
    expect((await call({})).status).toBe(400);
    expect((await call({ supplyProfile: "nope" })).status).toBe(400);
  });
});
