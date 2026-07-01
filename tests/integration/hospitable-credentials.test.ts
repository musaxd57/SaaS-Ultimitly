import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import {
  getOrgHospitableToken,
  isPrimaryOrg,
  setOrgHospitableToken,
  clearOrgHospitableToken,
  getConnectionInfo,
  resetPrimaryOrgCache,
} from "@/lib/hospitable-credentials";

// Core multi-tenant isolation invariant: each org uses ITS OWN Hospitable token;
// only the founder's ("primary", oldest) org may fall back to the global env
// token. A customer org must NEVER receive the shared token.
describe("hospitable-credentials (multi-tenant isolation)", () => {
  beforeEach(async () => {
    await resetDb();
    resetPrimaryOrgCache();
    vi.unstubAllEnvs();
  });

  async function makeOrg(name: string) {
    return prisma.organization.create({ data: { name } });
  }

  it("primary = oldest org; only it falls back to the env token", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "FOUNDER_ENV_TOKEN");
    const founder = await makeOrg("Founder"); // created first → oldest → primary
    // ensure a distinct, later createdAt for the customer org
    await new Promise((r) => setTimeout(r, 5));
    const customer = await makeOrg("Customer");

    expect(await isPrimaryOrg(founder.id)).toBe(true);
    expect(await isPrimaryOrg(customer.id)).toBe(false);

    // Founder (primary) gets the env token; customer gets NOTHING (isolation).
    expect(await getOrgHospitableToken(founder.id)).toBe("FOUNDER_ENV_TOKEN");
    expect(await getOrgHospitableToken(customer.id)).toBeNull();
  });

  it("a connected org uses its OWN token, never the env token", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "FOUNDER_ENV_TOKEN");
    const founder = await makeOrg("Founder");
    await new Promise((r) => setTimeout(r, 5));
    const customer = await makeOrg("Customer");

    await setOrgHospitableToken(customer.id, "CUSTOMER_OWN_TOKEN", "3 mülk");
    expect(await getOrgHospitableToken(customer.id)).toBe("CUSTOMER_OWN_TOKEN");

    // Even the primary org prefers its own stored token over the env fallback.
    await setOrgHospitableToken(founder.id, "FOUNDER_OWN_TOKEN", "8 mülk");
    expect(await getOrgHospitableToken(founder.id)).toBe("FOUNDER_OWN_TOKEN");
  });

  it("disconnect drops the stored token (back to null for a customer org)", async () => {
    await makeOrg("Founder");
    await new Promise((r) => setTimeout(r, 5));
    const customer = await makeOrg("Customer");
    await setOrgHospitableToken(customer.id, "CUSTOMER_OWN_TOKEN", null);
    await clearOrgHospitableToken(customer.id);
    expect(await getOrgHospitableToken(customer.id)).toBeNull();
  });

  it("getConnectionInfo reports a customer org with no token as disconnected", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "FOUNDER_ENV_TOKEN");
    await makeOrg("Founder");
    await new Promise((r) => setTimeout(r, 5));
    const customer = await makeOrg("Customer");

    const info = await getConnectionInfo(customer.id);
    expect(info.connected).toBe(false);
    expect(info.ownToken).toBe(false);
    expect(info.envAvailable).toBe(false); // env fallback is primary-only
  });

  it("getConnectionInfo treats an undecryptable stored token as disconnected", async () => {
    const customer = await makeOrg("Customer");
    // Simulate a corrupt/rotated-key value directly in the DB.
    await prisma.organization.update({
      where: { id: customer.id },
      data: { hospitableTokenEnc: "v1.not.real.ciphertext" },
    });
    const info = await getConnectionInfo(customer.id);
    expect(info.ownToken).toBe(false);
    expect(await getOrgHospitableToken(customer.id)).toBeNull();
  });
});
