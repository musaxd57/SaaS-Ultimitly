import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";

// requireAuth (lib/auth) runs on every page-segment render (soft-nav doesn't
// re-run the layout). It refreshes the DB-authoritative role and enforces the
// epoch. This pins the fail-mode contract: on a DB read error it keeps the
// (signature-valid) session ALIVE — no mass-logout — but clamps the role to the
// least-privileged "staff" so a just-demoted / stolen-elevated token can't render
// owner/manager-gated views during the outage.

// Feed getSession a real signed cookie, and drive the DB read per-test.
let TOKEN = "";
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (TOKEN ? { value: TOKEN } : undefined) }),
}));

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique } } }));

// redirect() normally throws NEXT_REDIRECT; make it a detectable sentinel.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { requireAuth } from "@/lib/auth";
import { signSession } from "@/lib/auth/session";

const base: SessionPayload = {
  userId: "u1",
  organizationId: "o1",
  role: "manager",
  email: "m@x.com",
  name: "M",
  sessionEpoch: 0,
};

describe("requireAuth — fail-open session, fail-closed capability", () => {
  beforeEach(async () => {
    findUnique.mockReset();
    TOKEN = await signSession(base);
  });

  it("clamps role to staff when the DB role read throws (capability fail-closed, session kept)", async () => {
    findUnique.mockRejectedValue(new Error("db down"));
    const s = await requireAuth();
    expect(s.role).toBe("staff"); // no stale "manager" during the blip
    expect(s.organizationId).toBe("o1"); // session stays alive — not logged out
  });

  it("uses the DB-current role when the read succeeds (demoted manager → staff)", async () => {
    findUnique.mockResolvedValue({ sessionEpoch: 0, role: "staff", organizationId: "o1" });
    const s = await requireAuth();
    expect(s.role).toBe("staff");
  });

  it("keeps owner when the DB confirms it and the epoch matches", async () => {
    findUnique.mockResolvedValue({ sessionEpoch: 0, role: "owner", organizationId: "o1" });
    const s = await requireAuth();
    expect(s.role).toBe("owner");
  });

  it("redirects to logout on an epoch mismatch (stolen/reset token, DB reachable)", async () => {
    findUnique.mockResolvedValue({ sessionEpoch: 5, role: "manager", organizationId: "o1" });
    await expect(requireAuth()).rejects.toThrow("REDIRECT:/api/auth/logout");
  });

  it("redirects to logout when the user no longer exists", async () => {
    findUnique.mockResolvedValue(null);
    await expect(requireAuth()).rejects.toThrow("REDIRECT:/api/auth/logout");
  });

  it("redirects to login when there is no session cookie", async () => {
    TOKEN = "";
    await expect(requireAuth()).rejects.toThrow("REDIRECT:/login");
  });
});
