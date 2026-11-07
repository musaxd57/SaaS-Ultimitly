import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// Codex follow-up: the limit-reconciliation delete used `.catch(() => {})` —
// a failed rollback left the org OVER its plan limit while the user was told a
// definitive 403 "limit reached". A failed rollback must surface as a 500 and
// be reported, never swallowed.
// 10-10: the delete-based reconciliation is GONE (count + create now run in ONE transaction under the Organization row
// lock — the old shape overshot under load). The invariant stays: a failure inside the transaction surfaces as a 500 and
// is reported, and the half-done insert is ROLLED BACK (no overflow row, no lying 403).
//
// ISOLATED FILE on purpose: vi.spyOn on Prisma's proxy-backed model delegates
// does not restore reliably (known poisoning issue) — nothing else runs here.

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));
// Force the race shape deterministically: the gate said "allowed, limit 1"
// while the org already holds 1 property — exactly what a concurrent racer
// sees — so the fresh row lands OUTSIDE the limit and reconciliation fires.
vi.mock("@/lib/billing/subscription", async (orig) => {
  const actual = await orig<typeof import("@/lib/billing/subscription")>();
  return { ...actual, canAddProperty: vi.fn(async () => ({ allowed: true, limit: 1, current: 0 })) };
});

import { POST } from "@/app/api/properties/route";
import { reportError } from "@/lib/report-error";

describe("property-limit reconciliation rollback failure", () => {
  let orgId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  function req(name: string) {
    return new NextRequest("http://localhost/api/properties", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }
  const noCtx = { params: Promise.resolve({} as Record<string, never>) };

  it("sanity: rollback WORKS → 403 and the overflow row is gone", async () => {
    await prisma.property.create({ data: { organizationId: orgId, name: "Mevcut" } });
    const res = await POST(req("Taşan"), noCtx);
    expect(res.status).toBe(403);
    expect(await prisma.property.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("failure INSIDE the transaction (after the insert) → 500 + reported, and the insert is ROLLED BACK", async () => {
    // The insert runs, then the transaction fails (connection reset at commit time): nothing may persist.
    const real = prisma.$transaction.bind(prisma) as (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
    vi.spyOn(prisma, "$transaction").mockImplementation(((fn: (tx: unknown) => Promise<unknown>) =>
      real(async (tx) => {
        await fn(tx);
        throw new Error("conn reset");
      })) as never);

    const res = await POST(req("Yeni"), noCtx);

    expect(res.status).toBe(500); // never a definitive 201 / 403 the server cannot stand behind
    expect(vi.mocked(reportError)).toHaveBeenCalled();
    expect(await prisma.property.count({ where: { organizationId: orgId } })).toBe(0);
  });
});
