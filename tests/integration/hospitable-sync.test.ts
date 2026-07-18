import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { ANON_NAME, ANON_ID } from "@/lib/data-retention";

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

  it("dedups thread messages with ONE batched query, not a findFirst per message (N+1 removed)", async () => {
    const { orgId } = await makeOrgWithProperty();
    mockProperties.mockResolvedValue([{ id: "hosp-prop-n1", name: "Test Property" }]);
    mockReservations.mockResolvedValue([
      { id: "res-n1", code: "HMN1", platform: "airbnb", conversation_id: "conv-n1",
        conversation_language: "en", last_message_at: "2026-06-05T10:00:00Z" },
    ]);
    // Three ALL-INBOUND messages: the outbound adopt-and-heal path (which has its
    // OWN findFirst) is never taken, so the only message.findFirst calls would be
    // the old per-message dedup lookup. After the fix that becomes a single findMany.
    mockMessages.mockResolvedValue([
      { id: 5001, body: "Msg one", sender_type: "guest", sender_role: "guest", sender: { full_name: "Gwen" }, created_at: "2026-06-05T08:00:00Z" },
      { id: 5002, body: "Msg two", sender_type: "guest", sender_role: "guest", sender: { full_name: "Gwen" }, created_at: "2026-06-05T09:00:00Z" },
      { id: 5003, body: "Msg three", sender_type: "guest", sender_role: "guest", sender: { full_name: "Gwen" }, created_at: "2026-06-05T10:00:00Z" },
    ]);

    // Passthrough spy (no mockRestore — restoring a Prisma delegate breaks it; the
    // impl delegates to the real method so later tests are unaffected).
    const realFindFirst = prisma.message.findFirst.bind(prisma.message);
    const findFirstSpy = vi
      .spyOn(prisma.message, "findFirst")
      .mockImplementation(((a: Parameters<typeof realFindFirst>[0]) => realFindFirst(a)) as never);

    const result = await syncHospitable(orgId);

    expect(result.messages).toBe(3); // all three imported
    // The N+1 is gone: dedup no longer issues one findFirst per message (was 3, now 0).
    expect(findFirstSpy).toHaveBeenCalledTimes(0);

    // Behaviour preserved: a re-sync imports nothing new.
    const second = await syncHospitable(orgId);
    expect(second.messages).toBe(0);
    expect(await prisma.message.count()).toBe(3);
  });

  it("adopts an app-sent reply that has no provider id instead of duplicating it (externalId-null heal)", async () => {
    const { orgId } = await makeOrgWithProperty();
    mockProperties.mockResolvedValue([{ id: "hosp-prop-1", name: "Test Property" }]);
    mockReservations.mockResolvedValue([
      {
        id: "res-1",
        platform: "airbnb",
        conversation_id: "conv-1",
        last_message_at: "2026-05-30T10:00:00Z",
      },
    ]);
    mockMessages.mockResolvedValue([
      { id: 1001, body: "Anahtar nerede?", sender_type: "guest", sender_role: "guest", created_at: "2026-05-30T09:00:00Z" },
    ]);
    await syncHospitable(orgId);
    const conversation = await prisma.conversation.findFirstOrThrow({ where: { externalReservationId: "res-1" } });

    // The host answers via the app, but the provider POST returned no message id
    // (or a POST-id ≠ GET-id) → the local row persists with externalId NULL.
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "outbound",
        senderName: "Owner",
        body: "Anahtar kapı yanındaki kutuda.",
        externalId: null,
        createdAt: new Date("2026-05-30T11:00:00Z"),
      },
    });

    // The next sync re-fetches the thread; the SAME reply now comes back from the
    // API with its real id. It must ADOPT the un-ID'd local row (healing its
    // externalId), not create a duplicate "Ev sahibi" row.
    mockReservations.mockResolvedValue([
      { id: "res-1", platform: "airbnb", conversation_id: "conv-1", last_message_at: "2026-05-30T11:00:05Z" },
    ]);
    mockMessages.mockResolvedValue([
      { id: 1001, body: "Anahtar nerede?", sender_type: "guest", sender_role: "guest", created_at: "2026-05-30T09:00:00Z" },
      { id: 2001, body: "Anahtar kapı yanındaki kutuda.", sender_type: "host", sender_role: "host", created_at: "2026-05-30T11:00:02Z" },
    ]);
    await syncHospitable(orgId);

    const outbound = await prisma.message.findMany({
      where: { conversationId: conversation.id, direction: "outbound" },
    });
    expect(outbound).toHaveLength(1); // no duplicate row
    expect(outbound[0].externalId).toBe("2001"); // healed → future syncs dedup by id
  });

  it("adopt-heal never claims an INBOUND api message or overwrites a real externalId", async () => {
    const { orgId } = await makeOrgWithProperty();
    mockProperties.mockResolvedValue([{ id: "hosp-prop-1", name: "Test Property" }]);
    mockReservations.mockResolvedValue([
      { id: "res-1", platform: "airbnb", conversation_id: "conv-1", last_message_at: "2026-05-30T10:00:00Z" },
    ]);
    mockMessages.mockResolvedValue([
      { id: 1001, body: "Merhaba", sender_type: "guest", sender_role: "guest", created_at: "2026-05-30T09:00:00Z" },
    ]);
    await syncHospitable(orgId);
    const conversation = await prisma.conversation.findFirstOrThrow({ where: { externalReservationId: "res-1" } });

    // A local outbound row with the SAME text as the guest's message but already
    // carrying a REAL id: neither may be adopted/overwritten by the next sync.
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "outbound",
        senderName: "Owner",
        body: "Merhaba",
        externalId: "real-77",
        createdAt: new Date("2026-05-30T09:30:00Z"),
      },
    });
    mockReservations.mockResolvedValue([
      { id: "res-1", platform: "airbnb", conversation_id: "conv-1", last_message_at: "2026-05-30T10:30:00Z" },
    ]);
    mockMessages.mockResolvedValue([
      { id: 1001, body: "Merhaba", sender_type: "guest", sender_role: "guest", created_at: "2026-05-30T09:00:00Z" },
      // A NEW guest message with a body identical to the host's reply text: must
      // import as a fresh INBOUND row, never adopt the outbound row.
      { id: 3001, body: "Merhaba", sender_type: "guest", sender_role: "guest", created_at: "2026-05-30T10:30:00Z" },
    ]);
    await syncHospitable(orgId);

    const rows = await prisma.message.findMany({ where: { conversationId: conversation.id } });
    expect(rows.filter((r) => r.direction === "inbound")).toHaveLength(2); // 1001 + 3001
    expect(rows.find((r) => r.externalId === "real-77")).toBeTruthy(); // untouched
    expect(rows.find((r) => r.externalId === "3001")?.direction).toBe("inbound");
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

  it("maps a declined/expired request to cancelled (so it is never messaged)", async () => {
    const { orgId } = await makeOrgWithProperty();
    mockProperties.mockResolvedValue([{ id: "hp", name: "Test Property" }]);
    mockReservations.mockResolvedValue([
      {
        id: "res-declined",
        platform: "airbnb",
        arrival_date: "2026-07-01",
        departure_date: "2026-07-03",
        reservation_status: { current: { category: "declined" } },
        guest: { full_name: "Declined Guest" },
        last_message_at: null,
      },
    ]);

    await syncHospitable(orgId);
    const res = await prisma.reservation.findFirst({ where: { sourceReference: "res-declined" } });
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

describe("syncHospitable — plan property limit", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockReservations.mockResolvedValue([]);
    mockMessages.mockResolvedValue([]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is NOT capped while billing is dormant (BILLING_ENFORCED off), even far over a plan's limit", async () => {
    const org = await prisma.organization.create({ data: { name: "Dormant Org" } });
    await prisma.subscription.create({
      data: { organizationId: org.id, planCode: "free", status: "active" }, // free = 2
    });
    mockProperties.mockResolvedValue([
      { id: "hp-1", name: "A" },
      { id: "hp-2", name: "B" },
      { id: "hp-3", name: "C" },
    ]);
    const result = await syncHospitable(org.id);
    expect(result.properties).toBe(3);
    expect(result.propertiesCapped).toBe(0);
  });

  it("caps NEW listings at the plan's property limit once billing is enforced", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    const org = await prisma.organization.create({ data: { name: "Capped Org" } });
    await prisma.subscription.create({
      data: { organizationId: org.id, planCode: "free", status: "active" }, // free = 2
    });
    mockProperties.mockResolvedValue([
      { id: "hp-1", name: "A" },
      { id: "hp-2", name: "B" },
      { id: "hp-3", name: "C" },
    ]);
    const result = await syncHospitable(org.id);
    expect(result.properties).toBe(2);
    expect(result.propertiesCapped).toBe(1);
    expect(await prisma.property.count({ where: { organizationId: org.id } })).toBe(2);
  });

  it("never drops or re-blocks a property that was already onboarded before the cap applied", async () => {
    const org = await prisma.organization.create({ data: { name: "Grandfathered Growth Org" } });
    // 3 properties already onboarded while dormant/unlimited...
    mockProperties.mockResolvedValue([
      { id: "hp-1", name: "A" },
      { id: "hp-2", name: "B" },
      { id: "hp-3", name: "C" },
    ]);
    await syncHospitable(org.id);
    expect(await prisma.property.count({ where: { organizationId: org.id } })).toBe(3);

    // ...then the org is put on a 2-property plan and enforcement switches on.
    await prisma.subscription.create({
      data: { organizationId: org.id, planCode: "free", status: "active" }, // free = 2
    });
    vi.stubEnv("BILLING_ENFORCED", "true");
    const result = await syncHospitable(org.id); // same 3 listings, re-synced
    expect(result.properties).toBe(3); // all 3 already-linked properties still sync
    expect(result.propertiesCapped).toBe(0); // nothing new to refuse
    expect(await prisma.property.count({ where: { organizationId: org.id } })).toBe(3);
  });

  it("grandfathered orgs (no Subscription row) are never capped even when enforced", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    const org = await prisma.organization.create({ data: { name: "No Sub Org" } });
    mockProperties.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ id: `hp-${i}`, name: `Prop ${i}` })),
    );
    const result = await syncHospitable(org.id);
    expect(result.properties).toBe(30);
    expect(result.propertiesCapped).toBe(0);
  });

  it("KVKK: never resurrects PII onto an already-anonymized row (retention guard)", async () => {
    const { orgId } = await makeOrgWithProperty();
    mockProperties.mockResolvedValue([{ id: "hosp-prop-1", name: "Test Property" }]);
    // Booking channel: it returns the REAL guest PII forever (no masking), so the
    // only defense against re-import resurrection is the local-anonymized guard.
    const booking = {
      id: "res-guard-1",
      platform: "booking",
      arrival_date: "2026-05-01",
      departure_date: "2026-05-04",
      conversation_id: "conv-guard-1",
      last_message_at: "2026-05-01T10:00:00Z",
      guest: { full_name: "Ada Lovelace", email: "ada@example.com", phone: "+90 555 111 2233" },
    };
    mockReservations.mockResolvedValue([booking]);
    mockMessages.mockResolvedValue([
      { id: 2001, body: "Merhaba", sender_type: "guest", sender_role: "guest", sender: { full_name: "Ada Lovelace" }, created_at: "2026-05-01T09:00:00Z" },
    ]);
    await syncHospitable(orgId);

    let res = await prisma.reservation.findFirst({ where: { property: { organizationId: orgId }, sourceReference: "res-guard-1" } });
    expect(res?.guestName).toBe("Ada Lovelace");
    expect(res?.guestEmail).toBe("ada@example.com");

    // Simulate the retention sweep anonymizing this stay (name/PII scrubbed).
    await prisma.reservation.update({
      where: { id: res!.id },
      data: { guestName: "Eski misafir", guestEmail: null, guestPhone: null, guestExternalId: null },
    });
    await prisma.conversation.updateMany({
      where: { propertyId: res!.propertyId, externalReservationId: "res-guard-1" },
      data: { guestIdentifier: "Misafir" },
    });

    // Re-sync: the channel STILL returns the real name + a genuinely-new message.
    mockReservations.mockResolvedValue([{ ...booking, last_message_at: "2026-05-02T09:00:00Z" }]);
    mockMessages.mockResolvedValue([
      { id: 2001, body: "Merhaba", sender_type: "guest", sender_role: "guest", sender: { full_name: "Ada Lovelace" }, created_at: "2026-05-01T09:00:00Z" },
      { id: 2002, body: "Bir sorum daha var", sender_type: "guest", sender_role: "guest", sender: { full_name: "Ada Lovelace" }, created_at: "2026-05-02T09:00:00Z" },
    ]);
    await syncHospitable(orgId);

    // PII stays scrubbed — NOT resurrected from the channel.
    res = await prisma.reservation.findFirst({ where: { property: { organizationId: orgId }, sourceReference: "res-guard-1" } });
    expect(res?.guestName).toBe("Eski misafir");
    expect(res?.guestEmail).toBeNull();
    expect(res?.guestPhone).toBeNull();
    const conv = await prisma.conversation.findFirst({ where: { propertyId: res!.propertyId, externalReservationId: "res-guard-1" } });
    expect(conv?.guestIdentifier).toBe("Misafir");
    // ...but the genuinely-NEW message still imported (the guard blocks resurrection, not new data).
    const msgCount = await prisma.message.count({ where: { conversation: { externalReservationId: "res-guard-1" } } });
    expect(msgCount).toBe(2);
  });

  it("KVKK: on a scrubbed stay, messages OLDER than the retention cutoff never re-import (adopt-miss can't resurrect PII)", async () => {
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
    try {
      const { orgId } = await makeOrgWithProperty();
      mockProperties.mockResolvedValue([{ id: "hosp-prop-1", name: "Test Property" }]);
      const booking = {
        id: "res-old-1",
        platform: "booking",
        arrival_date: "2023-01-01",
        departure_date: "2023-01-04",
        conversation_id: "conv-old-1",
        last_message_at: "2023-01-02T10:00:00Z",
        guest: { full_name: "Ada Lovelace" },
      };
      mockReservations.mockResolvedValue([booking]);
      mockMessages.mockResolvedValue([
        { id: 4001, body: "Merhaba", sender_type: "guest", sender_role: "guest", created_at: "2023-01-01T09:00:00Z" },
      ]);
      await syncHospitable(orgId);
      const res = await prisma.reservation.findFirstOrThrow({
        where: { property: { organizationId: orgId }, sourceReference: "res-old-1" },
      });
      const conv = await prisma.conversation.findFirstOrThrow({
        where: { propertyId: res.propertyId, externalReservationId: "res-old-1" },
      });

      // An app-sent reply from back then that never got a provider id, whose body
      // the retention sweep has since REDACTED (name → [Misafir]).
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          direction: "outbound",
          senderName: "Owner",
          body: "Merhaba [Misafir], kapı kodu 1234.",
          externalId: null,
          createdAt: new Date("2023-01-01T10:00:00Z"),
        },
      });
      // The retention sweep anonymized the stay itself.
      await prisma.reservation.update({
        where: { id: res.id },
        data: { guestName: "Eski misafir", guestEmail: null, guestPhone: null },
      });
      await prisma.conversation.update({ where: { id: conv.id }, data: { guestIdentifier: "Misafir" } });

      // A deep re-fetch returns the ORIGINAL (pre-redaction) outbound text with its
      // provider id, plus a genuinely-new in-window message. The old outbound must
      // NOT be re-created (adopt misses — the local body is redacted — and creating
      // it would resurrect the guest name); the new message still imports.
      mockReservations.mockResolvedValue([{ ...booking, last_message_at: new Date().toISOString() }]);
      mockMessages.mockResolvedValue([
        { id: 4001, body: "Merhaba", sender_type: "guest", sender_role: "guest", created_at: "2023-01-01T09:00:00Z" },
        { id: 4002, body: "Merhaba Ada Lovelace, kapı kodu 1234.", sender_type: "host", sender_role: "host", created_at: "2023-01-01T10:00:00Z" },
        { id: 4003, body: "Yeni bir sorum var", sender_type: "guest", sender_role: "guest", created_at: new Date().toISOString() },
      ]);
      await syncHospitable(orgId);

      const rows = await prisma.message.findMany({ where: { conversationId: conv.id } });
      expect(rows.some((r) => r.body.includes("Ada Lovelace"))).toBe(false); // no resurrection
      expect(rows.filter((r) => r.direction === "outbound")).toHaveLength(1); // no duplicate of the redacted reply
      expect(rows.find((r) => r.externalId === "4003")).toBeTruthy(); // new data still flows
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("adopts the real guest name on a later sync when the first import had only the 'Misafir' placeholder", async () => {
    // Regression guard: the resurrection guard must key off the reservation's
    // DISTINCT ANON_NAME sentinel, not conversation.guestIdentifier === ANON_ID
    // ("Misafir") — which is ALSO the no-name placeholder. Otherwise a thread first
    // imported without a resolvable name is frozen at "Misafir" forever.
    const { orgId } = await makeOrgWithProperty();
    mockProperties.mockResolvedValue([{ id: "hosp-prop-1", name: "Test Property" }]);
    // First sync: no guest record, no booking code, sender carries no name → the
    // only fallback is the "Misafir" placeholder (== ANON_ID, but NOT anonymized).
    const base = {
      id: "res-ph-1",
      platform: "airbnb",
      arrival_date: "2026-06-10",
      departure_date: "2026-06-14",
      conversation_id: "conv-ph-1",
      last_message_at: "2026-06-09T10:00:00Z",
    };
    mockReservations.mockResolvedValue([base]);
    mockMessages.mockResolvedValue([
      { id: 3001, body: "Merhaba", sender_type: "guest", sender_role: "guest", sender: {}, created_at: "2026-06-09T10:00:00Z" },
    ]);
    await syncHospitable(orgId);

    let conv = await prisma.conversation.findFirst({ where: { externalReservationId: "res-ph-1" } });
    expect(conv?.guestIdentifier).toBe("Misafir"); // placeholder, NOT anonymized

    // Later sync: the guest record now carries the real name + a genuinely-new message.
    mockReservations.mockResolvedValue([
      { ...base, last_message_at: "2026-06-10T09:00:00Z", guest: { full_name: "Zeynep Kaya" } },
    ]);
    mockMessages.mockResolvedValue([
      { id: 3001, body: "Merhaba", sender_type: "guest", sender_role: "guest", sender: {}, created_at: "2026-06-09T10:00:00Z" },
      { id: 3002, body: "Adım Zeynep", sender_type: "guest", sender_role: "guest", sender: { full_name: "Zeynep Kaya" }, created_at: "2026-06-10T09:00:00Z" },
    ]);
    await syncHospitable(orgId);

    // The placeholder is now replaced by the real name (not frozen at "Misafir").
    conv = await prisma.conversation.findFirst({ where: { externalReservationId: "res-ph-1" } });
    expect(conv?.guestIdentifier).toBe("Zeynep Kaya");
  });

  it("does NOT skip a thread when lastMessageAt was stamped past a new guest message (message-loss guard)", async () => {
    const { orgId } = await makeOrgWithProperty();
    mockProperties.mockResolvedValue([{ id: "hosp-prop-1", name: "Test Property" }]);

    // First sync: one guest message (09:00) + our host reply (10:00).
    mockReservations.mockResolvedValue([
      { id: "res-9", code: "HMLOSS", platform: "airbnb", conversation_id: "conv-9",
        conversation_language: "en", last_message_at: "2026-06-01T10:00:00Z" },
    ]);
    mockMessages.mockResolvedValue([
      { id: 2001, body: "Is early check-in possible?", sender_type: "guest", sender_role: "guest",
        sender: { full_name: "Sam Guest" }, created_at: "2026-06-01T09:00:00Z" },
      { id: 2002, body: "Yes, from 13:00.", sender_type: "host", sender_role: "host",
        sender: { full_name: "Host" }, created_at: "2026-06-01T10:00:00Z" },
    ]);
    await syncHospitable(orgId);

    // The sync set the outbound-immune cursor to the provider's last_message_at.
    const conv = await prisma.conversation.findFirst({ where: { externalReservationId: "res-9" } });
    expect(conv?.syncCursorAt?.toISOString()).toBe("2026-06-01T10:00:00.000Z");

    // Simulate an outbound path (auto-reply/manual/outbox) stamping lastMessageAt
    // with a FUTURE wall-clock time. Outbound touches ONLY lastMessageAt, never
    // syncCursorAt — so the skip-check cursor stays clean at 10:00.
    await prisma.conversation.update({
      where: { id: conv!.id },
      data: { lastMessageAt: new Date("2026-06-01T23:00:00Z") },
    });

    // Second sync: a NEW guest message at 11:00 — AFTER the cursor (10:00) but
    // BEFORE the polluted lastMessageAt (23:00). A lastMessageAt-based skip-check
    // would drop it; the syncCursorAt-based one imports it.
    mockReservations.mockResolvedValue([
      { id: "res-9", code: "HMLOSS", platform: "airbnb", conversation_id: "conv-9",
        conversation_language: "en", last_message_at: "2026-06-01T11:00:00Z" },
    ]);
    mockMessages.mockResolvedValue([
      { id: 2001, body: "Is early check-in possible?", sender_type: "guest", sender_role: "guest",
        sender: { full_name: "Sam Guest" }, created_at: "2026-06-01T09:00:00Z" },
      { id: 2002, body: "Yes, from 13:00.", sender_type: "host", sender_role: "host",
        sender: { full_name: "Host" }, created_at: "2026-06-01T10:00:00Z" },
      { id: 2003, body: "Great, we will arrive at 13:30.", sender_type: "guest", sender_role: "guest",
        sender: { full_name: "Sam Guest" }, created_at: "2026-06-01T11:00:00Z" },
    ]);
    const result = await syncHospitable(orgId);

    expect(result.skipped).toBe(0); // NOT skipped despite the future lastMessageAt
    const msg = await prisma.message.findFirst({ where: { externalId: "2003" } });
    expect(msg?.body).toBe("Great, we will arrive at 13:30."); // the guest message survived
    // Cursor advanced to the new provider timestamp; lastMessageAt stays as UI set it.
    const after = await prisma.conversation.findFirst({ where: { externalReservationId: "res-9" } });
    expect(after?.syncCursorAt?.toISOString()).toBe("2026-06-01T11:00:00.000Z");
  });

  it("does NOT advance the cursor when a message write throws mid-loop on a NEW single-message thread (retries, no loss)", async () => {
    const { orgId } = await makeOrgWithProperty();
    mockProperties.mockResolvedValue([{ id: "hosp-prop-1", name: "Test Property" }]);
    // Single-message thread → createCursor === incomingLast (both 10:00): the row
    // would be "current" the instant it's created if the create wrote the cursor.
    mockReservations.mockResolvedValue([
      { id: "res-loss2", code: "HM1", platform: "airbnb", conversation_id: "c1",
        conversation_language: "en", last_message_at: "2026-06-02T10:00:00Z" },
    ]);
    mockMessages.mockResolvedValue([
      { id: 3001, body: "Tek mesaj", sender_type: "guest", sender_role: "guest",
        sender: { full_name: "Deniz" }, created_at: "2026-06-02T10:00:00Z" },
    ]);

    // First sync: force the message write to throw ONCE, mid-loop (after the
    // conversation row is created). importThread throws → caught per-reservation.
    // Later calls delegate to the REAL create (mockImplementation) so the second
    // sync below writes for real. (No mockRestore — restoring a Prisma delegate
    // method breaks it; this is the last test in the file so the spy can't leak.)
    const realCreate = prisma.message.create.bind(prisma.message);
    vi.spyOn(prisma.message, "create")
      .mockRejectedValueOnce(new Error("db blip"))
      .mockImplementation(((a: Parameters<typeof realCreate>[0]) => realCreate(a)) as never);
    await syncHospitable(orgId);

    const conv = await prisma.conversation.findFirst({ where: { externalReservationId: "res-loss2" } });
    expect(conv).not.toBeNull(); // the conversation row was created
    expect(conv?.syncCursorAt).toBeNull(); // ← the fix: cursor NOT advanced (message unwritten)

    // Second sync: the write succeeds now → the thread is NOT skipped (null cursor)
    // and the message is finally imported.
    const result = await syncHospitable(orgId);
    expect(result.skipped).toBe(0);
    const msg = await prisma.message.findFirst({ where: { conversationId: conv!.id, externalId: "3001" } });
    expect(msg?.body).toBe("Tek mesaj"); // the message survived the mid-loop failure
    const healed = await prisma.conversation.findFirst({ where: { externalReservationId: "res-loss2" } });
    expect(healed?.syncCursorAt?.toISOString()).toBe("2026-06-02T10:00:00.000Z"); // now advanced
  });

  it("KVKK: CREATE branch does NOT resurrect PII when the linked stay is already scrubbed (no prior conversation)", async () => {
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
    try {
      const { orgId, propertyId } = await makeOrgWithProperty();
      // The retention sweep already anonymized this OLD stay; crucially NO conversation
      // row exists yet, so importThread takes the CREATE branch (not UPDATE). Without
      // the CREATE-branch guard the sync would write the channel's real name + re-import
      // the old body → PII resurrection.
      await prisma.reservation.create({
        data: {
          propertyId,
          guestName: ANON_NAME, // scrubbed sentinel
          arrivalDate: new Date("2023-01-01"),
          departureDate: new Date("2023-01-04"),
          channel: "booking",
          status: "confirmed",
          sourceReference: "res-crscrub",
        },
      });
      mockProperties.mockResolvedValue([{ id: "hosp-prop-1", name: "Test Property" }]);
      mockReservations.mockResolvedValue([
        { id: "res-crscrub", platform: "booking", arrival_date: "2023-01-01", departure_date: "2023-01-04",
          conversation_id: "conv-cr", last_message_at: "2023-01-02T10:00:00Z",
          guest: { full_name: "Ada Lovelace" } }, // the channel STILL has the real name
      ]);
      mockMessages.mockResolvedValue([
        { id: 5001, body: "Merhaba, ben Ada Lovelace", sender_type: "guest", sender_role: "guest", created_at: "2023-01-01T09:00:00Z" },
      ]);

      await syncHospitable(orgId);

      const conv = await prisma.conversation.findFirstOrThrow({
        where: { propertyId, externalReservationId: "res-crscrub" },
      });
      expect(conv.guestIdentifier).toBe(ANON_ID); // placeholder written, NOT the real name
      // The pre-cutoff message must NOT re-import (era filter engages on CREATE too).
      const msgs = await prisma.message.findMany({ where: { conversationId: conv.id } });
      expect(msgs.some((m) => m.body.includes("Ada Lovelace"))).toBe(false); // no resurrection
      expect(msgs).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
