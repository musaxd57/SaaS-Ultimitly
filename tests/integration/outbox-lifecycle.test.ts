import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { enqueueProactive } from "@/lib/outbox/enqueue";
import { drainOutboxOnce, reactivateBlockedOutbox, type OutboxSendFn } from "@/lib/outbox/worker";
import { OUTBOX_MAX_ATTEMPTS } from "@/lib/outbox/state";

// FAZ 1 — welcome / check-in / check-out (proactive) + holding-ack wired to the durable outbox.
// The provider transport + token are mocked; the sender loops (sendDue*) are exercised with the
// flag ON so the enqueue → worker-delivers → *SentAt-stamp-on-delivery contract is covered E2E.
// Mock ONLY sendOnChannel; keep the real isDefinitiveSendFailure (the rollback
// classifier the senders now call) so its actual logic is exercised.
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));
// Spy the ops pager so the `blocked` test can assert it fires EXACTLY ONCE (no per-pass storm).
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { sendOnChannel } from "@/lib/messaging";
import { reportError } from "@/lib/report-error";
import { sendDueWelcomes } from "@/lib/automation";

const mockSend = vi.mocked(sendOnChannel);
const reportErrorMock = vi.mocked(reportError);
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

  // ── Final-review fixes (A/A2/B/C) ──────────────────────────────────────────
  it("A (7-step): 402 subscription-not-active → BLOCKED (parked, no re-claim, ONE pager); reactivate → pending → sent in ONE call", async () => {
    const { orgId, source } = await seedWelcome();
    await sendDueWelcomes(orgId); // enqueue (flag ON)

    // (1) the provider returns 402 "subscription not active".
    let calls402 = 0;
    const send402: OutboxSendFn = async () => {
      calls402++;
      return { ok: false, error: "Hospitable API hatası (HTTP 402)" };
    };
    const r0 = await drainOutboxOnce({ send: send402, tokenFor: async () => "t" });

    // (2) the record becomes `blocked` (NOT failed): the attempt limit is NOT consumed (the claim's
    //     +1 is undone → attemptCount back to 0) and exactly one provider call was made.
    const rowBlocked = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(rowBlocked.status).toBe("blocked");
    expect(rowBlocked.attemptCount).toBe(0);
    expect(rowBlocked.lastErrorCode).toBe("HTTP 402");
    expect(calls402).toBe(1);
    expect(r0.blocked).toBe(1);

    // (3) drain 5 MORE times — a blocked row is never re-claimed.
    for (let i = 0; i < 5; i++) await drainOutboxOnce({ send: send402, tokenFor: async () => "t" });
    // (4) total provider calls STILL 1, and the ops pager fired EXACTLY once (no per-pass storm).
    expect(calls402).toBe(1);
    const blockedPages = reportErrorMock.mock.calls.filter(([key]) => key === "outbox-blocked");
    expect(blockedPages.length).toBe(1);
    // While blocked, *SentAt is never stamped (nothing was delivered).
    expect((await prisma.reservation.findFirstOrThrow({ where: { sourceReference: source } })).welcomeSentAt).toBeNull();

    // (5) the integration is active again → atomically reactivate the org's blocked rows.
    const reactivated = await reactivateBlockedOutbox(orgId);
    expect(reactivated).toBe(1);
    // (6) the record is back to `pending` with a fresh attempt budget.
    const rowPending = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(rowPending.status).toBe("pending");
    expect(rowPending.attemptCount).toBe(0);

    // (7) a SINGLE provider call now delivers it → sent + *SentAt stamped.
    const { send, calls } = okDeliver();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(calls()).toBe(1);
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } })).status).toBe("sent");
    expect((await prisma.reservation.findFirstOrThrow({ where: { sourceReference: source } })).welcomeSentAt).toBeInstanceOf(Date);
  });

  it("A2: reactivateBlockedOutbox is TENANT-BOUND — org A's reactivation never touches org B's blocked row", async () => {
    const a = await seedWelcome({ source: "src-a" });
    const b = await seedWelcome({ source: "src-b" });
    await sendDueWelcomes(a.orgId);
    await sendDueWelcomes(b.orgId);
    // Both orgs' rows hit 402 → blocked.
    const send402: OutboxSendFn = async () => ({ ok: false, error: "HTTP 402" });
    await drainOutboxOnce({ send: send402, tokenFor: async () => "t", batchSize: 10 });
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: a.orgId } })).status).toBe("blocked");
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: b.orgId } })).status).toBe("blocked");
    // Only org A reconnects → only A's row is reactivated; B stays blocked.
    const n = await reactivateBlockedOutbox(a.orgId);
    expect(n).toBe(1);
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: a.orgId } })).status).toBe("pending");
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: b.orgId } })).status).toBe("blocked");
  });

  it("A3: a TERMINAL validation 4xx (HTTP 400) marches to `failed` and is NEVER resurrected by re-enqueue", async () => {
    const { orgId } = await seedWelcome();
    await sendDueWelcomes(orgId);
    const row0 = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } });
    // A genuine terminal failure (bad request) — distinct from 402: it must stay put forever.
    await prisma.messageOutbox.update({
      where: { id: row0.id },
      data: { status: "failed", attemptCount: OUTBOX_MAX_ATTEMPTS, lastErrorCode: "HTTP 400" },
    });
    await sendDueWelcomes(orgId); // re-run → dedupe-hit does NOT resurrect (no failed→pending path)
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } })).status).toBe("failed");
  });

  it("B (7-step): enqueue → ambiguous → review → FLAG OFF → old scheduler → ZERO sends, *SentAt NULL, review stays", async () => {
    const { orgId, source } = await seedWelcome();
    // 1-2: enqueue (flag ON) then drive the send to AMBIGUOUS → parked for review.
    await sendDueWelcomes(orgId);
    const send: OutboxSendFn = async () => ({ ok: false, error: "HTTP 500 server error" });
    let clock = Date.now();
    const now = () => new Date(clock);
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 3; i++) {
      await drainOutboxOnce({ send, tokenFor: async () => "t", now });
      clock += 60 * 60_000;
    }
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } })).status).toBe("review");
    // *SentAt is NOT stamped (honest — the send was never confirmed).
    expect((await prisma.reservation.findFirstOrThrow({ where: { sourceReference: source } })).welcomeSentAt).toBeNull();

    // 3: FLAG OFF (rollback). 4: the old direct scheduler runs.
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "");
    const out = await sendDueWelcomes(orgId);
    // 5: ZERO new provider calls — the direct sender FENCES on the review outbox row (not on *SentAt).
    expect(mockSend).not.toHaveBeenCalled();
    expect(out.sent).toBe(0);
    // 6: *SentAt still NULL. 7: the outbox row stays `review`.
    expect((await prisma.reservation.findFirstOrThrow({ where: { sourceReference: source } })).welcomeSentAt).toBeNull();
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } })).status).toBe("review");
  });

  it("C: a CHECK-OUT for a completed booking is NOT vetoed (consistent with the flag-OFF query); welcome IS", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const mkLifecycleRow = async (type: "checkout" | "welcome", resStatus: string, ref: string, key: string) => {
      const res = await prisma.reservation.create({
        data: {
          propertyId, guestName: "G", channel: "airbnb", status: resStatus,
          arrivalDate: new Date(Date.now() - 86_400_000), departureDate: new Date(Date.now() + 86_400_000),
          sourceReference: ref,
        },
      });
      await prisma.messageOutbox.create({
        data: {
          organizationId: orgId, conversationId: null, messageId: null, reservationId: res.id, channel: "airbnb",
          externalReservationId: ref, messageType: type, body: "x", idempotencyKey: key, status: "pending",
        },
      });
      return res.id;
    };
    const coId = await mkLifecycleRow("checkout", "completed", "res-co", "co");
    const wId = await mkLifecycleRow("welcome", "completed", "res-w", "w");
    const { send, calls } = okDeliver();
    const res = await drainOutboxOnce({ send, tokenFor: async () => "t", batchSize: 10 });
    expect(calls()).toBe(1); // checkout sent; welcome vetoed
    expect(res.canceled).toBe(1);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: coId } })).checkoutSentAt).toBeInstanceOf(Date);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: wId } })).welcomeSentAt).toBeNull(); // welcome canceled
  });

  it("C2: a CHECK-OUT enqueued the morning of departure (departure at past-midnight) is NOT window_passed; a day-old one IS", async () => {
    // Same-day reminder reality: departureDate is stored at LOCAL MIDNIGHT of the departure
    // day, so at the 08:00-12:00 send time it is already "< now". The veto must treat the row
    // as live until the departure DAY is over — otherwise every same-day checkout dies in the
    // outbox as window_passed.
    const { orgId, propertyId } = await makeOrgWithProperty();
    const mkRow = async (departure: Date, ref: string, key: string) => {
      const res = await prisma.reservation.create({
        data: {
          propertyId, guestName: "G", channel: "airbnb", status: "confirmed",
          arrivalDate: new Date(departure.getTime() - 3 * 86_400_000), departureDate: departure,
          sourceReference: ref,
        },
      });
      await prisma.messageOutbox.create({
        data: {
          organizationId: orgId, conversationId: null, messageId: null, reservationId: res.id, channel: "airbnb",
          externalReservationId: ref, messageType: "checkout", body: "x", idempotencyKey: key, status: "pending",
          availableAt: new Date("2026-06-15T05:00:00Z"), // due before the fixed test clock below
        },
      });
      return res.id;
    };
    const now = new Date("2026-06-15T06:00:00Z"); // 09:00 Istanbul, departure-day morning
    const todayId = await mkRow(new Date("2026-06-14T21:00:00Z"), "res-today", "co-today"); // Istanbul midnight of Jun 15
    await mkRow(new Date("2026-06-13T21:00:00Z"), "res-past", "co-past"); //                   Istanbul midnight of Jun 14
    const { send, calls } = okDeliver();
    const res = await drainOutboxOnce({ send, tokenFor: async () => "t", batchSize: 10, now: () => now });
    expect(calls()).toBe(1); // today's checkout delivered; yesterday's vetoed
    expect(res.canceled).toBe(1);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: todayId } })).checkoutSentAt).toBeInstanceOf(Date);
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: "co-past" } })).status).toBe("canceled");
  });

  it("C3 (Codex 07-23): checkout vetosu ORG-TZ TAKVİM GÜNÜ ile çalışır — Berlin'in 23/25 saatlik günlerinde kaymaz", async () => {
    // fa515e5 otomasyonun mesaj-SEÇİM penceresini düzeltmişti; worker'ın gönderim-anı
    // vetosu ise sabit `departureDate + 24h` kullanıyordu → 25 saatlik departure
    // gününde (geri alma) kuyruktaki checkout YEREL GÜN BİTMEDEN 1 saat erken iptal
    // ediliyor, 23 saatlik günde (ileri alma) ertesi yerel güne 1 saat sarkıyordu.
    // Kural artık sendDueCheckouts ile aynı: yalnız now'ın org-tz tarih anahtarı
    // departure'ın tarih anahtarını GEÇİNCE window_passed. (Istanbul paritesi C2'de pinli.)
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.organization.update({ where: { id: orgId }, data: { timezone: "Europe/Berlin" } });
    const mkRow = async (departure: Date, ref: string, key: string) => {
      const res = await prisma.reservation.create({
        data: {
          propertyId, guestName: "G", channel: "airbnb", status: "confirmed",
          arrivalDate: new Date(departure.getTime() - 3 * 86_400_000), departureDate: departure,
          sourceReference: ref,
        },
      });
      await prisma.messageOutbox.create({
        data: {
          organizationId: orgId, conversationId: null, messageId: null, reservationId: res.id, channel: "airbnb",
          externalReservationId: ref, messageType: "checkout", body: "x", idempotencyKey: key, status: "pending",
          availableAt: new Date("2026-01-01T00:00:00Z"), // her iki sabit saatten önce due
        },
      });
      return res.id;
    };

    // 25 SAATLİK GÜN (2026-10-25, geri alma): departure = Berlin yerel geceyarısı
    // = 2026-10-24T22:00Z. now = AYNI yerel günün 23:30'u (CET) = 2026-10-25T22:30Z
    // → departure + 24.5h: eski sabit-24h kod burada VETOLARDI (erken iptal).
    const dstId = await mkRow(new Date("2026-10-24T22:00:00Z"), "res-dst25", "co-dst25");
    const first = okDeliver();
    await drainOutboxOnce({ send: first.send, tokenFor: async () => "t", batchSize: 10, now: () => new Date("2026-10-25T22:30:00Z") });
    expect(first.calls()).toBe(1); // yerel gün bitmeden ASLA veto edilmez
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: dstId } })).checkoutSentAt).toBeInstanceOf(Date);

    // 23 SAATLİK GÜN (2026-03-29, ileri alma): departure = 2026-03-28T23:00Z (CET
    // geceyarısı). now = ERTESİ yerel günün 00:30'u (CEST) = 2026-03-29T22:30Z
    // → departure + 23.5h: eski kod hâlâ İZİN VERİRDİ (geç kalmış gönderim).
    await mkRow(new Date("2026-03-28T23:00:00Z"), "res-dst23", "co-dst23");
    const second = okDeliver();
    const r2 = await drainOutboxOnce({ send: second.send, tokenFor: async () => "t", batchSize: 10, now: () => new Date("2026-03-29T22:30:00Z") });
    expect(second.calls()).toBe(0); // yerel gün geçti → provider'a gidilmez
    expect(r2.canceled).toBe(1);
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: "co-dst23" } })).status).toBe("canceled");
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

  it("AMBIGUOUS failure (5xx/timeout) KEEPS welcomeSentAt → next run does NOT re-POST (no duplicate)", async () => {
    const { orgId, source } = await seedWelcome();
    mockSend.mockResolvedValue({ ok: false, error: "HTTP 503 Service Unavailable" });
    const out = await sendDueWelcomes(orgId);
    expect(mockSend).toHaveBeenCalledTimes(1); // attempted inline
    expect(out.sent).toBe(0); // not counted as delivered
    // Claim HELD despite the ambiguous failure — the welcome MAY have reached the guest.
    expect((await prisma.reservation.findFirstOrThrow({ where: { sourceReference: source } })).welcomeSentAt).toBeInstanceOf(Date);
    // Next run: welcomeSentAt still stamped → the claim (count=0) skips it → NO second POST.
    mockSend.mockClear();
    const out2 = await sendDueWelcomes(orgId);
    expect(mockSend).not.toHaveBeenCalled(); // no re-POST of a possibly-delivered message
    expect(out2.sent).toBe(0);
  });

  it("DEFINITIVE failure (4xx) un-claims welcomeSentAt → next run retries cleanly", async () => {
    const { orgId, source } = await seedWelcome();
    mockSend.mockResolvedValue({ ok: false, error: "HTTP 400 Bad Request" });
    await sendDueWelcomes(orgId);
    // Claim ROLLED BACK — the provider refused, nothing was delivered, safe to retry.
    expect((await prisma.reservation.findFirstOrThrow({ where: { sourceReference: source } })).welcomeSentAt).toBeNull();
    // Next run re-attempts and (this time) succeeds.
    mockSend.mockClear();
    mockSend.mockResolvedValue({ ok: true });
    const out2 = await sendDueWelcomes(orgId);
    expect(mockSend).toHaveBeenCalledTimes(1); // re-attempted after the definitive failure
    expect(out2.sent).toBe(1);
    expect((await prisma.reservation.findFirstOrThrow({ where: { sourceReference: source } })).welcomeSentAt).toBeInstanceOf(Date);
  });
});
