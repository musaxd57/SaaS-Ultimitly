import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { ANON_NAME, ANON_ID, ANON_BODY } from "@/lib/data-retention";

// Mock the Hospitable API client — the resurrection tests drive the REAL sync
// engine against fixed provider fixtures (same pattern as hospitable-sync.test.ts).
vi.mock("@/lib/hospitable", () => ({
  listProperties: vi.fn(),
  listReservations: vi.fn(),
  listMessages: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));

import { listProperties, listReservations, listMessages } from "@/lib/hospitable";
import { syncHospitable } from "@/lib/hospitable-sync";
import {
  eraseReservationData,
  previewReservationErasure,
} from "@/lib/erasure";

const mockProperties = vi.mocked(listProperties);
const mockReservations = vi.mocked(listReservations);
const mockMessages = vi.mocked(listMessages);

const GUEST = {
  id: "guest-777",
  full_name: "Ada Lovelace",
  email: "ada.lovelace@example.com",
  phone: "+90 555 123 45 67",
};

const DAY = 86_400_000;
const iso = (daysFromToday: number) => new Date(Date.now() + daysFromToday * DAY).toISOString();

async function seedErasedStay() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const reservation = await prisma.reservation.create({
    data: {
      propertyId,
      guestName: GUEST.full_name,
      guestEmail: GUEST.email,
      guestPhone: GUEST.phone,
      guestExternalId: GUEST.id,
      sourceReference: "res-erase-1",
      arrivalDate: new Date(Date.now() - 30 * DAY),
      departureDate: new Date(Date.now() - 27 * DAY),
      status: "completed",
      channel: "airbnb",
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId,
      reservationId: reservation.id,
      externalReservationId: "res-erase-1",
      channel: "airbnb",
      guestIdentifier: GUEST.full_name,
      status: "answered",
      priority: "standard",
      lastMessageAt: new Date(Date.now() - 27 * DAY),
    },
  });
  await prisma.message.createMany({
    data: [
      {
        conversationId: conversation.id,
        direction: "inbound",
        senderName: GUEST.full_name,
        body: "Merhaba, ben Ada Lovelace — kapı kodunu alabilir miyim?",
        externalId: "m-1",
      },
      {
        conversationId: conversation.id,
        direction: "outbound",
        senderName: "Ev sahibi",
        body: "Merhaba Ada Lovelace, kod 1234.",
        externalId: "m-2",
      },
    ],
  });
  return { orgId, propertyId, reservationId: reservation.id, conversationId: conversation.id };
}

