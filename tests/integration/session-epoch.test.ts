import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// requireSession() (lib/api.ts) enforces the session epoch: after verifying the
// JWT it compares the token's sessionEpoch to the user's current DB value, so a
// password change/reset (which bumps the DB value) kills stolen tokens on their
// next request. We mock getSession to hand requireSession a controlled token,
// and use a REAL user row so the DB comparison is exercised end-to-end.
let mockSession: SessionPayload | null;
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn(async () => mockSession) };
});

import { requireSession } from "@/lib/api";

async function makeUser(sessionEpoch: number) {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  return prisma.user.create({
    data: {
      organizationId: org.id,
      name: "U",
      email: `u${sessionEpoch}-${Math.abs(sessionEpoch)}@x.com`,
      passwordHash: "x",
      role: "owner",
      sessionEpoch,
    },
  });
}

function tokenFor(user: { id: string; organizationId: string }, epoch: number): SessionPayload {
  return {
    userId: user.id,
    organizationId: user.organizationId,
    role: "owner",
    email: "u@x.com",
    name: "U",
    sessionEpoch: epoch,
  };
}

describe("requireSession — session-epoch enforcement", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("returns the session when the token epoch matches the user's current value", async () => {
    const user = await makeUser(3);
    mockSession = tokenFor(user, 3);
    expect(await requireSession()).not.toBeNull();
  });

  it("returns null when the token epoch is stale (password was reset → DB epoch bumped)", async () => {
    const user = await makeUser(4); // DB already bumped to 4
    mockSession = tokenFor(user, 3); // stolen token still carries 3
    expect(await requireSession()).toBeNull();
  });

  it("returns null when the user no longer exists", async () => {
    mockSession = {
      userId: "gone",
      organizationId: "o",
      role: "owner",
      email: "x@x.com",
      name: "X",
      sessionEpoch: 0,
    };
    expect(await requireSession()).toBeNull();
  });

  it("returns null when there is no session cookie", async () => {
    mockSession = null;
    expect(await requireSession()).toBeNull();
  });

  it("legacy token (epoch 0) still works for an untouched user (default 0) — no mass logout on deploy", async () => {
    const user = await makeUser(0);
    mockSession = tokenFor(user, 0);
    expect(await requireSession()).not.toBeNull();
  });
});
