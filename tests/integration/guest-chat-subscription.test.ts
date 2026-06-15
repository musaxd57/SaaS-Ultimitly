import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { resolveGuestChat } from "@/lib/guest-chat";

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

// A customer whose Paddle subscription is canceled/past_due must lose the QR
// concierge automatically; grandfathered (no sub) + active/trialing keep it.
async function makeQrProperty(subStatus?: string): Promise<string> {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  if (subStatus) {
    await prisma.subscription.create({
      data: { organizationId: org.id, planCode: "pro", status: subStatus, provider: "paddle" },
    });
  }
  const token = `tok-${"a".repeat(40)}`;
  await prisma.property.create({
    data: { organizationId: org.id, name: "Daire 1", chatToken: token, chatEnabled: true },
  });
  return token;
}

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
});
