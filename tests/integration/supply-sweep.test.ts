import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { sweepMissedSupplyDerivations } from "@/lib/supply";

// Codex 07-24 #5 — supply-derivation self-heal. The inline per-import call is
// best-effort; when it failed transiently AFTER the message committed, the next
// sync deduped the message by externalId and never re-emitted the job → the
// supply request was silently lost forever. The sweep re-derives the recent
// window idempotently, so a lost derivation heals on the next run.

async function seedThreadMessage(
  propertyId: string,
  body: string,
  opts: { channel?: string; externalReservationId?: string | null; createdAt?: Date; reservationId?: string | null } = {},
) {
  const conversation = await prisma.conversation.create({
    data: {
      propertyId,
      channel: opts.channel ?? "airbnb",
      guestIdentifier: "Guest",
      status: "answered",
      externalReservationId:
        opts.externalReservationId === undefined ? `res-${Math.random().toString(36).slice(2)}` : opts.externalReservationId,
      reservationId: opts.reservationId ?? null,
    },
  });
  return prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "inbound",
      senderName: "Guest",
      body,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
}

describe("sweepMissedSupplyDerivations", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    const seeded = await makeOrgWithProperty();
    orgId = seeded.orgId;
    propertyId = seeded.propertyId;
    await prisma.organization.update({ where: { id: orgId }, data: { autoSupplyRequestEnabled: true } });
  });

  it("HEALS a lost derivation: a committed request-message without its SupplyRequest row gets one", async () => {
    // The message exists (import committed) but the inline derivation failed —
    // no SupplyRequest row anywhere. Exactly the permanent-loss state.
    const msg = await seedThreadMessage(propertyId, "Ekstra iki havlu rica ederiz.");
    expect(await prisma.supplyRequest.count()).toBe(0);

    const out = await sweepMissedSupplyDerivations(orgId);
    expect(out.created).toBe(1);
    const row = await prisma.supplyRequest.findFirstOrThrow();
    expect(row.sourceMessageId).toBe(msg.id);
    expect(row.itemKey).toBe("banyo_havlusu");

    // Idempotent: a second sweep changes nothing (dedupe by sourceMessageId).
    const again = await sweepMissedSupplyDerivations(orgId);
    expect(again.created).toBe(0);
    expect(await prisma.supplyRequest.count()).toBe(1);
  });

  it("scope matches the inline path: QR-chat and manual threads are NOT derived; neutral text creates nothing", async () => {
    await seedThreadMessage(propertyId, "Ekstra iki havlu rica ederiz.", {
      channel: "chat",
      externalReservationId: `qr-chat:${propertyId}:r1`,
    });
    await seedThreadMessage(propertyId, "Ekstra iki havlu rica ederiz.", { externalReservationId: null });
    await seedThreadMessage(propertyId, "Wifi şifresi nedir?"); // synced thread, no request
    const out = await sweepMissedSupplyDerivations(orgId);
    expect(out.created).toBe(0);
    expect(await prisma.supplyRequest.count()).toBe(0);
  });

  it("org toggle OFF (default) → one cheap read, nothing scanned or created", async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { autoSupplyRequestEnabled: false } });
    await seedThreadMessage(propertyId, "Ekstra iki havlu rica ederiz.");
    const out = await sweepMissedSupplyDerivations(orgId);
    expect(out).toEqual({ scanned: 0, created: 0, capped: false });
    expect(await prisma.supplyRequest.count()).toBe(0);
  });

  it("window: messages older than 48h are left alone (bounded rescans, no unbounded backfill)", async () => {
    await seedThreadMessage(propertyId, "Ekstra iki havlu rica ederiz.", {
      createdAt: new Date(Date.now() - 49 * 60 * 60 * 1000),
    });
    const out = await sweepMissedSupplyDerivations(orgId);
    expect(out.scanned).toBe(0);
    expect(out.created).toBe(0);
  });

  it("tenant-scoped: another org's messages are never derived by this org's sweep", async () => {
    const other = await makeOrgWithProperty();
    await prisma.organization.update({ where: { id: other.orgId }, data: { autoSupplyRequestEnabled: true } });
    await seedThreadMessage(other.propertyId, "Ekstra iki havlu rica ederiz.");
    const out = await sweepMissedSupplyDerivations(orgId); // sweep THIS org
    expect(out.scanned).toBe(0);
    expect(await prisma.supplyRequest.count()).toBe(0); // other org untouched too
  });
});
