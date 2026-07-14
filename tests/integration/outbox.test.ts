import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { enqueueOutbound } from "@/lib/outbox/enqueue";
import { drainOutboxOnce, type OutboxSendFn, type OutboxReconcileFn } from "@/lib/outbox/worker";
import { OUTBOX_MAX_ATTEMPTS } from "@/lib/outbox/state";

async function makeConvo(propertyId: string) {
  return prisma.conversation.create({
    data: {
      propertyId,
      channel: "airbnb",
      guestIdentifier: "Guest",
      status: "new",
      externalReservationId: "res-uuid-1",
    },
  });
}

const baseArgs = (organizationId: string, conversationId: string, over: Partial<Parameters<typeof enqueueOutbound>[0]> = {}) => ({
  organizationId,
  conversationId,
  channel: "airbnb",
  externalReservationId: "res-uuid-1",
  reservationId: null,
  body: "Merhaba!",
  senderName: "Ayşe",
  authorType: "host" as const,
  idempotencyKey: "key-1",
  ...over,
});

const outbox = (id: string) => prisma.messageOutbox.findUniqueOrThrow({ where: { id } });
const okSend = (id = "prov-1"): OutboxSendFn => vi.fn(async () => ({ ok: true, providerMessageId: id }));

describe("outbox — atomic enqueue + tenant-scoped idempotency", () => {
  beforeEach(resetDb);

  it("writes the Message AND the outbox intent in ONE transaction (message has no externalId yet)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await makeConvo(propertyId);
    const r = await enqueueOutbound(baseArgs(orgId, c.id));
    expect(r.deduped).toBe(false);

    const msg = await prisma.message.findUniqueOrThrow({ where: { id: r.messageId } });
    expect(msg).toMatchObject({ direction: "outbound", authorType: "host", body: "Merhaba!", externalId: null });
    const ob = await outbox(r.outboxId);
    expect(ob).toMatchObject({ status: "pending", messageId: r.messageId, organizationId: orgId, attemptCount: 0 });
    // The intent durably records "answered" only after the row exists.
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("answered");
  });

  it("dedupes a repeated idempotencyKey — ONE outbox row, ONE message, no orphan", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await makeConvo(propertyId);
    const a = await enqueueOutbound(baseArgs(orgId, c.id));
    const b = await enqueueOutbound(baseArgs(orgId, c.id, { body: "different text, same key" }));
    expect(b.deduped).toBe(true);
    expect(b.outboxId).toBe(a.outboxId);
    expect(await prisma.messageOutbox.count()).toBe(1);
    expect(await prisma.message.count({ where: { conversationId: c.id } })).toBe(1); // rollback → no orphan
  });

  it("keeps two tenants' identical idempotencyKeys separate (no cross-tenant dedup)", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    const ca = await makeConvo(a.propertyId);
    const cb = await makeConvo(b.propertyId);
    await enqueueOutbound(baseArgs(a.orgId, ca.id, { idempotencyKey: "same" }));
    await enqueueOutbound(baseArgs(b.orgId, cb.id, { idempotencyKey: "same" }));
    expect(await prisma.messageOutbox.count()).toBe(2);
  });
});

