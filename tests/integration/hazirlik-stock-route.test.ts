import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { PATCH } from "@/app/api/hazirlik/stock/route";

const ctx = { params: Promise.resolve({} as Record<string, never>) };
function call(body: unknown) {
  const req = new NextRequest("http://localhost/api/hazirlik/stock", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return PATCH(req, ctx);
}
const owner = (orgId: string): SessionPayload => ({
  userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0,
});

describe("PATCH /api/hazirlik/stock", () => {
  let orgId: string;
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
  });

  it("saves the org's on-hand stock (unknown keys/zeros stripped)", async () => {
    session = owner(orgId);
    const res = await call({ stock: { cop_poseti: 10, sabun: 0, bilinmeyen: 5 } });
    expect(res.status).toBe(200);
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    expect(JSON.parse(org!.supplyStockJson!)).toEqual({ cop_poseti: 10 });
  });

  it("forbids staff (403)", async () => {
    session = { ...owner(orgId), role: "staff" };
    expect((await call({ stock: { cop_poseti: 10 } })).status).toBe(403);
  });

  it("rejects an invalid body (400)", async () => {
    session = owner(orgId);
    expect((await call({})).status).toBe(400);
    expect((await call({ stock: "nope" })).status).toBe(400);
  });

  it("clears the stock when everything is 0/empty", async () => {
    session = owner(orgId);
    await call({ stock: { cop_poseti: 10 } });
    await call({ stock: { cop_poseti: 0 } });
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    expect(org!.supplyStockJson).toBeNull();
  });
});
