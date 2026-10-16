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

// A canceled subscription (or a past_due one whose PAID period has ended — kurucu
// 10-16: ek süre yok) loses the QR concierge; grandfathered (no sub) + active/
// trialing — and past_due while the already-paid period still runs — keep it.
async function makeQrProperty(
  subStatus?: string,
  trialEndsAt?: Date,
  currentPeriodEnd?: Date,
): Promise<string> {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  if (subStatus) {
    await prisma.subscription.create({
      data: {
        organizationId: org.id,
        planCode: "pro",
        status: subStatus,
        provider: "paddle",
        trialEndsAt: trialEndsAt ?? null,
        currentPeriodEnd: currentPeriodEnd ?? null,
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

  it("STOPS (404) when the subscription is CANCELED and billing is ENFORCED", async () => {
    process.env.BILLING_ENFORCED = "true";
    expect(await resolveGuestChat(await makeQrProperty("canceled"))).toBeNull();
  });

  it("KEEPS working for a CANCELED sub while billing is DORMANT (kill-switch parity)", async () => {
    // The QR uses the SAME dormant-safe gate as every other paid AI surface:
    // while BILLING_ENFORCED is off nothing is gated, so a canceled org keeps the
    // concierge (flipping enforcement off restores QR alongside inbox AI).
    expect(await resolveGuestChat(await makeQrProperty("canceled"))).not.toBeNull();
  });

  // Kurucu 10-16: ödeme gecikmesinde EK SÜRE YOK — "Geçerli ödenmiş dönem bitince ücretli otomatik işler dursun; yenileme ödemesi
  // doğrulanınca açılsın." ÖNCE: yenileme başarısız olunca 14 gün daha açıktı.
  it("PAST_DUE ama ödenmiş dönem HÂLÂ sürüyor → çalışmaya devam eder (ödenmiş hizmet kesilmez)", async () => {
    process.env.BILLING_ENFORCED = "true";
    expect(await resolveGuestChat(await makeQrProperty("past_due", undefined, daysFromNow(2)))).not.toBeNull();
  });

  it("🚨 PAST_DUE ve ödenmiş dönem BİTTİ (dün) → aynı gün DURUR (eskiden 14 gün daha açıktı)", async () => {
    process.env.BILLING_ENFORCED = "true";
    expect(await resolveGuestChat(await makeQrProperty("past_due", undefined, daysFromNow(-1)))).toBeNull();
  });

  it("STOPS when PAST_DUE long after the period and billing is ENFORCED", async () => {
    process.env.BILLING_ENFORCED = "true";
    const token = await makeQrProperty("past_due", undefined, daysFromNow(-60));
    expect(await resolveGuestChat(token)).toBeNull();
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