describe("outbox worker — send, concurrency, crash points", () => {
  beforeEach(resetDb);

  async function enqueueOne(over: Partial<Parameters<typeof enqueueOutbound>[0]> = {}) {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await makeConvo(propertyId);
    const r = await enqueueOutbound(baseArgs(orgId, c.id, over));
    return { orgId, conversationId: c.id, ...r };
  }

  it("sends a pending row once → sent, links providerMessageId onto the Message", async () => {
    const { outboxId, messageId } = await enqueueOne();
    const send = okSend("PROV-9");
    const res = await drainOutboxOnce({ send, tokenFor: async () => "tok" });
    expect(res).toMatchObject({ claimed: 1, sent: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await outbox(outboxId)).toMatchObject({ status: "sent", providerMessageId: "PROV-9", claimedBy: null });
    expect((await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).externalId).toBe("PROV-9");
  });

  it("TWO concurrent workers claim the SAME row exactly once (FOR UPDATE SKIP LOCKED)", async () => {
    await enqueueOne();
    let calls = 0;
    const send: OutboxSendFn = async () => {
      calls++;
      return { ok: true, providerMessageId: "P" };
    };
    // Real DB race: two drains run concurrently against the same test database.
    const [a, b] = await Promise.all([
      drainOutboxOnce({ send, tokenFor: async () => "t" }),
      drainOutboxOnce({ send, tokenFor: async () => "t" }),
    ]);
    expect(a.claimed + b.claimed).toBe(1); // exactly one worker claimed it
    expect(calls).toBe(1); // exactly one provider send
    expect(await prisma.messageOutbox.count({ where: { status: "sent" } })).toBe(1);
  });

  it("a definitive 4xx failure retries with backoff, then goes terminal 'failed' at the ceiling", async () => {
    const { outboxId } = await enqueueOne();
    const send: OutboxSendFn = async () => ({ ok: false, error: "Hospitable API hatası (HTTP 400)" });
    let clock = Date.now();
    const now = () => new Date(clock);
    // First attempt: definitive failure, not exhausted → back to pending (retry), future availableAt.
    await drainOutboxOnce({ send, tokenFor: async () => "t", now });
    let row = await outbox(outboxId);
    expect(row.status).toBe("pending");
    expect(row.attemptCount).toBe(1);
    expect(row.availableAt.getTime()).toBeGreaterThan(clock); // backing off
    // Drive attemptCount to the ceiling, advancing the clock past each backoff.
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 2; i++) {
      clock += 60 * 60_000; // +1h ≫ the 30m backoff cap
      await drainOutboxOnce({ send, tokenFor: async () => "t", now });
    }
    row = await outbox(outboxId);
    expect(row.status).toBe("failed"); // terminal
    expect(row.lastErrorKind).toBe("definitive_failure");
  });

  it("an AMBIGUOUS result is NEVER blind-resent — it holds ambiguous, then reconciles", async () => {
    const { outboxId } = await enqueueOne();
    const send = vi.fn<OutboxSendFn>(async () => ({ ok: false, error: "HTTP 500 server error" }));
    let clock = Date.now();
    const now = () => new Date(clock);
    await drainOutboxOnce({ send, tokenFor: async () => "t", now });
    expect(await outbox(outboxId)).toMatchObject({ status: "ambiguous", lastErrorKind: "ambiguous" });
    expect(send).toHaveBeenCalledTimes(1);

    // Reconcile: the provider history DOES contain it → sent, WITHOUT another send call.
    clock += 60 * 60_000;
    const reconcile: OutboxReconcileFn = async () => ({ found: true, providerMessageId: "RC-1" });
    await drainOutboxOnce({ send, reconcile, tokenFor: async () => "t", now });
    expect(send).toHaveBeenCalledTimes(1); // NEVER re-sent
    expect(await outbox(outboxId)).toMatchObject({ status: "sent", providerMessageId: "RC-1" });
  });

  it("reconcile that never finds it → parked for manual 'review' (never blind-resent)", async () => {
    const { outboxId } = await enqueueOne();
    const send = vi.fn<OutboxSendFn>(async () => ({ ok: false, error: "network reset" }));
    const reconcile: OutboxReconcileFn = async () => ({ found: false });
    let clock = Date.now();
    const now = () => new Date(clock);
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 3; i++) {
      await drainOutboxOnce({ send, reconcile, tokenFor: async () => "t", now });
      clock += 60 * 60_000;
    }
    expect(await outbox(outboxId)).toMatchObject({ status: "review" });
    expect(send).toHaveBeenCalledTimes(1); // one attempt ever; reconcile is read-only
  });

  it("recovers a crashed-mid-attempt claim (stale 'sending' → ambiguous), no blind resend", async () => {
    const { outboxId } = await enqueueOne();
    // Worker claims + then "crashes": the send throws, poison isolation leaves the row
    // claimed ('sending') with a claim window.
    const throwingSend: OutboxSendFn = async () => {
      throw new Error("process died mid-send");
    };
    let clock = Date.now();
    const now = () => new Date(clock);
    await drainOutboxOnce({ send: throwingSend, tokenFor: async () => "t", now });
    expect((await outbox(outboxId)).status).toBe("sending"); // stuck claimed

    // A later pass (now past the claim window) recovers it to ambiguous — NOT re-sent.
    clock += 60 * 60_000; // ≫ the 5-min claim TTL
    const send2 = vi.fn<OutboxSendFn>(async () => ({ ok: true, providerMessageId: "X" }));
    const reconcile: OutboxReconcileFn = async () => ({ found: false });
    await drainOutboxOnce({ send: send2, reconcile, tokenFor: async () => "t", now });
    // recovered → ambiguous, then reconcile ran (read-only). The real send was never called.
    expect(send2).not.toHaveBeenCalled();
    expect(["ambiguous", "review"]).toContain((await outbox(outboxId)).status);
  });

  it("one poison row does not stop the rest of the batch", async () => {
    const good = await enqueueOne({ idempotencyKey: "good" });
    const bad = await enqueueOne({ idempotencyKey: "bad" });
    const send: OutboxSendFn = async (row) => {
      if (row.id === bad.outboxId) throw new Error("boom");
      return { ok: true, providerMessageId: "ok" };
    };
    await drainOutboxOnce({ send, tokenFor: async () => "t", batchSize: 10 });
    expect((await outbox(good.outboxId)).status).toBe("sent"); // the healthy row still went
    expect((await outbox(bad.outboxId)).status).toBe("sending"); // poison row left claimed → recovered later
  });

  it("each tenant's row is sent via ITS OWN token", async () => {
    const a = await enqueueOne({ idempotencyKey: "a" });
    const b = await enqueueOne({ idempotencyKey: "b" });
    const seen: Record<string, string | undefined> = {};
    const send: OutboxSendFn = async (row, token) => {
      seen[row.organizationId] = token;
      return { ok: true, providerMessageId: "p" };
    };
    await drainOutboxOnce({ send, tokenFor: async (orgId) => `token-for-${orgId}`, batchSize: 10 });
    expect(seen[a.orgId]).toBe(`token-for-${a.orgId}`);
    expect(seen[b.orgId]).toBe(`token-for-${b.orgId}`);
    expect(seen[a.orgId]).not.toBe(seen[b.orgId]);
  });
});
