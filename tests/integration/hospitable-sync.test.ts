import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// Mock the Hospitable API client so the sync runs against fixed fixtures.
vi.mock("@/lib/hospitable", () => ({
  listProperties: vi.fn(),
  listReservations: vi.fn(),
  listMessages: vi.fn(),
}));

// The org is "connected" — return a fixed token so the multi-tenant sync runs.
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));

import { listProperties, listReservations, listMessages } from "@/lib/hospitable";
import { syncHospitable } from "@/lib/hospitable-sync";

const mockProperties = vi.mocked(listProperties);
const mockReservations = vi.mocked(listReservations);
const mockMessages = vi.mocked(listMessages);

describe("syncHospitable", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockReservations.mockResolvedValue([]);
    mockMessages.mockResolvedValue([]);
  });

  it("imports a thread, maps direction/channel/language, and is idempotent", async () => {
    const { orgId } = await makeOrgWithProperty(); // creates "Test Property"
    mockProperties.mockResolvedValue([{ id: "hosp-prop-1", name: "Test Property" }]);
    mockReservations.mockResolvedValue([
      {
        id: "res-1",
        code: "HMABC",
        platform: "airbnb",
        conversation_id: "conv-1",
        conversation_language: "en",
        last_message_at: "2026-05-30T10:00:00Z",
      },
    ]);
    mockMessages.mockResolvedValue([
      {
        id: 1001,
        body: "What time is check-in?",
        sender_type: "guest",
        sender_role: "guest",
        sender: { full_name: "Alex Guest" },
        created_at: "2026-05-30T09:00:00Z",
      },
      {
        id: 1002,
        body: "Check-in is at 15:00.",
        sender_type: "host",
        sender_role: "host",
        sender: { full_name: "Ev Sahibi" },
        created_at: "2026-05-30T10:00:00Z",
      },
    ]);

    const result = await syncHospitable(orgId);

    expect(result).toMatchObject({ properties: 1, reservations: 0, conversations: 1, messages: 2, threads: 1, skipped: 0 });

    // Adopted the existing property by name — no duplicate.
    expect(await prisma.property.count({ where: { organizationId: orgId } })).toBe(1);
    const prop = await prisma.property.findFirst({ where: { organizationId: orgId } });
    expect(prop?.hospitableId).toBe("hosp-prop-1");

    const conversation = await prisma.conversation.findFirst({
      where: { externalReservationId: "res-1" },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    expect(conversation?.channel).toBe("airbnb");
    expect(conversation?.guestIdentifier).toBe("Alex Guest");
    expect(conversation?.externalConversationId).toBe("conv-1");
    expect(conversation?.messages).toHaveLength(2);
    expect(conversation?.messages[0]).toMatchObject({
      direction: "inbound",
      externalId: "1001",
      language: "en",
    });
    expect(conversation?.messages[1].direction).toBe("outbound");
    expect(conversation?.status).toBe("answered"); // host spoke last

    // Second sync imports nothing new (dedup by external id).
    const second = await syncHospitable(orgId);
    expect(second.messages).toBe(0);
    expect(await prisma.message.count()).toBe(2);
  });

  it("does not re-fetch messages for threads that haven't changed (rate-limit saver)", async () => {
    const { orgId } = await makeOrgWithProperty();
    mockProperties.mockResolvedValue([{ id: "hosp-prop-1", name: "Test Property" }]);
    mockReservations.mockResolvedValue([
      { id: "res-stable", platform: "airbnb", last_message_at: "2026-05-30T10:00:00Z" },
    ]);
    mockMessages.mockResolvedValue([
      {
        id: 9,
        body: "Hello?",
        sender_type: "guest",
        sender: { full_name: "Guest" },
        created_at: "2026-05-30T10:00:00Z",
      },
    ]);

    await syncHospitable(orgId); // first run imports the thread
    expect(mockMessages).toHaveBeenCalledTimes(1);

    // Same last_message_at → thread unchanged → the message endpoint must NOT be
    // hit again (this is what keeps a busy account under the API rate limit).
    await syncHospitable(orgId);
    expect(mockMessages).toHaveBeenCalledTimes(1);
  });

  it("skips reservations that have no message thread", async () => {
    const { orgId } = await makeOrgWithProperty();
    mockProperties.mockResolvedValue([{ id: "hosp-prop-1", name: "Test Property" }]);
    mockReservations.mockResolvedValue([
      { id: "res-empty", platform: "airbnb", last_message_at: null },
    ]);

    const result = await syncHospitable(orgId);

    expect(result.conversations).toBe(0);
    expect(result.messages).toBe(0);
    expect(mockMessages).not.toHaveBeenCalled();
  });

  it("bounds the reservation window by the backDays option", async () => {
    const { orgId } = await makeOrgWithProperty();
    mockProperties.mockResolvedValue([{ id: "hp", name: "Test Property" }]);
    mockReservations.mockResolvedValue([]);

    await syncHospitable(orgId, { backDays: 365 });

    const arg = mockReservations.mock.calls[0]?.[0];
    const expectedStart = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    expect(arg?.startDate).toBe(expectedStart);
  });

  it("creates a new property when none matches by name", async () => {
    const { orgId } = await makeOrgWithProperty(); // "Test Property"
    mockProperties.mockResolvedValue([{ id: "hosp-prop-9", name: "Deniz Manzaralı Daire" }]);

    await syncHospitable(orgId);

    expect(await prisma.property.count({ where: { organizationId: orgId } })).toBe(2);
    const created = await prisma.property.findFirst({ where: { hospitableId: "hosp-prop-9" } });
    expect(created?.name).toBe("Deniz Manzaralı Daire");
  });

  it("marks guest-last threads 'new' and preserves human states on re-sync", async () => {
    const { orgId } = await makeOrgWithProperty();
    mockProperties.mockResolvedValue([{ id: "hp", name: "Test Property" }]);
    mockReservations.mockResolvedValue([
      { id: "res-2", platform: "airbnb", last_message_at: "2026-05-30T10:00:00Z" },
    ]);
    mockMessages.mockResolvedValue([
      {
        id: 1,
        body: "Hello?",
        sender_type: "guest",
        sender: { full_name: "Guest" },
        created_at: "2026-05-30T10:00:00Z",
      },
    ]);

    await syncHospitable(orgId);
    let conv = await prisma.conversation.findFirst({ where: { externalReservationId: "res-2" } });
    expect(conv?.status).toBe("new"); // guest spoke last

    // A human closes it; a re-sync with no new messages must not reopen it.
    await prisma.conversation.update({ where: { id: conv!.id }, data: { status: "closed" } });
    await syncHospitable(orgId);
    conv = await prisma.conversation.findFirst({ where: { externalReservationId: "res-2" } });
    expect(conv?.status).toBe("closed");
  });

  it("upserts reservations with guest/dates/status and is idempotent", async () => {
    const { orgId } = await makeOrgWithProperty(); // "Test Property"
    mockProperties.mockResolvedValue([{ id: "hp", name: "Test Property" }]);
    mockReservations.mockResolvedValue([
      {
        id: "res-cal-1",
        code: "HMCAL",
        platform: "booking",
        status: "confirmed",
        check_in: "2026-06-10",
        check_out: "2026-06-13",
        guest: { full_name: "Cal Guest", email: "cal@example.com" },
        total_price: 420,
        currency: "EUR",
        last_message_at: null,
      },
    ]);

    const result = await syncHospitable(orgId);
    expect(result.reservations).toBe(1);

    const res = await prisma.reservation.findFirst({ where: { sourceReference: "res-cal-1" } });
    expect(res).toMatchObject({
      guestName: "Cal Guest",
      guestEmail: "cal@example.com",
      channel: "booking",
      status: "confirmed",
    });
    expect(res?.arrivalDate.toISOString().slice(0, 10)).toBe("2026-06-10");

    // Re-sync updates in place — no duplicate.
    await syncHospitable(orgId);
    expect(await prisma.reservation.count({ where: { sourceReference: "res-cal-1" } })).toBe(1);
  });

  it("stores date-only arrival_date/departure_date as the exact calendar day", async () => {
    const { orgId } = await makeOrgWithProperty();
    mockProperties.mockResolvedValue([{ id: "hp", name: "Test Property" }]);
    mockReservations.mockResolvedValue([
      {
        id: "res-dates",
        platform: "airbnb",
        status: "confirmed",
        // Canonical date-only fields take precedence over check_in/check_out.
        arrival_date: "2026-06-04",
        departure_date: "2026-06-06",
        check_in: "2026-06-99", // bogus on purpose — must be ignored
        check_out: "2026-06-99",
        guest: { full_name: "Date Guest" },
        last_message_at: null,
      },
    ]);

    await syncHospitable(orgId);
    const res = await prisma.reservation.findFirst({ where: { sourceReference: "res-dates" } });
    // No off-by-one and no timezone drift: the stored calendar day equals the
    // Hospitable date exactly — so GuestOps matches the channel calendar.
    expect(res?.arrivalDate.toISOString().slice(0, 10)).toBe("2026-06-04");
    expect(res?.departureDate.toISOString().slice(0, 10)).toBe("2026-06-06");
  });

  it("maps a cancelled reservation to 'cancelled' (via nested status)", async () => {
    const { orgId } = await makeOrgWithProperty();
    mockProperties.mockResolvedValue([{ id: "hp", name: "Test Property" }]);
    mockReservations.mockResolvedValue([
      {
        id: "res-cancel",
        platform: "airbnb",
        arrival_date: "2026-07-01",
        departure_date: "2026-07-03",
        reservation_status: { current: { category: "cancelled" } },
        guest: { full_name: "Cancelled Guest" },
        last_message_at: null,
      },
    ]);

    await syncHospitable(orgId);
    const res = await prisma.reservation.findFirst({ where: { sourceReference: "res-cancel" } });
    expect(res?.status).toBe("cancelled");
  });

  it("links a new conversation to its local reservation row (correct guest/dates context)", async () => {
    const { orgId } = await makeOrgWithProperty();
    mockProperties.mockResolvedValue([{ id: "hp", name: "Test Property" }]);
    mockReservations.mockResolvedValue([
      {
        id: "res-link",
        platform: "airbnb",
        status: "confirmed",
        arrival_date: "2026-06-10",
        departure_date: "2026-06-13",
        guest: { full_name: "Linked Guest" },
        conversation_id: "conv-link",
        last_message_at: "2026-06-09T10:00:00Z",
      },
    ]);
    mockMessages.mockResolvedValue([
      {
        id: 5001,
        body: "Hi, what is the wifi password?",
        sender_type: "guest",
        sender: { full_name: "Linked Guest" },
        created_at: "2026-06-09T10:00:00Z",
      },
    ]);

    await syncHospitable(orgId);

    const reservation = await prisma.reservation.findFirst({ where: { sourceReference: "res-link" } });
    const conversation = await prisma.conversation.findFirst({ where: { externalReservationId: "res-link" } });
    expect(reservation).toBeTruthy();
    // Linked to the SAME local reservation row → the AI replies with the correct
    // guest/dates and the finished/cancelled-booking gate can apply.
    expect(conversation?.reservationId).toBe(reservation!.id);
  });

  it("backfills the reservation link on a later sync, never overwriting an existing link", async () => {
    const { orgId } = await makeOrgWithProperty();
    mockProperties.mockResolvedValue([{ id: "hp", name: "Test Property" }]);
    // First sync: reservation has no dates → no local reservation row → the
    // conversation is created UNLINKED.
    mockReservations.mockResolvedValue([
      { id: "res-bf", platform: "airbnb", conversation_id: "c", last_message_at: "2026-06-09T10:00:00Z" },
    ]);
    mockMessages.mockResolvedValue([
      { id: 7001, body: "Hello", sender_type: "guest", sender: { full_name: "BF Guest" }, created_at: "2026-06-09T10:00:00Z" },
    ]);
    await syncHospitable(orgId);
    let conv = await prisma.conversation.findFirst({ where: { externalReservationId: "res-bf" } });
    expect(conv?.reservationId).toBeNull();

    // Second sync: the same reservation now carries dates + a NEWER message → a
    // local reservation row is written and the unlinked conversation is backfilled.
    mockReservations.mockResolvedValue([
      {
        id: "res-bf",
        platform: "airbnb",
        status: "confirmed",
        arrival_date: "2026-06-10",
        departure_date: "2026-06-13",
        guest: { full_name: "BF Guest" },
        last_message_at: "2026-06-09T12:00:00Z",
      },
    ]);
    mockMessages.mockResolvedValue([
      { id: 7001, body: "Hello", sender_type: "guest", sender: { full_name: "BF Guest" }, created_at: "2026-06-09T10:00:00Z" },
      { id: 7002, body: "Anyone there?", sender_type: "guest", sender: { full_name: "BF Guest" }, created_at: "2026-06-09T12:00:00Z" },
    ]);
    await syncHospitable(orgId);

    const reservation = await prisma.reservation.findFirst({ where: { sourceReference: "res-bf" } });
    conv = await prisma.conversation.findFirst({ where: { externalReservationId: "res-bf" } });
    expect(reservation).toBeTruthy();
    expect(conv?.reservationId).toBe(reservation!.id);

    // A human re-points the link elsewhere; a later sync must NOT clobber it.
    const otherProp = await prisma.property.findFirst({ where: { organizationId: orgId } });
    const manual = await prisma.reservation.create({
      data: {
        propertyId: otherProp!.id,
        guestName: "Manual",
        arrivalDate: new Date("2026-06-10"),
        departureDate: new Date("2026-06-13"),
        sourceReference: "manual-ref",
      },
      select: { id: true },
    });
    await prisma.conversation.update({ where: { id: conv!.id }, data: { reservationId: manual.id } });
    mockMessages.mockResolvedValue([
      { id: 7001, body: "Hello", sender_type: "guest", sender: { full_name: "BF Guest" }, created_at: "2026-06-09T10:00:00Z" },
      { id: 7002, body: "Anyone there?", sender_type: "guest", sender: { full_name: "BF Guest" }, created_at: "2026-06-09T12:00:00Z" },
      { id: 7003, body: "Still waiting", sender_type: "guest", sender: { full_name: "BF Guest" }, created_at: "2026-06-09T14:00:00Z" },
    ]);
    mockReservations.mockResolvedValue([
      {
        id: "res-bf",
        platform: "airbnb",
        status: "confirmed",
        arrival_date: "2026-06-10",
        departure_date: "2026-06-13",
        guest: { full_name: "BF Guest" },
        last_message_at: "2026-06-09T14:00:00Z",
      },
    ]);
    await syncHospitable(orgId);
    conv = await prisma.conversation.findFirst({ where: { externalReservationId: "res-bf" } });
    expect(conv?.reservationId).toBe(manual.id); // human link preserved
  });
});
