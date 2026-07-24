import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import {
  enqueueIdentityEmail,
  drainEmailOutboxOnce,
  sweepEmailOutbox,
  kickEmailOutboxDrain,
  emailOutboxEnabled,
  EMAIL_OUTBOX_MAX_ATTEMPTS,
} from "@/lib/email-outbox";

// ---------------------------------------------------------------------------
// Durable identity e-mail outbox (Tur-4, docs/EMAIL-OUTBOX-DESIGN.md).
// Pins: atomic enqueue+supersede, encrypted payload lifecycle (NULL on every
// terminal transition), the currency gate at all three transitions (a stale
// row can NEVER resurrect — Codex kapanış 1), recipient-snapshot binding, AAD
// binding, retry/backoff/expiry, SKIP LOCKED concurrency, crash recovery, and
// the no-unhandled-rejection kick.
// ---------------------------------------------------------------------------

type SendFn = (to: string, subject: string, html: string) => Promise<{ ok: boolean; error?: string }>;
const okSend = () => vi.fn<SendFn>(async () => ({ ok: true }));

async function makeUser(email = "u@x.com") {
  const org = await prisma.organization.create({ data: { name: "Outbox Org" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: "Umut", email, passwordHash: "x", role: "owner" },
  });
  return user;
}

/** Enqueue inside a TX that ALSO writes the matching User hash — the exact
 *  contract the routes use (hash + row share one commit). */
async function enqueueReset(userId: string, secret: string, recipient: string, ttlMs = 10 * 60_000) {
  const expiresAt = new Date(Date.now() + ttlMs);
  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { pwResetCodeHash: `hash-of-${secret}`, pwResetCodeExpiresAt: expiresAt, pwResetCodeAttempts: 0 },
    });
    return enqueueIdentityEmail(tx, { userId, kind: "pw_reset_code", secret, recipient, expiresAt });
  });
}

