import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { enqueueOutbound } from "@/lib/outbox/enqueue";
import { drainOutboxOnce, hasDrainableOutbox, OUTBOX_CLAIM_LOCK_KEY, type OutboxSendFn, type OutboxReconcileFn } from "@/lib/outbox/worker";
import { Prisma } from "@prisma/client";
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
    // #6: enqueue does NOT mark the thread answered — that happens on confirmed delivery.
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("new");
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

  it("the payload carries ONLY send-necessary fields — no token/credential/PII slot (KVKK)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await makeConvo(propertyId);
    const r = await enqueueOutbound(baseArgs(orgId, c.id, { body: "gizli olmayan mesaj" }));
    const row = await outbox(r.outboxId);
    // No column that could hold a secret (idempotencyKey is a dedup id, not a credential).
    const forbidden = Object.keys(row).filter((k) => /token|auth|pepper|password|secret|credential|\bpin\b/i.test(k));
    expect(forbidden).toEqual([]);
    expect(row.body).toBe("gizli olmayan mesaj"); // body = the message text itself (allowed)
  });

  it("deleting the org CASCADE-purges its outbox (KVKK / account erasure)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await makeConvo(propertyId);
    await enqueueOutbound(baseArgs(orgId, c.id));
    expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(1);
    await prisma.organization.delete({ where: { id: orgId } });
    expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(0);
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

describe("outbox Faz-B — Codex #1/#2/#4/#6/#7", () => {
  beforeEach(resetDb);

  // Enqueue two rows in the SAME conversation with a DETERMINISTIC order (a before b).
  async function twoInOneConvo() {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await makeConvo(propertyId);
    const a = await enqueueOutbound(baseArgs(orgId, c.id, { idempotencyKey: "k1", body: "1" }));
    const b = await enqueueOutbound(baseArgs(orgId, c.id, { idempotencyKey: "k2", body: "2" }));
    await prisma.messageOutbox.update({ where: { id: a.outboxId }, data: { createdAt: new Date(Date.now() - 2000) } });
    await prisma.messageOutbox.update({ where: { id: b.outboxId }, data: { createdAt: new Date(Date.now() - 1000) } });
    return { orgId, conversationId: c.id, a, b };
  }

  it("#1: hasDrainableOutbox tracks the queue — the worker drains regardless of the enqueue flag", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await makeConvo(propertyId);
    expect(await hasDrainableOutbox()).toBe(false);
    const r = await enqueueOutbound(baseArgs(orgId, c.id));
    expect(await hasDrainableOutbox()).toBe(true); // scheduler drains even with flag OFF → no stranded rows
    await drainOutboxOnce({ send: okSend(), tokenFor: async () => "t" }); // worker never reads the flag
    expect((await outbox(r.outboxId)).status).toBe("sent");
    expect(await hasDrainableOutbox()).toBe(false);
  });

  it("#2 FIFO: with two queued rows for ONE conversation, only the EARLIEST is claimed", async () => {
    const { a, b } = await twoInOneConvo();
    const send = vi.fn<OutboxSendFn>(async () => ({ ok: true, providerMessageId: "p" }));
    const res = await drainOutboxOnce({ send, tokenFor: async () => "t", batchSize: 10 });
    expect(res.claimed).toBe(1); // only one row of the conversation
    expect(send).toHaveBeenCalledTimes(1);
    expect((await outbox(a.outboxId)).status).toBe("sent"); // the earliest
    expect((await outbox(b.outboxId)).status).toBe("pending"); // waits for the first to resolve
  });

  it("#2 single-flight: TWO concurrent workers send at most ONE message of one thread", async () => {
    const { a, b } = await twoInOneConvo();
    let calls = 0;
    const send: OutboxSendFn = async () => {
      calls++;
      return { ok: true, providerMessageId: "p" };
    };
    await Promise.all([
      drainOutboxOnce({ send, tokenFor: async () => "t", batchSize: 10 }),
      drainOutboxOnce({ send, tokenFor: async () => "t", batchSize: 10 }),
    ]);
    expect(calls).toBe(1); // no parallel/duplicate send of the same conversation
    expect((await outbox(a.outboxId)).status).toBe("sent");
    expect((await outbox(b.outboxId)).status).toBe("pending");
  });

  it("#2 order: the second row is delivered only AFTER the first, in order", async () => {
    const { a, b } = await twoInOneConvo();
    const order: string[] = [];
    const send: OutboxSendFn = async (row) => {
      order.push(row.body);
      return { ok: true, providerMessageId: "p" };
    };
    await drainOutboxOnce({ send, tokenFor: async () => "t", batchSize: 10 }); // sends "1"
    expect((await outbox(b.outboxId)).status).toBe("pending"); // "2" still waiting
    await drainOutboxOnce({ send, tokenFor: async () => "t", batchSize: 10 }); // now sends "2"
    expect(order).toEqual(["1", "2"]);
    expect((await outbox(a.outboxId)).status).toBe("sent");
    expect((await outbox(b.outboxId)).status).toBe("sent");
    void a;
  });

  it("#4: ambiguous with the DEFAULT (conservative) reconcile → manual review, NEVER auto-sent", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await makeConvo(propertyId);
    const r = await enqueueOutbound(baseArgs(orgId, c.id));
    const send = vi.fn<OutboxSendFn>(async () => ({ ok: false, error: "HTTP 500 server error" }));
    let clock = Date.now();
    const now = () => new Date(clock);
    // NO injected reconcile → the production defaultReconcile (no reliable provider match).
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 3; i++) {
      await drainOutboxOnce({ send, tokenFor: async () => "t", now });
      clock += 60 * 60_000;
    }
    expect((await outbox(r.outboxId)).status).toBe("review"); // parked, not falsely "sent"
    expect(send).toHaveBeenCalledTimes(1); // one attempt ever; reconcile is read-only + conservative
  });

  it("#6: the conversation becomes 'answered' ONLY after the worker confirms delivery", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await makeConvo(propertyId); // status "new"
    const r = await enqueueOutbound(baseArgs(orgId, c.id));
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("new"); // NOT at enqueue
    await drainOutboxOnce({ send: okSend(), tokenFor: async () => "t" });
    expect((await outbox(r.outboxId)).status).toBe("sent");
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("answered"); // on delivery
  });

  it("#7: one tenant's failing send does not block another tenant's queue", async () => {
    const bad = await makeOrgWithProperty();
    const good = await makeOrgWithProperty();
    const cb = await makeConvo(bad.propertyId);
    const cg = await makeConvo(good.propertyId);
    await enqueueOutbound(baseArgs(bad.orgId, cb.id, { idempotencyKey: "bad" }));
    const g = await enqueueOutbound(baseArgs(good.orgId, cg.id, { idempotencyKey: "good" }));
    const send: OutboxSendFn = async (row) =>
      row.organizationId === bad.orgId
        ? { ok: false, error: "Hospitable API hatası (HTTP 402)" } // bad org: subscription not active
        : { ok: true, providerMessageId: "ok" };
    await drainOutboxOnce({ send, tokenFor: async () => "t", batchSize: 10 });
    expect((await outbox(g.outboxId)).status).toBe("sent"); // healthy tenant delivered despite the other's 402
  });
});

