import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { setReservationPin } from "@/lib/guest-chat-pin";
import type { SessionPayload } from "@/lib/auth";

// Faz 5 (#14) — cross-cutting security: strict-toggle endpoint, NO PIN-hash in
// the data export, and account-erasure cascade of a reservation carrying a PIN.

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { PATCH as settingsPatch } from "@/app/api/settings/route";
import { GET as exportGet } from "@/app/api/account/export/route";
import { deleteAccountData } from "@/lib/data-retention";

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});

async function seedOrg(role: SessionPayload["role"] = "owner") {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const user = await prisma.user.create({
    data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role },
  });
  session = { userId: user.id, organizationId: orgId, role, email: "o@x.com", name: "O", sessionEpoch: 0 };
  return { orgId, propertyId };
}

describe("settings PATCH qrChatPinRequired (strict-mode toggle)", () => {
  it("owner can turn strict mode on and off", async () => {
    const { orgId } = await seedOrg("owner");
    const on = await settingsPatch(
      new NextRequest("http://localhost/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ qrChatPinRequired: true }),
      }),
      { params: Promise.resolve({}) } as never,
    );
    expect(on.status).toBe(200);
    expect((await prisma.organization.findUnique({ where: { id: orgId } }))?.qrChatPinRequired).toBe(true);

    await settingsPatch(
      new NextRequest("http://localhost/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ qrChatPinRequired: false }),
      }),
      { params: Promise.resolve({}) } as never,
    );
    expect((await prisma.organization.findUnique({ where: { id: orgId } }))?.qrChatPinRequired).toBe(false);
  });

  it("STAFF is refused (403) — cannot flip the org security setting", async () => {
    const { orgId } = await seedOrg("staff");
    const res = await settingsPatch(
      new NextRequest("http://localhost/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ qrChatPinRequired: true }),
      }),
      { params: Promise.resolve({}) } as never,
    );
    expect(res.status).toBe(403);
    expect((await prisma.organization.findUnique({ where: { id: orgId } }))?.qrChatPinRequired).toBe(false);
  });
});

describe("data export never leaks the PIN hash", () => {
  it("a reservation with a PIN hash exports WITHOUT chatPinHash (value or field name)", async () => {
    const { propertyId } = await seedOrg("owner");
    const r = await prisma.reservation.create({
      data: {
        propertyId, guestName: "Ada", arrivalDate: daysFromNow(-1), departureDate: daysFromNow(2),
        status: "confirmed", channel: "airbnb",
      },
    });
    await setReservationPin(r.id);
    const row = await prisma.reservation.findUnique({ where: { id: r.id } });
    const hash = row!.chatPinHash!;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    const res = await exportGet(
      new NextRequest("http://localhost/api/account/export"),
      { params: Promise.resolve({}) } as never,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    // Neither the hash value nor any PIN field name may appear.
    for (const leak of ["chatPinHash", "chatPinFailedCount", "chatPinLockedUntil", hash]) {
      expect(text).not.toContain(leak);
    }
    // The reservation itself IS exported (just without the PIN fields).
    expect(text).toContain(r.id);
  });
});

describe("account erasure cascades a PIN'd reservation", () => {
  it("deleteAccountData removes the reservation (and its PIN) with the org", async () => {
    const { orgId, propertyId } = await seedOrg("owner");
    const r = await prisma.reservation.create({
      data: {
        propertyId, guestName: "Ada", arrivalDate: daysFromNow(-1), departureDate: daysFromNow(2),
        status: "confirmed", channel: "airbnb",
      },
    });
    await setReservationPin(r.id);
    expect((await prisma.reservation.findUnique({ where: { id: r.id } }))?.chatPinHash).not.toBeNull();

    await deleteAccountData(orgId);
    expect(await prisma.reservation.findUnique({ where: { id: r.id } })).toBeNull();
    expect(await prisma.organization.findUnique({ where: { id: orgId } })).toBeNull();
  });
});
