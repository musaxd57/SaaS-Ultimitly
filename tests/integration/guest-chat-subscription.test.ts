import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { resolveGuestChat } from "@/lib/guest-chat";

beforeEach(resetDb);
afterEach(() => {
  delete process.env.BILLING_ENFORCED;
});
afterAll(async () => {
  await prisma.$disconnect();
});

// A customer whose Paddle subscription is canceled/past_due must lose the QR
// concierge automatically; grandfathered (no sub) + active/trialing keep it.
async function makeQrProperty(subStatus?: string, trialEndsAt?: Date): Promise<string> {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  if (subStatus) {
    await prisma.subscription.create({
      data: {
        organizationId: org.id,
        planCode: "pro",
        status: subStatus,
        provider: "paddle",
        trialEndsAt: trialEndsAt ?? null,
      },
    });
  }
  const token = `tok-${"a".repeat(40)}`;
  await prisma.property.create({
    data: { organizationId: org.id, name: "Daire 1", chatToken: token, chatEnabled: true },
  });
  return token;
}

const daysFromNow = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

describe("QR concierge ↔ subscription gate", () => {
  it("WORKS for a grandfathered org (no subscription)", async () => {
    expect(await resolveGuestChat(await makeQrProperty())).not.toBeNull();
  });

  it("WORKS for an active subscription", async () => {
    expect(await resolveGuestChat(await makeQrProperty("active"))).not.toBeNull();
  });

  it("WORKS for a trialing subscription", async () => {
    expect(await resolveGuestChat(await makeQrProperty("trialing"))).not.toBeNull();
  });

  it("STOPS (404) when the subscription is CANCELED", async () => {
    expect(await resolveGuestChat(await makeQrProperty("canceled"))).toBeNull();
  });

  it("STOPS when the subscription is PAST_DUE", async () => {
    expect(await resolveGuestChat(await makeQrProperty("past_due"))).toBeNull();
  });

  it("KEEPS working for an EXPIRED trial while billing is DORMANT", async () => {
    const token = await makeQrProperty("trialing", daysFromNow(-1));
    expect(await resolveGuestChat(token)).not.toBeNull();
  });

  it("STOPS for an EXPIRED trial once billing is ENFORCED", async () => {
    const token = await makeQrProperty("trialing", daysFromNow(-1));
    process.env.BILLING_ENFORCED = "true";
    expect(await resolveGuestChat(token)).toBeNull();
  });
});
