import { describe, it, expect, afterEach, vi } from "vitest";
import { isSuperAdmin, isImpersonating, actorEmail } from "@/lib/admin";
import type { SessionPayload } from "@/lib/auth";

const base: SessionPayload = {
  userId: "u1",
  organizationId: "org1",
  role: "owner",
  email: "Operator@Example.com",
  name: "Operator",
};

afterEach(() => vi.unstubAllEnvs());

describe("operator panel authorization", () => {
  it("grants super-admin only to configured emails (case-insensitive)", () => {
    vi.stubEnv("SUPERADMIN_EMAILS", "operator@example.com, boss@x.com");
    expect(isSuperAdmin(base)).toBe(true);
    expect(isSuperAdmin({ ...base, email: "someone@else.com" })).toBe(false);
  });

  it("denies everyone when SUPERADMIN_EMAILS is empty (safe default)", () => {
    vi.stubEnv("SUPERADMIN_EMAILS", "");
    expect(isSuperAdmin(base)).toBe(false);
    expect(isSuperAdmin(null)).toBe(false);
  });

  it("judges super-admin on the REAL operator (actor) while impersonating", () => {
    vi.stubEnv("SUPERADMIN_EMAILS", "operator@example.com");
    // Impersonating: session email is the CUSTOMER, actor is the operator.
    const impersonated: SessionPayload = {
      ...base,
      email: "customer@client.com",
      organizationId: "org2",
      actorUserId: "u1",
      actorEmail: "operator@example.com",
      actorName: "Operator",
    };
    expect(isSuperAdmin(impersonated)).toBe(true); // keeps powers while impersonating
    expect(actorEmail(impersonated)).toBe("operator@example.com");
    expect(isImpersonating(impersonated)).toBe(true);
    expect(isImpersonating(base)).toBe(false);
  });

  it("a non-super-admin customer cannot become super-admin by impersonation fields", () => {
    vi.stubEnv("SUPERADMIN_EMAILS", "operator@example.com");
    // A customer whose actorEmail is NOT in the allowlist stays denied.
    const sneaky: SessionPayload = {
      ...base,
      email: "customer@client.com",
      actorEmail: "customer@client.com",
      actorUserId: "u9",
    };
    expect(isSuperAdmin(sneaky)).toBe(false);
  });
});