describe("email-outbox", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("EMAIL_OUTBOX_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("flag OFF → drain and sweep are hard no-ops (dead code while disabled)", async () => {
    vi.stubEnv("EMAIL_OUTBOX_ENABLED", "");
    expect(emailOutboxEnabled()).toBe(false);
    const send = okSend();
    expect(await drainEmailOutboxOnce({ send })).toEqual({ claimed: 0, sent: 0, retried: 0, failed: 0, canceled: 0 });
    expect(await sweepEmailOutbox()).toEqual({ recovered: 0, canceled: 0, deleted: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("HAPPY PATH: enqueue is atomic with the hash write; drain delivers, payloadEnc → NULL, secret in the mail body", async () => {
    const u = await makeUser();
    await enqueueReset(u.id, "12345678", u.email);
    const row = await prisma.emailOutbox.findFirstOrThrow();
    expect(row.status).toBe("pending");
    expect(row.version).toBe(1);
    expect(row.payloadEnc).toBeTruthy();
    expect(row.payloadEnc).not.toContain("12345678"); // encrypted, never plaintext
    expect(row.payloadEnc).not.toContain(u.email);

    const send = okSend();
    const out = await drainEmailOutboxOnce({ send });
    expect(out.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe(u.email);
    expect(send.mock.calls[0][1]).toContain("Şifre sıfırlama");
    expect(send.mock.calls[0][2]).toContain("12345678"); // rendered at send time

    const done = await prisma.emailOutbox.findFirstOrThrow();
    expect(done.status).toBe("sent");
    expect(done.sentAt).toBeTruthy();
    expect(done.payloadEnc).toBeNull(); // secret does not outlive delivery
  });

  it("SUPERSEDE: a new request cancels older pending/claimed generations (payload NULL) and bumps version", async () => {
    const u = await makeUser();
    await enqueueReset(u.id, "11111111", u.email);
    // Simulate an already-claimed older row — supersede must kill it too.
    await prisma.emailOutbox.updateMany({
      data: { status: "claimed", claimedBy: "w1", claimExpiresAt: new Date(Date.now() + 60_000) },
    });
    await enqueueReset(u.id, "22222222", u.email);

    const rows = await prisma.emailOutbox.findMany({ orderBy: { version: "asc" } });
    expect(rows.map((r) => [r.version, r.status])).toEqual([
      [1, "canceled"],
      [2, "pending"],
    ]);
    expect(rows[0].payloadEnc).toBeNull(); // superseded secret erased immediately

    const send = okSend();
    await drainEmailOutboxOnce({ send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][2]).toContain("22222222"); // only the NEW code goes out
  });

  it("RESURRECTION KAPALI (Codex 1): a `sending` row superseded mid-flight settles to canceled on failure — never back to pending", async () => {
    const u = await makeUser();
    await enqueueReset(u.id, "11111111", u.email);
    // The send mock RACES a new request while v1's provider call is in flight,
    // then fails — the failure settle must see the newer generation and cancel.
    const send = vi.fn(async () => {
      await enqueueReset(u.id, "22222222", u.email);
      return { ok: false as const, error: "HTTP 500" };
    });
    const out = await drainEmailOutboxOnce({ send });
    expect(out.retried).toBe(0); // NOT retried

    const v1 = await prisma.emailOutbox.findFirstOrThrow({ where: { version: 1 } });
    expect(v1.status).toBe("canceled");
    expect(v1.payloadEnc).toBeNull();
    // The new generation still delivers normally.
    const send2 = okSend();
    await drainEmailOutboxOnce({ send: send2 });
    expect(send2).toHaveBeenCalledTimes(1);
    expect(send2.mock.calls[0][2]).toContain("22222222");
  });

  it("LIVENESS: a consumed/cleared User hash cancels the row at the pre-send gate (no send)", async () => {
    const u = await makeUser();
    await enqueueReset(u.id, "12345678", u.email);
    await prisma.user.update({ where: { id: u.id }, data: { pwResetCodeHash: null, pwResetCodeExpiresAt: null } });
    const send = okSend();
    const out = await drainEmailOutboxOnce({ send });
    expect(send).not.toHaveBeenCalled();
    expect(out.canceled).toBeGreaterThanOrEqual(1);
    expect((await prisma.emailOutbox.findFirstOrThrow()).status).toBe("canceled");
  });

  it("RECIPIENT SNAPSHOT (Codex 5): address changed between request and send → canceled, nothing sent to the new address", async () => {
    const u = await makeUser("old@x.com");
    await enqueueReset(u.id, "12345678", "old@x.com");
    await prisma.user.update({ where: { id: u.id }, data: { email: "new@x.com" } });
    const send = okSend();
    await drainEmailOutboxOnce({ send });
    expect(send).not.toHaveBeenCalled();
    const row = await prisma.emailOutbox.findFirstOrThrow();
    expect(row.status).toBe("canceled");
    expect(row.payloadEnc).toBeNull();
  });

  it("AAD BINDING: a ciphertext moved onto another row fails decryption → canceled, no send", async () => {
    const u = await makeUser();
    await enqueueReset(u.id, "11111111", u.email);
    const donor = await prisma.emailOutbox.findFirstOrThrow();
    // Craft a second-generation row whose payload is the DONOR's ciphertext
    // (different row id → AAD mismatch). Bypass enqueue to plant it directly.
    await prisma.emailOutbox.update({ where: { id: donor.id }, data: { status: "canceled", payloadEnc: null } });
    await prisma.emailOutbox.create({
      data: {
        id: "00000000-0000-4000-8000-000000000001",
        userId: u.id,
        kind: "pw_reset_code",
        version: 2,
        payloadEnc: donor.payloadEnc,
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    const send = okSend();
    await drainEmailOutboxOnce({ send });
    expect(send).not.toHaveBeenCalled();
    const planted = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: "00000000-0000-4000-8000-000000000001" } });
    expect(planted.status).toBe("canceled");
    expect(planted.payloadEnc).toBeNull();
  });

  it("RETRY/BACKOFF: provider failure keeps the payload and schedules the future attempt; terminal failed NULLs it", async () => {
    const u = await makeUser();
    await enqueueReset(u.id, "12345678", u.email, 48 * 60 * 60 * 1000); // long TTL — attempts bound first
    const fail = vi.fn(async () => ({ ok: false as const, error: `boom to ${u.email} 1234567` }));

    const first = await drainEmailOutboxOnce({ send: fail });
    expect(first.retried).toBe(1);
    let row = await prisma.emailOutbox.findFirstOrThrow();
    expect(row.status).toBe("pending");
    expect(row.attemptCount).toBe(1);
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now()); // backoff scheduled
    expect(row.payloadEnc).toBeTruthy(); // retryable → secret kept
    expect(row.lastError).not.toContain("u@x.com"); // scrubbed
    expect(row.lastError).not.toContain("1234567");

    // Walk through the remaining attempts by faking "now" past each backoff.
    for (let i = 2; i <= EMAIL_OUTBOX_MAX_ATTEMPTS; i++) {
      const future = new Date(row.nextAttemptAt.getTime() + 1000);
      await drainEmailOutboxOnce({ send: fail, now: () => future });
      row = await prisma.emailOutbox.findFirstOrThrow();
    }
    expect(row.status).toBe("failed"); // terminal
    expect(row.attemptCount).toBe(EMAIL_OUTBOX_MAX_ATTEMPTS);
    expect(row.payloadEnc).toBeNull(); // terminal → secret erased
  });

  it("EXPIRY: a pending row past the secret's TTL is canceled (payload NULL), never sent", async () => {
    const u = await makeUser();
    await enqueueReset(u.id, "12345678", u.email, 1000);
    const send = okSend();
    const later = new Date(Date.now() + 5000);
    const out = await drainEmailOutboxOnce({ send, now: () => later });
    expect(send).not.toHaveBeenCalled();
    expect(out.canceled).toBe(1);
    const row = await prisma.emailOutbox.findFirstOrThrow();
    expect(row.status).toBe("canceled");
    expect(row.payloadEnc).toBeNull();
  });

  it("CONCURRENCY: two parallel drains deliver the row exactly once (SKIP LOCKED)", async () => {
    const u = await makeUser();
    await enqueueReset(u.id, "12345678", u.email);
    const send = okSend();
    await Promise.all([drainEmailOutboxOnce({ send }), drainEmailOutboxOnce({ send })]);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await prisma.emailOutbox.findFirstOrThrow()).status).toBe("sent");
  });

  it("RECOVERY (Codex 3): an expired claim from a crashed worker → current row back to pending and delivered; STALE row → canceled", async () => {
    const u = await makeUser();
    await enqueueReset(u.id, "11111111", u.email);
    // Crash simulation: claimed long ago, claim TTL passed, worker gone.
    await prisma.emailOutbox.updateMany({
      data: { status: "sending", claimedBy: "dead-worker", claimExpiresAt: new Date(Date.now() - 1000) },
    });
    const rec = await sweepEmailOutbox();
    expect(rec.recovered).toBe(1);
    const send = okSend();
    await drainEmailOutboxOnce({ send });
    expect(send).toHaveBeenCalledTimes(1); // delivered exactly once after recovery

    // Stale variant: crashed claim AND a newer generation exists → canceled.
    await prisma.emailOutbox.deleteMany();
    await enqueueReset(u.id, "22222222", u.email);
    await prisma.emailOutbox.updateMany({
      data: { status: "sending", claimedBy: "dead-worker", claimExpiresAt: new Date(Date.now() - 1000) },
    });
    await enqueueReset(u.id, "33333333", u.email); // supersedes (sending row untouched by enqueue)
    const rec2 = await sweepEmailOutbox();
    expect(rec2.canceled).toBe(1);
    const v1 = await prisma.emailOutbox.findFirstOrThrow({ where: { version: 1 } });
    expect(v1.status).toBe("canceled");
    expect(v1.payloadEnc).toBeNull();
  });

  it("RETENTION: old sent rows go after 7 days, old canceled/failed after 30 (metadata only by then)", async () => {
    const u = await makeUser();
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const veryOld = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await prisma.emailOutbox.create({
      data: { id: "s1", userId: u.id, kind: "pw_reset_code", version: 1, status: "sent", sentAt: old, expiresAt: old },
    });
    await prisma.emailOutbox.create({
      data: { id: "c1", userId: u.id, kind: "pw_change_code", version: 1, status: "canceled", expiresAt: veryOld },
    });
    await prisma.$executeRaw`UPDATE "EmailOutbox" SET "updatedAt" = ${veryOld} WHERE "id" = 'c1'`;
    const out = await sweepEmailOutbox();
    expect(out.deleted).toBe(2);
    expect(await prisma.emailOutbox.count()).toBe(0);
  });

  it("USER CASCADE: deleting the user removes queued rows (account erasure covers the outbox)", async () => {
    const u = await makeUser();
    await enqueueReset(u.id, "12345678", u.email);
    await prisma.user.delete({ where: { id: u.id } });
    expect(await prisma.emailOutbox.count()).toBe(0);
  });

  it("KICK: a rejecting drain produces NO unhandled rejection (funnels into reportError)", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => unhandled.push(err);
    process.on("unhandledRejection", onUnhandled);
    try {
      kickEmailOutboxDrain(() => Promise.reject(new Error("drain down")));
      await new Promise((r) => setTimeout(r, 50)); // let the rejection surface if it would
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
