import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// Codex #34 COMPLETED: the self-serve KVKK export must contain the host's FULL
// data (task updates + photo links, calendar sources, supply requests, billing,
// audit, consents, risk history, AI message metadata) while NEVER leaking a
// system secret. The secret scan works on the serialized output, so a future
// select:true regression that pulls a whole row gets caught here.

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { GET as exportRoute } from "@/app/api/account/export/route";

describe("GET /api/account/export — complete + secret-free", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("exports every data family and excludes every system secret", async () => {
    // A user WITH secrets on the row — none may reach the output.
    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        name: "Owner",
        email: "owner@x.com",
        role: "owner",
        passwordHash: "SECRET_PASSWORD_HASH_VALUE",
        twoFactorSecret: "SECRET_TOTP_VALUE",
        emailVerifyTokenHash: "SECRET_VERIFY_HASH_VALUE",
        acceptedTermsAt: new Date(),
        acceptedLegalVersion: "2026-06",
      },
    });
    await prisma.organization.update({
      where: { id: orgId },
      data: { hospitableTokenEnc: "SECRET_ENCRYPTED_TOKEN_VALUE", aiSignature: "Sevgiler, Nuve" },
    });
    const reservation = await prisma.reservation.create({
      data: {
        propertyId, guestName: "Ada", arrivalDate: daysFromNow(1), departureDate: daysFromNow(3),
        channel: "airbnb", status: "confirmed", totalAmount: 100.1, currency: "EUR",
        welcomeSentAt: new Date(),
      },
    });
    const conv = await prisma.conversation.create({
      data: { propertyId, guestIdentifier: "Ada", channel: "airbnb", lastRiskType: "complaint" },
    });
    await prisma.message.create({
      data: {
        conversationId: conv.id, direction: "outbound", senderName: "GuestOps AI",
        body: "Yanıt", aiIntent: "wifi", aiConfidence: 0.9, aiSourcesJson: '["kb:wifi"]', externalId: "ext-9",
      },
    });
    const task = await prisma.task.create({
      data: { propertyId, reservationId: reservation.id, type: "cleaning", origin: "system", title: "Temizlik", status: "todo", priority: "standard" },
    });
    await prisma.taskUpdate.create({
      data: { taskId: task.id, userId: user.id, status: "done", note: "bitti", photoUrl: "/uploads/x/foto.jpg" },
    });
    await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics?s=feedsecret" },
    });
    await prisma.supplyRequest.create({
      data: { propertyId, itemKey: "towel", qty: 2, sourceMessageId: "m-1" },
    });
    await prisma.subscription.create({
      data: { organizationId: orgId, planCode: "pro", status: "active", provider: "paddle", providerRef: "sub_123" },
    });
    await prisma.invoice.create({
      data: { organizationId: orgId, amountMinor: 89900, currency: "TRY", status: "paid", provider: "paddle", providerRef: "txn_1" },
    });
    await prisma.checkoutConsent.create({
      data: { organizationId: orgId, userId: user.id, planCode: "pro", priceId: "pri_1", legalVersion: "2026-06", ip: "5.6.7.8" },
    });
    await prisma.riskEvent.create({
      data: { organizationId: orgId, surface: "auto_reply", triggerId: "m-1", finalDecision: "human_review", riskLevel: "high", riskType: "complaint", reason: "escalated_to_human" },
    });

    const res = await exportRoute();
    expect(res.status).toBe(200);
    const text = await res.text();
    const data = JSON.parse(text);

    // Every family present (was missing from the old export entirely).
    const prop = data.organization.properties[0];
    expect(prop.tasks[0].updates[0]).toMatchObject({ note: "bitti", photoUrl: "/uploads/x/foto.jpg" });
    expect(prop.calendarSources[0].url).toContain("feedsecret"); // user's OWN credential — portability
    expect(prop.supplyRequests[0]).toMatchObject({ itemKey: "towel", qty: 2 });
    expect(prop.reservations[0].welcomeSentAt).toBeTruthy();
    expect(prop.conversations[0].lastRiskType).toBe("complaint");
    expect(prop.conversations[0].messages[0]).toMatchObject({ aiIntent: "wifi", externalId: "ext-9" });
    expect(data.billing.subscription).toMatchObject({ planCode: "pro", providerRef: "sub_123" });
    expect(data.billing.invoices[0]).toMatchObject({ amountMinor: 89900, status: "paid" });
    expect(data.auditLogs.some((a: { action: string }) => a.action === "data.export_self")).toBe(false); // written AFTER the read — next export shows it
    expect(data.checkoutConsents[0]).toMatchObject({ planCode: "pro", legalVersion: "2026-06" });
    expect(data.riskEvents[0]).toMatchObject({ finalDecision: "human_review", riskType: "complaint" });
    expect(data.organization.aiSignature).toBe("Sevgiler, Nuve"); // settings included
    expect(data.organization.users[0].acceptedLegalVersion).toBe("2026-06"); // consent evidence

    // SECRET SCAN on the raw output — values AND field names.
    for (const leak of [
      "SECRET_PASSWORD_HASH_VALUE",
      "SECRET_TOTP_VALUE",
      "SECRET_VERIFY_HASH_VALUE",
      "SECRET_ENCRYPTED_TOKEN_VALUE",
      "passwordHash",
      "twoFactorSecret",
      "emailVerifyTokenHash",
      "hospitableTokenEnc",
      "hospitableRefreshTokenEnc",
    ]) {
      expect(text).not.toContain(leak);
    }
  });
});
