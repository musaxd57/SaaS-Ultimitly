import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { subMonths } from "date-fns";
import { prisma, resetDb } from "../helpers/db";
import { anonymizeOldGuestData, deleteAccountData } from "@/lib/data-retention";

async function seedStay(opts: {
  orgName?: string;
  departedMonthsAgo: number;
  guestName: string;
  body: string;
}) {
  const org = await prisma.organization.create({ data: { name: opts.orgName ?? "Org" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Daire 1" } });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: opts.guestName,
      guestPhone: "+905551112233",
      guestEmail: "guest@example.com",
      guestExternalId: "g-ext-1",
      arrivalDate: subMonths(new Date(), opts.departedMonthsAgo + 1),
      departureDate: subMonths(new Date(), opts.departedMonthsAgo),
      status: "completed",
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: reservation.id,
      channel: "airbnb",
      guestIdentifier: opts.guestName,
      messages: {
        create: [
          { direction: "inbound", senderName: opts.guestName, body: opts.body },
          { direction: "outbound", senderName: "Lixus AI", body: "Yardımcı olalım." },
        ],
      },
    },
  });
  return { orgId: org.id, propertyId: property.id, reservationId: reservation.id, conversationId: conversation.id };
}

describe("anonymizeOldGuestData (KVKK retention)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a no-op when DATA_RETENTION_MONTHS is not set", async () => {
    const { reservationId } = await seedStay({ departedMonthsAgo: 40, guestName: "John Old", body: "Eski mesaj" });
    const r = await anonymizeOldGuestData();
    expect(r.anonymized).toBe(0);
    const res = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(res?.guestName).toBe("John Old"); // untouched while disabled
  });

  it("anonymizes long-past guest PII but leaves recent stays intact", async () => {
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
    const old = await seedStay({ departedMonthsAgo: 30, guestName: "John Old", body: "Klima bozuk, çok kötü!" });
    const recent = await seedStay({ departedMonthsAgo: 1, guestName: "Jane New", body: "Wifi şifresi nedir?" });

    const r = await anonymizeOldGuestData();
    expect(r.anonymized).toBe(1);

    // Old stay scrubbed
    const oldRes = await prisma.reservation.findUnique({ where: { id: old.reservationId } });
    expect(oldRes?.guestName).toBe("Eski misafir");
    expect(oldRes?.guestPhone).toBeNull();
    expect(oldRes?.guestEmail).toBeNull();
    expect(oldRes?.guestExternalId).toBeNull();
    const oldConv = await prisma.conversation.findUnique({
      where: { id: old.conversationId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    expect(oldConv?.guestIdentifier).toBe("Misafir");
    const inbound = oldConv?.messages.find((m) => m.direction === "inbound");
    const outbound = oldConv?.messages.find((m) => m.direction === "outbound");
    expect(inbound?.body).not.toContain("Klima");
    expect(inbound?.senderName).toBe("Misafir");
    expect(outbound?.body).toContain("Yardımcı"); // host's own outbound left intact

    // Recent stay untouched
    const recentRes = await prisma.reservation.findUnique({ where: { id: recent.reservationId } });
    expect(recentRes?.guestName).toBe("Jane New");
    const recentConv = await prisma.conversation.findUnique({
      where: { id: recent.conversationId },
      include: { messages: true },
    });
    expect(recentConv?.guestIdentifier).toBe("Jane New");
    expect(recentConv?.messages.some((m) => m.body.includes("Wifi"))).toBe(true);
  });

  it("is idempotent — a second run does nothing (already anonymized)", async () => {
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
    await seedStay({ departedMonthsAgo: 30, guestName: "John Old", body: "Bozuk!" });
    expect((await anonymizeOldGuestData()).anonymized).toBe(1);
    expect((await anonymizeOldGuestData()).anonymized).toBe(0);
  });
});

describe("deleteAccountData (KVKK erasure)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("permanently deletes the org + all its data and leaves other orgs intact", async () => {
    const a = await seedStay({ orgName: "Org A", departedMonthsAgo: 2, guestName: "A Guest", body: "msg A" });
    const b = await seedStay({ orgName: "Org B", departedMonthsAgo: 2, guestName: "B Guest", body: "msg B" });
    // ChatUsage has no FK relation → must be cleared explicitly by deleteAccountData.
    await prisma.chatUsage.create({ data: { propertyId: a.propertyId, day: "2026-01-01", count: 5 } });

    await deleteAccountData(a.orgId);

    expect(await prisma.organization.findUnique({ where: { id: a.orgId } })).toBeNull();
    expect(await prisma.property.findUnique({ where: { id: a.propertyId } })).toBeNull();
    expect(await prisma.reservation.findUnique({ where: { id: a.reservationId } })).toBeNull();
    expect(await prisma.conversation.findUnique({ where: { id: a.conversationId } })).toBeNull();
    expect(await prisma.message.count({ where: { conversationId: a.conversationId } })).toBe(0);
    expect(await prisma.chatUsage.findFirst({ where: { propertyId: a.propertyId } })).toBeNull();

    // Org B fully intact.
    expect(await prisma.organization.findUnique({ where: { id: b.orgId } })).not.toBeNull();
    expect(await prisma.reservation.findUnique({ where: { id: b.reservationId } })).not.toBeNull();
    expect(await prisma.message.count({ where: { conversationId: b.conversationId } })).toBe(2);
  });
});