describe("outbox Codex P1/P2 — reservation rate limit + AI send-time veto", () => {
  beforeEach(resetDb);

  // N outbox rows for ONE (org, reservation) but N DIFFERENT conversations — so the
  // per-CONVERSATION single-in-flight guard does NOT serialize them; only the per-
  // RESERVATION rate cap can. Deterministic order m0 < m1 < … .
  async function nForOneReservation(n: number) {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const rows = [];
    for (let i = 0; i < n; i++) {
      const c = await prisma.conversation.create({
        data: { propertyId, channel: "airbnb", guestIdentifier: `G${i}`, status: "new", externalReservationId: "res-shared" },
      });
      const r = await enqueueOutbound(
        baseArgs(orgId, c.id, { idempotencyKey: `k${i}`, externalReservationId: "res-shared", body: `m${i}` }),
      );
      await prisma.messageOutbox.update({
        where: { id: r.outboxId },
        data: { createdAt: new Date(Date.now() - (n - i) * 1000) },
      });
      rows.push(r);
    }
    return { orgId, rows };
  }

  it("P1: with 4 ready rows for one reservation, ≤2 provider sends in the first 60s window", async () => {
    const { rows } = await nForOneReservation(4);
    let calls = 0;
    const send: OutboxSendFn = async () => ({ ok: true, providerMessageId: `p${++calls}` });
    let clock = Date.now();
    const now = () => new Date(clock);

    // Window 1: exactly 2 of the 4 ready rows go; the other 2 are rate-deferred.
    await drainOutboxOnce({ send, tokenFor: async () => "t", batchSize: 10, now });
    expect(calls).toBe(2);
    const s1 = await Promise.all(rows.map((r) => outbox(r.outboxId)));
    expect(s1.filter((r) => r.status === "sent")).toHaveLength(2);
    expect(s1.filter((r) => r.status === "pending")).toHaveLength(2);

    // +30s (still window 1): no extra provider call.
    clock += 30_000;
    await drainOutboxOnce({ send, tokenFor: async () => "t", batchSize: 10, now });
    expect(calls).toBe(2);

    // +61s from the first sends (window 2): the remaining 2 go — still ≤2 per window.
    clock += 31_000;
    await drainOutboxOnce({ send, tokenFor: async () => "t", batchSize: 10, now });
    expect(calls).toBe(4);
    expect((await Promise.all(rows.map((r) => outbox(r.outboxId)))).every((r) => r.status === "sent")).toBe(true);
  });

  it("P1 atomic: while a SECOND connection holds the claim lock, the worker claims 0 (real 2-conn barrier)", async () => {
    // 4 ready rows for one reservation. A separate DB connection holds the shared claim
    // advisory lock; while it is held, a concurrent worker MUST claim nothing (it cannot
    // race the rate count). This proves the cap is atomic across connections, not just via
    // Promise.all timing. Then, lock released, the worker claims exactly the 2-per-window cap.
    const { rows } = await nForOneReservation(4);
    let calls = 0;
    const send: OutboxSendFn = async () => ({ ok: true, providerMessageId: `p${++calls}` });

    let signalAcquired!: () => void;
    const acquired = new Promise<void>((r) => (signalAcquired = r));
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const holder = prisma.$transaction(
      async (tx) => {
        // $executeRaw (not $queryRaw): pg_advisory_xact_lock returns void, which the query
        // deserializer rejects. This blocks until acquired, then holds it for the txn.
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${OUTBOX_CLAIM_LOCK_KEY}::bigint)`);
        signalAcquired();
        await held; // keep the lock until the assertion below runs
      },
      { timeout: 20_000 },
    );

    await acquired; // the lock is now held on a DIFFERENT connection
    const blocked = await drainOutboxOnce({ send, tokenFor: async () => "t", batchSize: 10 });
    expect(blocked.claimed).toBe(0); // could not get the shared lock → claimed nothing
    expect(calls).toBe(0); // and therefore made ZERO provider calls

    release();
    await holder; // lock freed

    await drainOutboxOnce({ send, tokenFor: async () => "t", batchSize: 10 });
    expect(calls).toBe(2); // now claims, capped at 2 for the reservation window
    void rows;
  });

  it("P1: a 429 defers to Retry-After WITHOUT consuming a terminal attempt (no false 'failed')", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await makeConvo(propertyId);
    const r = await enqueueOutbound(baseArgs(orgId, c.id));
    let clock = Date.now();
    const now = () => new Date(clock);
    const send: OutboxSendFn = async () => ({ ok: false, error: "Hospitable API hatası (HTTP 429)", retryAfterMs: 45_000 });
    await drainOutboxOnce({ send, tokenFor: async () => "t", now });
    const row = await outbox(r.outboxId);
    expect(row.status).toBe("pending"); // deferred, NOT failed
    expect(row.attemptCount).toBe(0); // claim increment undone → a rate-limit storm can't exhaust attempts
    expect(row.availableAt.getTime()).toBe(clock + 45_000); // honoured the provider's Retry-After
  });

  // ── P2: AI send-time veto ──────────────────────────────────────────────────
  // Enqueue an AI reply on a fresh thread (guest asked, AI drafted). The AI Message is
  // backdated so any later message is unambiguously "newer".
  async function enqueueAiReply(convoOver: Record<string, unknown> = {}) {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await prisma.conversation.create({
      data: { propertyId, channel: "airbnb", guestIdentifier: "G", status: "new", externalReservationId: "res-ai", ...convoOver },
    });
    const inbound = await prisma.message.create({
      data: { conversationId: c.id, direction: "inbound", senderName: "G", body: "Wifi?", createdAt: new Date(Date.now() - 10_000) },
    });
    const r = await enqueueOutbound(
      baseArgs(orgId, c.id, { externalReservationId: "res-ai", authorType: "ai", senderName: "GuestOps AI", idempotencyKey: "ai1" }),
    );
    await prisma.message.update({ where: { id: r.messageId! }, data: { createdAt: new Date(Date.now() - 5000) } });
    return { orgId, conversationId: c.id, inboundId: inbound.id, r };
  }

  const countingSend = () => {
    let calls = 0;
    const send: OutboxSendFn = async () => ({ ok: true, providerMessageId: `x${++calls}` });
    return { send, calls: () => calls };
  };

  it("P2 veto: a host manual reply after enqueue → CANCELED, ZERO provider calls, Message KEPT", async () => {
    const { conversationId, r } = await enqueueAiReply();
    await prisma.message.create({
      data: { conversationId, direction: "outbound", authorType: "host", senderName: "Host", body: "Ben ilgilendim" },
    });
    const { send, calls } = countingSend();
    const res = await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(calls()).toBe(0); // NEVER POSTed
    expect(res.canceled).toBe(1);
    expect((await outbox(r.outboxId)).status).toBe("canceled"); // not sent, not failed
    // Codex P2: the draft Message is NOT deleted — kept for export/audit as "not delivered".
    expect(await prisma.message.count({ where: { id: r.messageId! } })).toBe(1);
  });

  it("P2 veto: AI paused (autoReplyHoldUntil) before the worker runs → canceled, no send", async () => {
    const { conversationId, r } = await enqueueAiReply();
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { autoReplyHoldUntil: new Date(Date.now() + 60 * 60_000) },
    });
    const { send, calls } = countingSend();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(calls()).toBe(0);
    expect((await outbox(r.outboxId)).status).toBe("canceled");
  });

  it("P2 veto: thread escalated to human ('problem') → canceled, no send", async () => {
    const { conversationId, r } = await enqueueAiReply();
    await prisma.conversation.update({ where: { id: conversationId }, data: { status: "problem" } });
    const { send, calls } = countingSend();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(calls()).toBe(0);
    expect((await outbox(r.outboxId)).status).toBe("canceled");
  });

  it("P2 veto: a NEWER guest inbound after enqueue supersedes the draft → canceled, no send", async () => {
    const { conversationId, r } = await enqueueAiReply();
    await prisma.message.create({
      data: { conversationId, direction: "inbound", senderName: "G", body: "Bir de otopark?", createdAt: new Date() },
    });
    const { send, calls } = countingSend();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(calls()).toBe(0);
    expect((await outbox(r.outboxId)).status).toBe("canceled");
  });

  it("P2: a MANUAL host reply is NEVER vetoed — it sends even on a 'problem' thread", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await prisma.conversation.create({
      data: { propertyId, channel: "airbnb", guestIdentifier: "G", status: "problem", externalReservationId: "res-h" },
    });
    const r = await enqueueOutbound(
      baseArgs(orgId, c.id, { externalReservationId: "res-h", authorType: "host", idempotencyKey: "h1" }),
    );
    const { send, calls } = countingSend();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(calls()).toBe(1); // host send goes regardless of thread state
    expect((await outbox(r.outboxId)).status).toBe("sent");
  });

  it("P2: no false veto — the draft does NOT count its OWN queued Message as 'newer'; it sends", async () => {
    // Only the AI draft + the older inbound exist; nothing new happened. The veto must NOT
    // treat the draft's own Message as a superseding "newer message".
    const { r } = await enqueueAiReply();
    const { send, calls } = countingSend();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(calls()).toBe(1);
    expect((await outbox(r.outboxId)).status).toBe("sent");
  });
});
