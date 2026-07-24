import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { cleanupDuplicateConversations } from "@/lib/conversations-cleanup";

async function makeConv(
  propertyId: string,
  opts: {
    guest: string;
    ext: string | null;
    bodies: string[];
    lastMessageAt?: Date;
    channel?: string;
  },
) {
  return prisma.conversation.create({
    data: {
      propertyId,
      channel: opts.channel ?? "airbnb",
      guestIdentifier: opts.guest,
      status: "new",
      externalReservationId: opts.ext,
      lastMessageAt: opts.lastMessageAt ?? new Date(),
      messages: {
        create: opts.bodies.map((body, i) => ({
          direction: "inbound",
          senderName: opts.guest,
          body,
          createdAt: new Date(Date.now() + i * 1000),
        })),
      },
    },
    select: { id: true },
  });
}

describe("cleanupDuplicateConversations", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("removes a stale duplicate whose messages are all in the keeper (no message loss)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    // Reconnect split Mohammad across two reservation IDs: the new thread has the
    // full history, the old one is a subset.
    const keeper = await makeConv(propertyId, {
      guest: "Mohammad",
      ext: "res-new",
      bodies: ["bags at 14:00?", "thanks, left the keys"],
      lastMessageAt: new Date(),
    });
    const stale = await makeConv(propertyId, {
      guest: "Mohammad",
      ext: "res-old",
      bodies: ["bags at 14:00?"],
      lastMessageAt: new Date(Date.now() - 3_600_000),
    });

    const res = await cleanupDuplicateConversations(orgId);

    expect(res).toMatchObject({ removed: 1, groups: 1, needsReview: 0 });
    expect(await prisma.conversation.findUnique({ where: { id: keeper.id } })).not.toBeNull();
    expect(await prisma.conversation.findUnique({ where: { id: stale.id } })).toBeNull();
    // The kept thread is untouched; the stale copy's messages are gone (not orphaned).
    expect(await prisma.message.count({ where: { conversationId: keeper.id } })).toBe(2);
    expect(await prisma.message.count()).toBe(2);
  });

  it("does NOT delete a duplicate that holds a message the keeper lacks", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await makeConv(propertyId, { guest: "Ana", ext: "r1", bodies: ["A", "B"] });
    await makeConv(propertyId, { guest: "Ana", ext: "r2", bodies: ["A", "C"] }); // C is unique

    const res = await cleanupDuplicateConversations(orgId);

    expect(res).toMatchObject({ removed: 0, needsReview: 1 });
    expect(await prisma.conversation.count()).toBe(2); // both kept for manual review
  });

  it("leaves different guests alone", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await makeConv(propertyId, { guest: "Guest A", ext: "a", bodies: ["hi"] });
    await makeConv(propertyId, { guest: "Guest B", ext: "b", bodies: ["hi"] });

    const res = await cleanupDuplicateConversations(orgId);

    expect(res).toMatchObject({ removed: 0, groups: 0 });
    expect(await prisma.conversation.count()).toBe(2);
  });

  it("ignores non-channel conversations (no externalReservationId)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await makeConv(propertyId, { guest: "Walk In", ext: null, bodies: ["hi"], channel: "direct" });
    await makeConv(propertyId, { guest: "Walk In", ext: null, bodies: ["hi"], channel: "direct" });

    const res = await cleanupDuplicateConversations(orgId);

    expect(res).toMatchObject({ removed: 0, groups: 0 });
    expect(await prisma.conversation.count()).toBe(2);
  });
});