describe("KVKK explicit erasure (m40) — executor", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockReservations.mockResolvedValue([]);
    mockMessages.mockResolvedValue([]);
  });

  it("preview reports the scope WITHOUT writing anything", async () => {
    const { orgId, reservationId } = await seedErasedStay();
    const scope = await previewReservationErasure(orgId, reservationId);
    expect(scope).toMatchObject({ conversations: 1, inboundMessages: 1, outboundMessages: 1 });
    expect(scope!.tombstoneKeys).toBe(4); // ref + guest id + email + phone
    const res = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    expect(res.guestName).toBe(GUEST.full_name); // untouched
    expect(await prisma.erasureTombstone.count()).toBe(0);
  });

  it("erases: scrubs PII with the sweep's sentinels + writes hash-only tombstones (no raw PII at rest)", async () => {
    const { orgId, reservationId, conversationId } = await seedErasedStay();
    const scope = await eraseReservationData(orgId, reservationId);
    expect(scope).not.toBeNull();

    const res = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    expect(res.guestName).toBe(ANON_NAME);
    expect(res.guestEmail).toBeNull();
    expect(res.guestPhone).toBeNull();
    expect(res.guestExternalId).toBeNull();

    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conv.guestIdentifier).toBe(ANON_ID);

    const msgs = await prisma.message.findMany({ where: { conversationId } });
    const inbound = msgs.find((m) => m.direction === "inbound")!;
    const outbound = msgs.find((m) => m.direction === "outbound")!;
    expect(inbound.body).toBe(ANON_BODY); // guest words gone
    expect(outbound.body).not.toContain("Ada"); // host record kept, name redacted
    expect(outbound.body).toContain("[Misafir]");

    // Tombstones: 4 keys, versioned hex-only, and NO raw identifier in the table.
    const tombs = await prisma.erasureTombstone.findMany();
    expect(tombs).toHaveLength(4);
    for (const t of tombs) {
      expect(t.keyHash).toMatch(/^v1:[0-9a-f]{64}$/); // versioned — rotation ships as v2, never a silent mismatch
      expect(t.keyHash).not.toContain("ada");
      expect(t.keyHash.includes("5551234567")).toBe(false);
    }
    const serialized = JSON.stringify(tombs);
    expect(serialized).not.toContain("Ada");
    expect(serialized).not.toContain("example.com");
    expect(serialized).not.toContain("res-erase-1");
  });

  it("re-erasing the same stay is idempotent (skipDuplicates — no unique-violation throw)", async () => {
    const { orgId, reservationId } = await seedErasedStay();
    await eraseReservationData(orgId, reservationId);
    const again = await eraseReservationData(orgId, reservationId);
    expect(again).not.toBeNull();
    expect(await prisma.erasureTombstone.count()).toBe(4); // still one row per key
  });

  it("is tenant-scoped: a foreign org's reservation id erases NOTHING", async () => {
    const { reservationId } = await seedErasedStay();
    const other = await prisma.organization.create({ data: { name: "Other" } });
    expect(await eraseReservationData(other.id, reservationId)).toBeNull();
    const res = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    expect(res.guestName).toBe(GUEST.full_name); // untouched
  });

  it("TOCTOU (Codex-1): PII written by a racing stale-guard sync in the commit window is caught by the VERIFY PASS", async () => {
    // A sync run that loaded its guard BEFORE the erasure can still be mid-flight
    // while the erasure transaction commits — and can land fresh PII rows the
    // in-TX mask never saw. The __afterTxHook seam injects exactly that write into
    // the commit→verify window; without the post-commit verify pass this test is
    // RED (the racer's conversation + message keep the guest's name).
    const { orgId, propertyId, reservationId } = await seedErasedStay();
    let racerConvId = "";
    const scope = await eraseReservationData(orgId, reservationId, async () => {
      const racerConv = await prisma.conversation.create({
        data: {
          propertyId,
          reservationId,
          externalReservationId: "res-erase-1",
          channel: "airbnb",
          guestIdentifier: GUEST.full_name, // the racing sync writes the REAL name back
          status: "answered",
          priority: "standard",
          lastMessageAt: new Date(),
        },
      });
      racerConvId = racerConv.id;
      await prisma.message.create({
        data: {
          conversationId: racerConv.id,
          direction: "inbound",
          senderName: GUEST.full_name,
          body: "Merhaba, ben Ada Lovelace (yarışan sync'ten)",
          externalId: "race-m1",
        },
      });
      await prisma.reservation.update({
        where: { id: reservationId },
        data: { guestName: GUEST.full_name, guestEmail: GUEST.email }, // racer un-scrubs the row
      });
    });
    expect(scope).not.toBeNull();

    // Verify pass re-masked EVERYTHING the racer wrote.
    const res = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    expect(res.guestName).toBe(ANON_NAME);
    expect(res.guestEmail).toBeNull();
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: racerConvId } });
    expect(conv.guestIdentifier).toBe(ANON_ID);
    const msg = await prisma.message.findFirstOrThrow({ where: { conversationId: racerConvId } });
    expect(msg.body).toBe(ANON_BODY);
    expect(msg.body).not.toContain("Ada");
  });

  it("m41 expiry: a tombstone past its legal retention bound stops guarding (data may flow again)", async () => {
    const { orgId, reservationId, conversationId } = await seedErasedStay();
    await eraseReservationData(orgId, reservationId);
    await prisma.message.deleteMany({ where: { conversationId } });
    await prisma.conversation.delete({ where: { id: conversationId } });
    await prisma.reservation.delete({ where: { id: reservationId } });
    // Lawyer-set bound elapsed: expire EVERY tombstone of the org.
    await prisma.erasureTombstone.updateMany({
      where: { organizationId: orgId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    mockProperties.mockResolvedValue([{ id: "hosp-prop-1", name: "Test Property" }]);
    mockReservations.mockResolvedValue([
      {
        id: "res-erase-1",
        platform: "airbnb",
        arrival_date: iso(-30),
        departure_date: iso(-27),
        conversation_id: "conv-erase-1",
        last_message_at: iso(-27),
        guest: GUEST,
      },
    ]);

    const result = await syncHospitable(orgId);
    // Expired guard = inert → the reservation imports again (retention bound honored).
    expect(result.reservations).toBe(1);
    expect(await prisma.reservation.count({ where: { sourceReference: "res-erase-1" } })).toBe(1);
  });
});

describe("KVKK explicit erasure (m40) — sync resurrection guards", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockReservations.mockResolvedValue([]);
    mockMessages.mockResolvedValue([]);
  });

  it("RED-FIRST: local rows fully DELETED after erasure + provider re-sends the stay → NOTHING re-imports", async () => {
    // This is the hole no ANON-sentinel guard can cover: once the local rows are
    // gone there is no sentinel to see — only the tombstone stands between the
    // provider's copy and a full PII resurrection.
    const { orgId, reservationId, conversationId } = await seedErasedStay();
    await eraseReservationData(orgId, reservationId);
    await prisma.message.deleteMany({ where: { conversationId } });
    await prisma.conversation.delete({ where: { id: conversationId } });
    await prisma.reservation.delete({ where: { id: reservationId } });

    mockProperties.mockResolvedValue([{ id: "hosp-prop-1", name: "Test Property" }]);
    mockReservations.mockResolvedValue([
      {
        id: "res-erase-1", // the SAME provider reservation — the erased data itself
        platform: "airbnb",
        arrival_date: iso(-30),
        departure_date: iso(-27),
        conversation_id: "conv-erase-1",
        last_message_at: iso(-27),
        guest: GUEST,
      },
    ]);
    mockMessages.mockResolvedValue([
      { id: 9001, body: "Merhaba, ben Ada Lovelace", sender_type: "guest", sender_role: "guest", created_at: iso(-28) },
    ]);

    const result = await syncHospitable(orgId);

    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(await prisma.reservation.count({ where: { sourceReference: "res-erase-1" } })).toBe(0);
    expect(await prisma.conversation.count({ where: { externalReservationId: "res-erase-1" } })).toBe(0);
    expect(await prisma.message.count()).toBe(0); // "Ada Lovelace" resurrected nowhere
  });

  it("NEW-DATA BOUNDARY: the same guest's LATER stay imports normally; their pre-erasure messages still never do", async () => {
    const { orgId, reservationId } = await seedErasedStay();
    await eraseReservationData(orgId, reservationId);

    mockProperties.mockResolvedValue([{ id: "hosp-prop-1", name: "Test Property" }]);
    mockReservations.mockResolvedValue([
      {
        id: "res-new-9", // a NEW booking (different ref) that ENDS after the request
        platform: "airbnb",
        arrival_date: iso(3),
        departure_date: iso(6),
        conversation_id: "conv-new-9",
        last_message_at: iso(0),
        guest: GUEST, // same person (id/email/phone all match the tombstones)
      },
    ]);
    mockMessages.mockResolvedValue([
      // Provider re-uses the guest thread: one PRE-erasure line + one genuinely new.
      { id: 9101, body: "Eski konaklamadan kalan satır", sender_type: "guest", sender_role: "guest", created_at: iso(-40) },
      { id: 9102, body: "Yeni rezervasyonum hakkında sorum var", sender_type: "guest", sender_role: "guest", created_at: iso(0) },
    ]);

    const result = await syncHospitable(orgId);

    // The new stay is NEW processing (art. 5/2-c) → imported, name and all.
    const created = await prisma.reservation.findFirst({ where: { sourceReference: "res-new-9" } });
    expect(created).not.toBeNull();
    expect(result.reservations).toBeGreaterThanOrEqual(1);
    // …but the pre-erasure message did NOT come back; only the new one did.
    const conv = await prisma.conversation.findFirst({ where: { externalReservationId: "res-new-9" } });
    const msgs = await prisma.message.findMany({ where: { conversationId: conv!.id } });
    expect(msgs.map((m) => m.externalId)).toEqual(["9102"]);
  });

  it("GUEST-ERA BLOCK: another OLD stay of the erased guest (departure before the request) is skipped", async () => {
    const { orgId, reservationId } = await seedErasedStay();
    await eraseReservationData(orgId, reservationId);

    mockProperties.mockResolvedValue([{ id: "hosp-prop-1", name: "Test Property" }]);
    mockReservations.mockResolvedValue([
      {
        id: "res-old-8", // different ref, but the SAME person and an ERA stay
        platform: "airbnb",
        arrival_date: iso(-90),
        departure_date: iso(-87),
        conversation_id: "conv-old-8",
        last_message_at: iso(-87),
        guest: GUEST,
      },
    ]);

    const result = await syncHospitable(orgId);

    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(await prisma.reservation.count({ where: { sourceReference: "res-old-8" } })).toBe(0);
  });

  it("no tombstones → the guard is inert (normal import untouched)", async () => {
    const { orgId } = await makeOrgWithProperty();
    mockProperties.mockResolvedValue([{ id: "hosp-prop-1", name: "Test Property" }]);
    mockReservations.mockResolvedValue([
      {
        id: "res-plain-1",
        platform: "airbnb",
        arrival_date: iso(2),
        departure_date: iso(5),
        conversation_id: "conv-plain-1",
        last_message_at: iso(0),
        guest: GUEST,
      },
    ]);
    mockMessages.mockResolvedValue([
      { id: 9201, body: "Selam!", sender_type: "guest", sender_role: "guest", created_at: iso(0) },
    ]);

    const result = await syncHospitable(orgId);
    expect(result.reservations).toBe(1);
    expect(result.messages).toBe(1);
  });
});
