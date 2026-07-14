import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { enqueueProactive } from "@/lib/outbox/enqueue";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";

// FAZ 1 — welcome / check-in / check-out (proactive) + holding-ack wired to the durable outbox.
// The provider transport + token are mocked; the sender loops (sendDue*) are exercised with the
// flag ON so the enqueue → worker-delivers → *SentAt-stamp-on-delivery contract is covered E2E.
vi.mock("@/lib/messaging", () => ({ sendOnChannel: vi.fn() }));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));

import { sendOnChannel } from "@/lib/messaging";
import { sendDueWelcomes } from "@/lib/automation";

const mockSend = vi.mocked(sendOnChannel);
const okDeliver = () => {
  let calls = 0;
  const send: OutboxSendFn = async () => ({ ok: true, providerMessageId: `p${++calls}` });
  return { send, calls: () => calls };
};

/** Seed an org + property with a "welcome" KB entry and one confirmed, near-future booking. */
async function seedWelcome(opts: { source?: string; welcomeSentAt?: Date | null } = {}) {
  const org = await prisma.organization.create({
    data: { name: "Org", autoWelcome: true, autoWelcomeEnabledAt: new Date(0), aiSignature: "İsa" },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "nuve 3" } });
  await prisma.knowledgeBaseItem.create({
    data: { propertyId: property.id, category: "welcome", title: "K", content: "Merhaba {isim}" },
  });
  const source = opts.source ?? "res-src-1";
  const arrival = new Date(Date.now() + 3 * 86_400_000);
  const r = await prisma.reservation.create({
    data: {
      propertyId: property.id, guestName: "Bircan", arrivalDate: arrival,
      departureDate: new Date(arrival.getTime() + 2 * 86_400_000), channel: "airbnb",
      status: "confirmed", sourceReference: source, welcomeSentAt: opts.welcomeSentAt ?? null,
    },
  });
  return { orgId: org.id, propertyId: property.id, reservationId: r.id, source };
}

describe("outbox lifecycle (FAZ 1) — flag ON", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("welcome: ENQUEUES (no inline send, no Message, welcomeSentAt NOT stamped); worker delivers → stamped", async () => {
    const { orgId, source } = await seedWelcome();
    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(1);
    expect(mockSend).not.toHaveBeenCalled(); // NOT delivered inline

    const row = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(row.messageType).toBe("welcome");
    expect(row.conversationId).toBeNull(); // proactive: no thread
    expect(row.messageId).toBeNull(); //      proactive: no local Message
    expect(row.externalReservationId).toBe(source);
    expect(row.status).toBe("pending");
    // #6/FAZ1: welcomeSentAt is NOT stamped at enqueue.
    expect((await prisma.reservation.findFirstOrThrow({ where: { sourceReference: source } })).welcomeSentAt).toBeNull();

    // Worker delivers → welcomeSentAt stamped NOW.
    const { send, calls } = okDeliver();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(calls()).toBe(1);
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } })).status).toBe("sent");
    expect((await prisma.reservation.findFirstOrThrow({ where: { sourceReference: source } })).welcomeSentAt).toBeInstanceOf(Date);
  });

  it("scheduler replay: re-running the sender before delivery does NOT enqueue a second welcome", async () => {
    const { orgId } = await seedWelcome();
    await sendDueWelcomes(orgId);
    const second = await sendDueWelcomes(orgId); // replay — welcomeSentAt still null
    expect(second.sent).toBe(0); // deduped, not counted again
    expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(1); // still ONE row
  });

  it("lifecycle veto: a CANCELLED booking → canceled, ZERO provider calls", async () => {
    const { orgId, source } = await seedWelcome();
    await sendDueWelcomes(orgId);
    await prisma.reservation.updateMany({ where: { sourceReference: source }, data: { status: "cancelled" } });
    const { send, calls } = okDeliver();
    const res = await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(calls()).toBe(0);
    expect(res.canceled).toBe(1);
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } })).status).toBe("canceled");
  });

  it("lifecycle veto: an already-delivered welcome (welcomeSentAt set) → canceled, no double-send", async () => {
    const { orgId, source } = await seedWelcome();
    await sendDueWelcomes(orgId);
    // Simulate the stamp already set (a prior delivery) between enqueue and this drain.
    await prisma.reservation.updateMany({ where: { sourceReference: source }, data: { welcomeSentAt: new Date() } });
    const { send, calls } = okDeliver();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(calls()).toBe(0);
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } })).status).toBe("canceled");
  });

  it("tenant isolation: delivering org A's welcome never stamps org B's reservation", async () => {
    const a = await seedWelcome({ source: "shared-src" });
    const b = await seedWelcome({ source: "shared-src" }); // different org, SAME sourceReference value
    await sendDueWelcomes(a.orgId);
    const { send } = okDeliver();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    // A stamped, B untouched (updateMany scoped by property.organizationId).
    expect((await prisma.reservation.findFirstOrThrow({ where: { id: a.reservationId } })).welcomeSentAt).toBeInstanceOf(Date);
    expect((await prisma.reservation.findFirstOrThrow({ where: { id: b.reservationId } })).welcomeSentAt).toBeNull();
  });

  it("holding_ack delivery effect: the thread STAYS 'problem' (never marked answered)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await prisma.conversation.create({
      data: { propertyId, channel: "airbnb", guestIdentifier: "G", status: "problem", externalReservationId: "res-h" },
    });
    const m = await prisma.message.create({
      data: { conversationId: c.id, direction: "outbound", authorType: "ai", senderName: "GuestOps AI", body: "ack" },
    });
    await prisma.messageOutbox.create({
      data: {
        organizationId: orgId, conversationId: c.id, messageId: m.id, channel: "airbnb",
        externalReservationId: "res-h", messageType: "holding_ack", body: "ack",
        idempotencyKey: "h1", status: "pending",
      },
    });
    const { send, calls } = okDeliver();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(calls()).toBe(1); // delivered
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } })).status).toBe("sent");
    // deliveryEffect for holding_ack is NONE → the host still owns the thread.
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("problem");
  });

  it("proactive enqueue is idempotent on the deterministic key (replay/restart safe)", async () => {
    const { orgId, reservationId } = await seedWelcome();
    const args = {
      organizationId: orgId, reservationId, externalReservationId: "res-src-1", channel: "airbnb",
      messageType: "welcome" as const, body: "x", idempotencyKey: "welcome:k",
    };
    const a = await enqueueProactive(args);
    const b = await enqueueProactive(args); // replay
    expect(a.deduped).toBe(false);
    expect(b.deduped).toBe(true);
    expect(b.outboxId).toBe(a.outboxId);
    expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(1);
  });
});

describe("outbox lifecycle (FAZ 1) — flag OFF: the proven inline path is unchanged", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    // DURABLE_OUTBOX_ENABLED unset → OFF.
    mockSend.mockResolvedValue({ ok: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("welcome (flag OFF): delivers inline via sendOnChannel and stamps welcomeSentAt at the claim — no outbox row", async () => {
    const { orgId, source } = await seedWelcome();
    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1); // inline send
    expect((await prisma.reservation.findFirstOrThrow({ where: { sourceReference: source } })).welcomeSentAt).toBeInstanceOf(Date);
    expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(0); // NO outbox row
  });
});
