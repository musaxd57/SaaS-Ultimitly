import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// Drive exitImpersonation against a mocked session + cookie layer, real DB.
// NOTE: the factory must not reference top-level spy vars (vi.mock is hoisted) —
// it creates fresh vi.fn()s and we reach them via vi.mocked() after import.
let currentSession: SessionPayload | null = null;
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getSession: vi.fn(async () => currentSession),
    setSessionCookie: vi.fn(async () => {}),
    clearSessionCookie: vi.fn(async () => {}),
  };
});

import { setSessionCookie, clearSessionCookie } from "@/lib/auth";
import { exitImpersonation } from "@/lib/admin";

const mockSet = vi.mocked(setSessionCookie);
const mockClear = vi.mocked(clearSessionCookie);

describe("exitImpersonation fail-safe", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    currentSession = null;
  });

  it("clears the session when the operator's own user record is gone (no stuck impersonation)", async () => {
    const custOrg = await prisma.organization.create({ data: { name: "Customer Org" } });
    // Impersonating, but the actor (operator) id does NOT exist in the DB.
    currentSession = {
      userId: "customer-user",
      organizationId: custOrg.id,
      role: "owner",
      email: "customer@x.com",
      name: "Customer",
      actorUserId: "missing-operator",
      actorEmail: "operator@x.com",
    };

    const result = await exitImpersonation();

    expect(result).toBe(false);
    // Fail-safe: drop to login rather than leave the operator inside the customer org.
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("restores the operator's own session on a normal exit", async () => {
    const custOrg = await prisma.organization.create({ data: { name: "Customer Org" } });
    const opOrg = await prisma.organization.create({ data: { name: "Operator Org" } });
    const operator = await prisma.user.create({
      data: { organizationId: opOrg.id, name: "Op", email: "op@x.com", passwordHash: "x", role: "owner" },
    });
    currentSession = {
      userId: "customer-user",
      organizationId: custOrg.id,
      role: "owner",
      email: "customer@x.com",
      name: "Customer",
      actorUserId: operator.id,
      actorEmail: "op@x.com",
    };

    const result = await exitImpersonation();

    expect(result).toBe(true);
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockClear).not.toHaveBeenCalled();
  });
});
