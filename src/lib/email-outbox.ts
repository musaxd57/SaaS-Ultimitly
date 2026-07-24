import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { encryptSecretBound, decryptSecretBound } from "@/lib/crypto";
import { emailService } from "@/lib/email";
import { reportError } from "@/lib/report-error";
import { verifyUrl, verifyEmailHtml } from "@/lib/auth/email-verify";

// ---------------------------------------------------------------------------
// Durable outbox for IDENTITY e-mails (Tur-4; docs/EMAIL-OUTBOX-DESIGN.md).
//
// Why: the identity flows used to make a SYNCHRONOUS provider call inside the
// request — a measurable timing oracle on forgot-password (known vs unknown
// account) and a hard dependency (register 503'd on a provider outage). The
// outbox removes the network leg from the request: one atomic transaction
// writes the User's secret hash AND the send-intent row, and delivery is owned
// by an independent drain loop.
//
// Delivery authority = THE ROW, not any timer: an in-process 15s poller
// (instrumentation.ts → /api/cron/email-outbox) and the 2-min scheduled sync
// both drain; the post-enqueue kick is only a latency optimizer. FOR UPDATE
// SKIP LOCKED claims make any number of concurrent drains safe.
//
// Secrets: the raw code/token and the recipient snapshot live ONLY in
// payloadEnc — AES-256-GCM bound via AAD to (rowId, userId, kind), so a
// ciphertext moved to another row fails authentication. payloadEnc is NULLed
// on EVERY terminal transition (sent / canceled / terminal failed / expiry).
//
// Currency ("an old row can never resurrect"): a row is CURRENT iff
//   (1) no sibling row with a higher version exists for (userId, kind), AND
//   (2) the User's matching hash column is still set and unexpired.
// Every hash write shares a transaction with a same-version row insert, and
// consume/expiry paths null the hash — so (1)+(2) ⟺ "this row's secret is the
// user's live secret" without ever comparing secret material. The gate runs
// under the NS-42 per-(user,kind) advisory lock at THREE transitions:
// claimed→sending (pre-send CAS, plus the recipient-snapshot check),
// sending→pending (failure settle → stale rows go to canceled, never retry),
// and claim-expiry recovery. The single accepted residue: a provider call that
// already started cannot be stopped — at most ONE stale e-mail, whose code no
// longer verifies anyway.
// ---------------------------------------------------------------------------

export type EmailOutboxKind = "verify_email" | "pw_reset_code" | "pw_change_code";
const KINDS: ReadonlySet<string> = new Set(["verify_email", "pw_reset_code", "pw_change_code"]);

/** Master switch — default OFF. While off the module is dead code: routes use
 *  their legacy synchronous send and the drain refuses to run. */
export function emailOutboxEnabled(): boolean {
  return process.env.EMAIL_OUTBOX_ENABLED === "1";
}

// Advisory-lock namespace — disjoint from erasure (40) and guest-chat (41).
const EMAIL_OUTBOX_LOCK_NS = 42;

async function acquireEmailOutboxLock(
  tx: Prisma.TransactionClient,
  userId: string,
  kind: EmailOutboxKind,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(${EMAIL_OUTBOX_LOCK_NS}::int4, hashtext(${`${userId}:${kind}`}))`,
  );
}

function aadFor(id: string, userId: string, kind: string): string {
  return `emailoutbox:v1:${id}:${userId}:${kind}`;
}

export const EMAIL_OUTBOX_MAX_ATTEMPTS = 5;
// Attempt N failure → wait BACKOFF[N-1] (bounded by the secret's own expiry).
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
// Must exceed the worst-case provider call so an in-flight `sending` row is
// never recovered (and possibly re-sent) while its send is still running.
export const EMAIL_OUTBOX_CLAIM_TTL_MS = 3 * 60_000;

// Retention for OPERATIONAL metadata (payloadEnc is long gone by then).
const SENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

interface OutboxPayload {
  secret: string;
  recipient: string;
}

export interface EnqueueIdentityEmailArgs {
  userId: string;
  kind: EmailOutboxKind;
  /** The raw code/link-token. Lives ONLY inside payloadEnc. */
  secret: string;
  /** Recipient SNAPSHOT — the address this secret is for. Verified against the
   *  User's current address at send time; mismatch cancels the row. */
  recipient: string;
  /** The SECRET's own TTL — the row is never sent past this. */
  expiresAt: Date;
}

/**
 * Queue an identity e-mail. MUST run inside the SAME transaction that writes
 * the corresponding User hash column — that shared commit is what makes the
 * version⇔hash pairing (and the register 201 contract) atomic. Supersedes all
 * older undelivered generations; an in-flight `sending` sibling cannot be
 * stopped here (accepted window) — the currency gates cancel it at its next
 * transition instead.
 */
export async function enqueueIdentityEmail(
  tx: Prisma.TransactionClient,
  args: EnqueueIdentityEmailArgs,
): Promise<string> {
  await acquireEmailOutboxLock(tx, args.userId, args.kind);
  await tx.emailOutbox.updateMany({
    where: { userId: args.userId, kind: args.kind, status: { in: ["pending", "claimed"] } },
    data: { status: "canceled", payloadEnc: null, claimedBy: null, claimExpiresAt: null },
  });
  const agg = await tx.emailOutbox.aggregate({
    where: { userId: args.userId, kind: args.kind },
    _max: { version: true },
  });
  const version = (agg._max.version ?? 0) + 1;
  const id = randomUUID();
  await tx.emailOutbox.create({
    data: {
      id,
      userId: args.userId,
      kind: args.kind,
      version,
      payloadEnc: encryptSecretBound(
        JSON.stringify({ secret: args.secret, recipient: args.recipient } satisfies OutboxPayload),
        aadFor(id, args.userId, args.kind),
      ),
      expiresAt: args.expiresAt,
    },
  });
  return id;
}

/**
 * Fire-and-forget latency optimizer after an enqueue COMMITS — never the
 * delivery authority (the poller + cron own that), never awaited by a route
 * (it must not add measurable time to the known-user path), and it can NOT
 * produce an unhandled rejection: every failure funnels into reportError,
 * whose own rejection is swallowed too.
 */
export function kickEmailOutboxDrain(drain: () => Promise<unknown> = drainEmailOutboxOnce): void {
  try {
    void drain().catch((err) => {
      void reportError("email-outbox.kick", err instanceof Error ? err : new Error(String(err))).catch(
        () => {},
      );
    });
  } catch {
    // A synchronously-throwing drain (should not happen) must not crash the route.
  }
}

// --- Rendering (single source for BOTH the outbox worker and the legacy
// synchronous path — the two paths can never drift apart). -------------------

export function resetCodeEmailHtml(code: string): string {
  return `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#111">Lixus AI — Şifre sıfırlama kodu</h2>
      <p>Şifrenizi sıfırlamak için doğrulama kodunuz:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:16px 0">${code}</p>
      <p style="color:#555">Bu kod <strong>10 dakika</strong> geçerlidir. Birden fazla kod aldıysanız
      en son gönderilen geçerlidir. Bu isteği siz yapmadıysanız bu e-postayı yok sayın — şifreniz değişmez.</p>
    </div>`;
}

export function changeCodeEmailHtml(code: string): string {
  return `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#111">Lixus AI — Şifre değiştirme kodu</h2>
      <p>Hesabınızın şifresini değiştirmek için doğrulama kodunuz:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:16px 0">${code}</p>
      <p style="color:#555">Bu kod <strong>10 dakika</strong> geçerlidir. Birden fazla kod aldıysanız
      en son gönderilen geçerlidir. Bu isteği siz yapmadıysanız bu e-postayı yok sayın — şifreniz değişmez.</p>
    </div>`;
}

function renderIdentityEmail(
  kind: EmailOutboxKind,
  secret: string,
  userName: string,
): { subject: string; html: string } {
  switch (kind) {
    case "verify_email":
      return {
        subject: "Lixus AI — E-postanı doğrula",
        html: verifyEmailHtml(userName, verifyUrl(secret)),
      };
    case "pw_reset_code":
      return { subject: "Lixus AI — Şifre sıfırlama kodu", html: resetCodeEmailHtml(secret) };
    case "pw_change_code":
      return { subject: "Lixus AI — Şifre değiştirme kodu", html: changeCodeEmailHtml(secret) };
  }
}

// --- Currency gate ----------------------------------------------------------

interface LivenessRow {
  name: string;
  email: string;
  emailVerifyTokenHash: string | null;
  emailVerifyExpiresAt: Date | null;
  pwResetCodeHash: string | null;
  pwResetCodeExpiresAt: Date | null;
  pwChangeCodeHash: string | null;
  pwChangeCodeExpiresAt: Date | null;
}

function hashLive(user: LivenessRow, kind: EmailOutboxKind, now: Date): boolean {
  const [hash, exp] =
    kind === "verify_email"
      ? [user.emailVerifyTokenHash, user.emailVerifyExpiresAt]
      : kind === "pw_reset_code"
        ? [user.pwResetCodeHash, user.pwResetCodeExpiresAt]
        : [user.pwChangeCodeHash, user.pwChangeCodeExpiresAt];
  if (hash == null) return false;
  if (exp != null && exp <= now) return false;
  return true;
}

const LIVENESS_SELECT = {
  name: true,
  email: true,
  emailVerifyTokenHash: true,
  emailVerifyExpiresAt: true,
  pwResetCodeHash: true,
  pwResetCodeExpiresAt: true,
  pwChangeCodeHash: true,
  pwChangeCodeExpiresAt: true,
} as const;

interface ClaimedRow {
  id: string;
  userId: string;
  kind: string;
  version: number;
  payloadEnc: string | null;
  attemptCount: number;
  expiresAt: Date;
}

/** CURRENT ⟺ no newer generation AND the user's matching hash is still live. */
async function rowIsCurrent(
  db: Prisma.TransactionClient,
  row: ClaimedRow,
  user: LivenessRow | null,
  now: Date,
): Promise<boolean> {
  if (!user || !KINDS.has(row.kind)) return false;
  if (!hashLive(user, row.kind as EmailOutboxKind, now)) return false;
  const newer = await db.emailOutbox.count({
    where: { userId: row.userId, kind: row.kind, version: { gt: row.version } },
  });
  return newer === 0;
}

// Provider errors can echo the recipient address — scrub before persisting.
function scrubErr(err: string | undefined | null): string {
  return (err ?? "unknown")
    .replace(/[^\s@]+@[^\s@]+/g, "[email]")
    .replace(/\d{5,}/g, "[num]")
    .slice(0, 300);
}

export interface EmailDrainDeps {
  /** Provider send — injectable so tests never touch the network. */
  send?: (to: string, subject: string, html: string) => Promise<{ ok: boolean; error?: string }>;
  now?: () => Date;
  batchSize?: number;
}

export interface EmailDrainResult {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  canceled: number;
}

/**
 * Drain due rows once: claim (SKIP LOCKED) → currency gate + CAS to `sending`
 * → exactly one provider attempt → settle. Safe to run from any number of
 * replicas/loops concurrently. Flag OFF → hard no-op (dead code while OFF).
 */
export async function drainEmailOutboxOnce(deps: EmailDrainDeps = {}): Promise<EmailDrainResult> {
  const result: EmailDrainResult = { claimed: 0, sent: 0, retried: 0, failed: 0, canceled: 0 };
  if (!emailOutboxEnabled()) return result;
  const now = deps.now?.() ?? new Date();
  const send =
    deps.send ?? ((to: string, subject: string, html: string) => emailService.sendReporting(to, subject, html));
  const batch = deps.batchSize ?? 10;
  const claimToken = randomUUID();

  // An expired secret must NEVER be delivered — cancel before claiming.
  const expired = await prisma.emailOutbox.updateMany({
    where: { status: "pending", expiresAt: { lte: now } },
    data: { status: "canceled", payloadEnc: null },
  });
  result.canceled += expired.count;

  const claimUntil = new Date(now.getTime() + EMAIL_OUTBOX_CLAIM_TTL_MS);
  const rows = await prisma.$queryRaw<ClaimedRow[]>(Prisma.sql`
    UPDATE "EmailOutbox"
    SET "status" = 'claimed', "claimedBy" = ${claimToken}, "claimExpiresAt" = ${claimUntil}, "updatedAt" = now()
    WHERE "id" IN (
      SELECT "id" FROM "EmailOutbox"
      WHERE "status" = 'pending' AND "nextAttemptAt" <= ${now} AND "expiresAt" > ${now}
      ORDER BY "createdAt" ASC
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "userId", "kind", "version", "payloadEnc", "attemptCount", "expiresAt"
  `);
  result.claimed = rows.length;

  for (const row of rows) {
    try {
      await processClaimedRow(row, claimToken, send, now, result);
    } catch (err) {
      // One poison row must not abort the batch; the claim TTL re-frees it.
      void reportError(`email-outbox.row:${row.id}`, err instanceof Error ? err : new Error(String(err)));
    }
  }
  return result;
}

async function processClaimedRow(
  row: ClaimedRow,
  claimToken: string,
  send: NonNullable<EmailDrainDeps["send"]>,
  now: Date,
  result: EmailDrainResult,
): Promise<void> {
  const cancelSelf = async (): Promise<void> => {
    await prisma.emailOutbox.updateMany({
      where: { id: row.id, claimedBy: claimToken, status: "claimed" },
      data: { status: "canceled", payloadEnc: null, claimedBy: null, claimExpiresAt: null },
    });
    result.canceled++;
  };

  // Unknown kind (defensive clamp) or missing/tampered payload → undeliverable.
  if (!KINDS.has(row.kind) || !row.payloadEnc) return cancelSelf();
  let payload: OutboxPayload;
  try {
    const parsed = JSON.parse(decryptSecretBound(row.payloadEnc, aadFor(row.id, row.userId, row.kind))) as OutboxPayload;
    if (typeof parsed?.secret !== "string" || typeof parsed?.recipient !== "string") return cancelSelf();
    payload = parsed;
  } catch {
    // Wrong AAD (ciphertext moved between rows) / tamper / key change.
    return cancelSelf();
  }

  // PRE-SEND GATE (one short locked TX): the row must still be the CURRENT
  // generation, the user's hash still live, and the recipient snapshot must
  // match the user's CURRENT address — then CAS claimed→sending. After this
  // commits, a supersede can no longer stop us (the accepted ≤1-stale-email
  // window); before it, a superseding enqueue serializes on the same lock.
  const gate = await prisma.$transaction(async (tx) => {
    await acquireEmailOutboxLock(tx, row.userId, row.kind as EmailOutboxKind);
    const user = await tx.user.findUnique({ where: { id: row.userId }, select: LIVENESS_SELECT });
    const current = await rowIsCurrent(tx, row, user, now);
    const recipientOk =
      user != null && user.email.toLowerCase() === payload.recipient.toLowerCase();
    if (!current || !recipientOk) {
      await tx.emailOutbox.updateMany({
        where: { id: row.id, claimedBy: claimToken, status: "claimed" },
        data: { status: "canceled", payloadEnc: null, claimedBy: null, claimExpiresAt: null },
      });
      return { go: false as const };
    }
    const cas = await tx.emailOutbox.updateMany({
      where: { id: row.id, claimedBy: claimToken, status: "claimed" },
      data: { status: "sending" },
    });
    return { go: cas.count === 1, name: user.name };
  });
  if (!gate.go) {
    result.canceled++;
    return;
  }

  const { subject, html } = renderIdentityEmail(row.kind as EmailOutboxKind, payload.secret, gate.name ?? "");
  const outcome = await send(payload.recipient, subject, html);

  if (outcome.ok) {
    const done = await prisma.emailOutbox.updateMany({
      where: { id: row.id, claimedBy: claimToken, status: "sending" },
      data: { status: "sent", sentAt: now, payloadEnc: null, claimedBy: null, claimExpiresAt: null, lastError: null },
    });
    if (done.count === 1) result.sent++;
    else void reportError("email-outbox.lost-claim", new Error(`sent settle missed for row ${row.id}`));
    return;
  }

  // FAILURE SETTLE — under the lock, with the currency gate again: a STALE row
  // must go to canceled here, NEVER back to pending (the resurrection Codex
  // closed). A current row retries with backoff until attempts/expiry run out.
  await prisma.$transaction(async (tx) => {
    await acquireEmailOutboxLock(tx, row.userId, row.kind as EmailOutboxKind);
    const user = await tx.user.findUnique({ where: { id: row.userId }, select: LIVENESS_SELECT });
    const current = await rowIsCurrent(tx, row, user, now);
    if (!current) {
      const c = await tx.emailOutbox.updateMany({
        where: { id: row.id, claimedBy: claimToken, status: "sending" },
        data: { status: "canceled", payloadEnc: null, claimedBy: null, claimExpiresAt: null },
      });
      if (c.count === 1) result.canceled++;
      return;
    }
    const attempts = row.attemptCount + 1;
    const backoff = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
    const nextAt = new Date(now.getTime() + backoff);
    const terminal = attempts >= EMAIL_OUTBOX_MAX_ATTEMPTS || nextAt >= row.expiresAt;
    const settled = await tx.emailOutbox.updateMany({
      where: { id: row.id, claimedBy: claimToken, status: "sending" },
      data: terminal
        ? {
            status: "failed",
            attemptCount: attempts,
            payloadEnc: null,
            claimedBy: null,
            claimExpiresAt: null,
            lastError: scrubErr(outcome.error),
          }
        : {
            status: "pending",
            attemptCount: attempts,
            nextAttemptAt: nextAt,
            claimedBy: null,
            claimExpiresAt: null,
            lastError: scrubErr(outcome.error),
          },
    });
    if (settled.count === 1) {
      if (terminal) {
        result.failed++;
        void reportError(
          `email-outbox.terminal kind:${row.kind}`,
          new Error(scrubErr(outcome.error)),
        );
      } else {
        result.retried++;
      }
    }
  });
}

/**
 * Recovery + retention sweep (the 2-min scheduled sync). Recovery: rows whose
 * claim expired (worker crashed mid-flight) go back to `pending` when still
 * current, `canceled` when stale — through the SAME currency gate, so a crash
 * can't resurrect a superseded generation either. Retention: sent rows after
 * 7 days, canceled/failed after 30 (payloadEnc is already NULL by then).
 */
export async function sweepEmailOutbox(now: Date = new Date()): Promise<{ recovered: number; canceled: number; deleted: number }> {
  const out = { recovered: 0, canceled: 0, deleted: 0 };
  if (!emailOutboxEnabled()) return out;

  const stuck = await prisma.emailOutbox.findMany({
    where: { status: { in: ["claimed", "sending"] }, claimExpiresAt: { lt: now } },
    select: { id: true, userId: true, kind: true, version: true, payloadEnc: true, attemptCount: true, expiresAt: true },
    take: 100,
  });
  for (const row of stuck) {
    await prisma.$transaction(async (tx) => {
      await acquireEmailOutboxLock(tx, row.userId, row.kind as EmailOutboxKind);
      const user = await tx.user.findUnique({ where: { id: row.userId }, select: LIVENESS_SELECT });
      const current = await rowIsCurrent(tx, row, user, now);
      const r = await tx.emailOutbox.updateMany({
        where: { id: row.id, status: { in: ["claimed", "sending"] }, claimExpiresAt: { lt: now } },
        data: current
          ? { status: "pending", nextAttemptAt: now, claimedBy: null, claimExpiresAt: null }
          : { status: "canceled", payloadEnc: null, claimedBy: null, claimExpiresAt: null },
      });
      if (r.count === 1) {
        if (current) out.recovered++;
        else out.canceled++;
      }
    });
  }

  const oldSent = await prisma.emailOutbox.deleteMany({
    where: { status: "sent", sentAt: { lt: new Date(now.getTime() - SENT_RETENTION_MS) } },
  });
  const oldTerminal = await prisma.emailOutbox.deleteMany({
    where: { status: { in: ["canceled", "failed"] }, updatedAt: { lt: new Date(now.getTime() - TERMINAL_RETENTION_MS) } },
  });
  out.deleted = oldSent.count + oldTerminal.count;
  return out;
}
