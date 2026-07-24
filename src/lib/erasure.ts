import "server-only";

import { createHmac, scryptSync } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditInTx } from "@/lib/audit";
import { ANON_NAME, ANON_ID, ANON_BODY, redactNameFromBody } from "@/lib/data-retention";

// ---------------------------------------------------------------------------
// KVKK EXPLICIT-erasure (m40/m41) — guest-level "silme talebi" (Law 6698 art. 11
// via art. 7; Deletion Regulation art. 12). Design: docs/DATA-RETENTION-ERASURE-
// DRAFT.md §8c. Two halves:
//
//  * eraseReservationData — the executor. Captures the guest's identifiers as
//    HMAC hashes (tombstones) FIRST, then irreversibly MASKS the personal data.
//    NAMING (deliberate, legally careful): this scrub implements SİLME in the
//    Regulation-art.-8 sense — the data becomes inaccessible and un-reusable for
//    ilgili kullanıcılar — via masking/redaction. We do NOT claim it is
//    "anonim hale getirme" in the art.-10 technical sense (that bar — no linkage
//    even when combined with other data — is higher; aggregate rows remain).
//
//  * Ingress guards (hospitable-sync + iCal import) — the piece that makes the
//    erasure DURABLE: erased data must stay "tekrar kullanılamaz" (Regulation
//    art. 8), so a provider re-sync may never re-import it — even if the local
//    rows are later deleted entirely and the ANON_NAME sentinel can no longer
//    protect them. Matching is hash-only; with zero tombstones every guard is a
//    no-op (nothing is hashed, nothing is queried per row).
//
// NEW-DATA BOUNDARY (deliberate, documented in §8c-3): a stay that BEGINS after
// the erasure request is a NEW processing activity (art. 5/2-c contract, 5/2-f
// legitimate interest) and is NOT blocked — only the erased era is. The
// reservation named in the request itself (source_reference key) is blocked
// ABSOLUTELY, independent of dates: that object IS the erased data.
//
// RACE MODEL (Codex hardening, STRUCTURAL): every tombstone-scoped ingress
// writer (hospitable-sync, iCal import) fetches provider data OUTSIDE any lock,
// then performs its DB WRITES inside a transaction that (a) first acquires the
// SAME org-scoped advisory xact lock the erasure executor holds, and (b)
// RE-READS the guard INSIDE that lock (loadErasureGuard with the tx client).
// That leaves exactly two possible orderings — the two-orderings theorem:
//   • sync's write-TX commits FIRST → the erasure executor runs after it and
//     masks whatever the sync wrote (its TX + verify pass see those rows);
//   • erasure's TX commits FIRST → the sync's in-lock guard reload sees the
//     fresh tombstones and refuses to write.
// A stale PRE-loaded guard is therefore only ever an optimization (fetch
// saver); it is never the authority for a write. Supporting layers (defense in
// depth, NOT the main guarantee): statement-snapshot guard reads (no torn set),
// ANON sentinels + message-id dedup on masked rows, and the executor's
// post-commit VERIFY PASS re-masking anything written around its window.
// ---------------------------------------------------------------------------

/** Feature switch for the HOST-FACING request surface (route + UI). The ingress
 *  guards are ALWAYS on — they only read tombstones and no-op when none exist. */
export function guestErasureEnabled(): boolean {
  return process.env.GUEST_ERASURE_ENABLED === "1";
}

export type TombstoneKeyType =
  | "source_reference"
  | "guest_external_id"
  | "guest_email"
  | "guest_phone";

// DEDICATED key (Codex): tombstone matching must survive an AUTH_SECRET /
// ENCRYPTION_KEY rotation, and leaking one of those must not let anyone
// recompute guest-identifier hashes — so the HMAC key comes from its own env,
// ERASURE_HMAC_SECRET (boot-gated in production when GUEST_ERASURE_ENABLED=1;
// see scripts/env-check.mjs — and NEVER rotated once tombstones exist). In
// production there is NO fallback: hashing without the dedicated secret throws
// (fail closed — an unprotectable tombstone must never be written). Dev/test
// fall back to AUTH_SECRET so local runs need no extra setup.
const HASH_SALT = "lixus-erasure-tombstone-v1";
// Version prefix baked into every stored hash — a future key rotation ships as
// "v2:" rows + a dual-match window instead of a silent mismatch.
const KEY_VERSION = "v1";
let cachedKey: Buffer | null = null;
let cachedFrom: string | null = null;
function hashKey(): Buffer {
  const dedicated = process.env.ERASURE_HMAC_SECRET;
  const secret =
    dedicated && dedicated.trim().length > 0
      ? dedicated
      : process.env.NODE_ENV === "production"
        ? null
        : process.env.AUTH_SECRET || null;
  if (!secret) {
    throw new Error(
      "ERASURE_HMAC_SECRET tanımlı değil — erasure hash üretilemiyor (üretimde fallback YOK).",
    );
  }
  if (cachedKey && cachedFrom === secret) return cachedKey;
  cachedKey = scryptSync(secret, HASH_SALT, 32);
  cachedFrom = secret;
  return cachedKey;
}

// Alarm hygiene for the FAIL-CLOSED path (Codex op note): with the secret
// missing, the 2-minute cron (and iCal's per-row guard loads) would otherwise
// emit a reportError EACH time — email is already throttled per context, but
// every call is still a Sentry event + a Railway log line (the #4 aggregate
// lesson). One report per org per window; the BLOCK itself stays unconditional.
const KEY_MISSING_REPORT_THROTTLE_MS = 10 * 60 * 1000;
const keyMissingLastReport = new Map<string, number>();

/** Test hook: forget the derived key + the fail-closed report throttle (env stubs). */
export function __resetErasureHashKey(): void {
  cachedKey = null;
  cachedFrom = null;
  keyMissingLastReport.clear();
}

/**
 * A short, non-reversible FINGERPRINT of the CURRENT HMAC key (Codex P1). The
 * "v1:" hash prefix only marks the SCHEME version — it does NOT change when the
 * SECRET VALUE changes, so a rotated/mistyped secret would silently produce
 * hashes that no longer match the stored v1 rows and the tombstones would go
 * quietly ineffective. Every tombstone stores this fingerprint at write time;
 * loadErasureGuard fails CLOSED when a live row's fingerprint doesn't match the
 * current key (see there). Derived from the key itself → reveals nothing.
 */
export function currentKeyFingerprint(): string {
  return createHmac("sha256", hashKey()).update("erasure-key-fingerprint").digest("hex").slice(0, 16);
}

/** Normalize an identifier per type so the same real-world value always hashes
 *  identically (email case/space, phone formatting). Returns null when the value
 *  is too weak to be a safe match key (empty / junk-short phone). */
export function normalizeTombstoneValue(type: TombstoneKeyType, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  switch (type) {
    case "guest_email":
      return v.toLowerCase();
    case "guest_phone": {
      const digits = v.replace(/\D/g, "");
      return digits.length >= 7 ? digits : null; // <7 digits → collision junk, skip
    }
    default:
      return v; // provider ids / UIDs are case-sensitive opaque strings
  }
}

/**
 * "v1:" + HMAC-SHA256("orgId|type:normalized") — the ONLY form an identifier is
 * stored in. The org id is part of the HMAC DOMAIN (tenant separation): the same
 * email erased in two tenants produces unrelated hashes, so tombstone rows can
 * never be correlated across tenants even if the table leaks.
 */
export function tombstoneKeyHash(
  organizationId: string,
  type: TombstoneKeyType,
  value: string,
): string | null {
  const norm = normalizeTombstoneValue(type, value);
  if (norm === null) return null;
  const digest = createHmac("sha256", hashKey())
    .update(`${organizationId}|${type}:${norm}`)
    .digest("hex");
  return `${KEY_VERSION}:${digest}`;
}

export interface TombstoneKeyInput {
  sourceReference?: string | null;
  guestExternalId?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
}

/** Hash every usable identifier of a guest/stay into tombstone key rows. */
export function buildTombstoneKeys(
  organizationId: string,
  input: TombstoneKeyInput,
): { keyType: TombstoneKeyType; keyHash: string }[] {
  const out: { keyType: TombstoneKeyType; keyHash: string }[] = [];
  const push = (keyType: TombstoneKeyType, raw: string | null | undefined) => {
    if (!raw) return;
    const keyHash = tombstoneKeyHash(organizationId, keyType, raw);
    if (keyHash) out.push({ keyType, keyHash });
  };
  push("source_reference", input.sourceReference);
  push("guest_external_id", input.guestExternalId);
  push("guest_email", input.guestEmail);
  push("guest_phone", input.guestPhone);
  return out;
}

// Advisory-lock namespace for the erasure executor ("m40") — disjoint from the
// feed-reconcile namespace (23) and the outbox claim locks.
const ERASURE_LOCK_NS = 40;

/** A client the guard/lock helpers can run on — the global client or a tx. */
export type ErasureDb = Prisma.TransactionClient | typeof prisma;

/**
 * Acquire the org-scoped erasure advisory lock on THIS transaction (auto-released
 * at commit/rollback). Shared by the erasure executor and every tombstone-scoped
 * ingress write-transaction — the single mutual-exclusion point of the RACE
 * MODEL above. $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void,
 * which $queryRaw cannot deserialize.
 */
export async function acquireErasureLock(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(${ERASURE_LOCK_NS}::int4, hashtext(${organizationId}))`,
  );
}

// ---------------------------------------------------------------------------
// Ingress guard — one DB read per sync run, in-memory matching per record.
// ---------------------------------------------------------------------------

export interface ErasureGuard {
  /** True when the org has no tombstones — every check short-circuits. */
  isEmpty: boolean;
  /** ABSOLUTE block: this exact stay (by provider ref) was erased on request. */
  blocksSourceReference(sourceReference: string | null | undefined): boolean;
  /**
   * Era block for a PERSON key match, decided by ARRIVAL (Codex P2): the new-data
   * boundary is "a stay that BEGINS after the request". So block when the stay
   * arrives at/before erasedAt (erased era OR still-ongoing/overlapping at the
   * request), and also when arrival is unknown (fail closed). Only a stay whose
   * arrival is strictly after erasedAt is genuinely new processing → allowed.
   */
  blocksGuestStay(input: TombstoneKeyInput, arrivalDate: Date | null): boolean;
  /**
   * Extra message-era cutoff for an ALLOWED stay of a tombstoned guest: messages
   * created at/before the erasure instant never re-import (belt-and-suspenders —
   * a re-used provider thread must not resurrect pre-erasure lines).
   */
  messageCutoffFor(input: TombstoneKeyInput): Date | null;
}

const EMPTY_GUARD: ErasureGuard = {
  isEmpty: true,
  blocksSourceReference: () => false,
  blocksGuestStay: () => false,
  messageCutoffFor: () => null,
};

// FAIL-CLOSED guard (Codex): tombstones EXIST but the HMAC key is unavailable
// (e.g. the flag was later switched off and ERASURE_HMAC_SECRET removed — the
// existing tombstones must keep protecting regardless of the flag). Without the
// key nothing can be matched, so the only privacy-safe answer is to block EVERY
// candidate: the sync imports nothing for this org until the secret is restored.
// Loud on purpose — this is a misconfiguration, not a normal state.
const BLOCK_ALL_GUARD: ErasureGuard = {
  isEmpty: false,
  blocksSourceReference: () => true,
  blocksGuestStay: () => true,
  messageCutoffFor: () => null,
};

/**
 * Load the org's LIVE tombstones once (Map keyHash→erasedAt). Empty ⇒ no-op
 * guard that never hashes anything (also keeps envs without the dedicated
 * secret working until the first tombstone exists). Rows whose legal retention
 * bound has passed (expiresAt ≤ now) no longer guard (m41). Pass a transaction
 * client to read INSIDE an advisory-locked write-transaction (see RACE MODEL).
 */
export async function loadErasureGuard(
  organizationId: string,
  db: ErasureDb = prisma,
): Promise<ErasureGuard> {
  const rows = await db.erasureTombstone.findMany({
    where: {
      organizationId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { keyHash: true, erasedAt: true, keyFingerprint: true },
  });
  if (rows.length === 0) return EMPTY_GUARD;

  // The key MUST be available AND match the one that produced these rows. A
  // missing secret throws; a WRONG secret (rotated/mistyped) computes a
  // fingerprint that won't match the stored one — both mean we can't reliably
  // match, so we fail CLOSED (block everything) rather than let erased data back
  // in silently. Report throttled per org (guard loads once per Hospitable run
  // but once per ROW on iCal; the cron fires every 2 min).
  const reportOnce = async (reason: string, err: unknown) => {
    const now = Date.now();
    if (now - (keyMissingLastReport.get(organizationId) ?? 0) >= KEY_MISSING_REPORT_THROTTLE_MS) {
      keyMissingLastReport.set(organizationId, now);
      const { reportError } = await import("@/lib/report-error");
      void reportError(`erasure-guard ${reason} org:${organizationId}`, err).catch(() => {});
    }
  };
  let fp: string;
  try {
    fp = currentKeyFingerprint();
  } catch (err) {
    await reportOnce("key unavailable", err);
    return BLOCK_ALL_GUARD;
  }
  // Any live row hashed under a DIFFERENT key can no longer be matched → the
  // current key can't guarantee protection for THIS org → block everything.
  if (rows.some((r) => r.keyFingerprint !== fp)) {
    await reportOnce("key fingerprint mismatch (rotation/misconfig)", new Error("tombstone key fingerprint mismatch"));
    return BLOCK_ALL_GUARD;
  }
  const byHash = new Map(rows.map((r) => [r.keyHash, r.erasedAt]));

  const guestEraFor = (input: TombstoneKeyInput): Date | null => {
    let latest: Date | null = null;
    for (const k of buildTombstoneKeys(organizationId, { ...input, sourceReference: null })) {
      const at = byHash.get(k.keyHash);
      if (at && (!latest || at > latest)) latest = at;
    }
    return latest;
  };

  return {
    isEmpty: false,
    blocksSourceReference(sourceReference) {
      if (!sourceReference) return false;
      const h = tombstoneKeyHash(organizationId, "source_reference", sourceReference);
      return h !== null && byHash.has(h);
    },
    blocksGuestStay(input, arrivalDate) {
      const erasedAt = guestEraFor(input);
      if (!erasedAt) return false;
      if (!arrivalDate) return true; // unknown arrival on an erased guest → fail closed
      // New processing ONLY when the stay begins strictly after the request.
      return arrivalDate.getTime() <= erasedAt.getTime();
    },
    messageCutoffFor(input) {
      return guestEraFor(input);
    },
  };
}

// ---------------------------------------------------------------------------
// Executor + preview (host-facing; tenant-scoped by the route).
// ---------------------------------------------------------------------------

export interface ErasureScope {
  reservationId: string;
  conversations: number;
  inboundMessages: number;
  outboundMessages: number;
  tombstoneKeys: number;
}

async function loadScope(organizationId: string, reservationId: string) {
  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, property: { organizationId } },
    select: {
      id: true,
      guestName: true,
      guestEmail: true,
      guestPhone: true,
      guestExternalId: true,
      sourceReference: true,
    },
  });
  if (!reservation) return null;
  const conversations = await prisma.conversation.findMany({
    where: { reservationId: reservation.id },
    select: { id: true, guestIdentifier: true },
  });
  const convIds = conversations.map((c) => c.id);
  const [inboundMessages, outboundMessages] = convIds.length
    ? await Promise.all([
        prisma.message.count({ where: { conversationId: { in: convIds }, direction: "inbound" } }),
        prisma.message.count({ where: { conversationId: { in: convIds }, direction: "outbound" } }),
      ])
    : [0, 0];
  return { reservation, conversations, convIds, inboundMessages, outboundMessages };
}

/**
 * Which of these reservations were EXPLICITLY erased (have a source_reference
 * tombstone) — distinct from merely retention-masked rows (Codex P1). The UI uses
 * this so a time-based ANON_NAME row still shows the erasure button, and only a
 * genuinely-erased row shows "permanently deleted, sync won't restore". Returns
 * an empty set if the HMAC key is unavailable (never claim erased without proof).
 */
export async function reservationsWithSourceTombstone(
  organizationId: string,
  reservations: { id: string; sourceReference: string | null }[],
): Promise<Set<string>> {
  let byHash: { id: string; hash: string }[];
  try {
    byHash = reservations
      .map((r) => {
        const hash = r.sourceReference
          ? tombstoneKeyHash(organizationId, "source_reference", r.sourceReference)
          : null;
        return hash ? { id: r.id, hash } : null;
      })
      .filter((x): x is { id: string; hash: string } => x !== null);
  } catch {
    return new Set(); // key unavailable → prove nothing
  }
  if (byHash.length === 0) return new Set();
  const rows = await prisma.erasureTombstone.findMany({
    where: { organizationId, keyHash: { in: byHash.map((x) => x.hash) } },
    select: { keyHash: true },
  });
  const present = new Set(rows.map((r) => r.keyHash));
  return new Set(byHash.filter((x) => present.has(x.hash)).map((x) => x.id));
}

/** What WOULD be masked — shown to the host before they confirm. No writes. */
export async function previewReservationErasure(
  organizationId: string,
  reservationId: string,
): Promise<ErasureScope | null> {
  const scope = await loadScope(organizationId, reservationId);
  if (!scope) return null;
  return {
    reservationId: scope.reservation.id,
    conversations: scope.convIds.length,
    inboundMessages: scope.inboundMessages,
    outboundMessages: scope.outboundMessages,
    tombstoneKeys: buildTombstoneKeys(organizationId, scope.reservation).length,
  };
}

/** One idempotent masking sweep over a reservation's linked rows. Used by the
 *  executor transaction AND re-run post-commit (verify pass) — see RACE MODEL. */
async function maskReservationRows(
  db: Prisma.TransactionClient,
  organizationId: string,
  reservationId: string,
  names: string[],
): Promise<void> {
  const convs = await db.conversation.findMany({
    where: { reservationId },
    select: { id: true, guestIdentifier: true },
  });
  const convIds = convs.map((c) => c.id);
  // A conversation created by a racing stale-guard sync carries a fresh
  // identifier — fold it into the redaction set before masking it away.
  const allNames = [
    ...names,
    ...convs.map((c) => c.guestIdentifier).filter((n): n is string => Boolean(n)),
  ];
  if (convIds.length) {
    const outbound = await db.message.findMany({
      where: { conversationId: { in: convIds }, direction: "outbound" },
      select: { id: true, body: true },
    });
    for (const m of outbound) {
      const red = redactNameFromBody(m.body, allNames);
      if (red !== m.body) {
        await db.message.update({ where: { id: m.id }, data: { body: red } });
      }
    }
    await db.message.updateMany({
      where: { conversationId: { in: convIds }, direction: "inbound", body: { not: ANON_BODY } },
      data: { body: ANON_BODY, senderName: ANON_ID, aiSuggestedReply: null },
    });
    await db.conversation.updateMany({
      where: { id: { in: convIds } },
      data: { guestIdentifier: ANON_ID },
    });
  }
  await db.reservation.updateMany({
    where: { id: reservationId },
    data: {
      guestName: ANON_NAME,
      guestPhone: null,
      guestEmail: null,
      guestExternalId: null,
      guestCheckoutTime: null,
      notes: null,
    },
  });

  // MessageOutbox rows carry the exact SEND text (PII) even after the Message is
  // masked (Codex P1). Redact the body of every outbox row linked to this erased
  // data; a not-yet-delivered, UNCLAIMED row is also canceled so the worker never
  // delivers the sentinel. (A claimed in-flight row — durable-outbox + erasure
  // both ON and a send to THIS guest mid-POST — has its body redacted but is left
  // for the worker to finish: documented, vanishingly narrow, and the sentinel is
  // non-PII.) org-scoped WHERE so a null reservationId link can't reach another tenant.
  const outboxLink = {
    organizationId,
    OR: [
      { reservationId },
      ...(convIds.length ? [{ conversationId: { in: convIds } }] : []),
    ],
  };
  await db.messageOutbox.updateMany({
    where: {
      ...outboxLink,
      status: { in: ["pending", "ambiguous"] },
      claimedBy: null,
    },
    data: { body: ANON_BODY, status: "canceled" },
  });
  await db.messageOutbox.updateMany({
    where: { ...outboxLink, body: { not: ANON_BODY } },
    data: { body: ANON_BODY },
  });
}

/**
 * Execute the explicit erasure for ONE stay. Irreversible. Order matters:
 * tombstones are written IN THE SAME TRANSACTION as the mask, from identifiers
 * captured BEFORE anything is overwritten — a crash can never leave the data
 * masked-but-unprotected or protected-but-present inconsistently. The
 * transaction holds an org-scoped advisory xact lock (serializes concurrent
 * erasures), and a post-commit VERIFY PASS re-masks anything a racing
 * stale-guard sync wrote around the transaction window (see RACE MODEL above).
 */
export async function eraseReservationData(
  organizationId: string,
  reservationId: string,
  opts?: {
    /** The owner who requested the erasure — recorded on the MANDATORY, in-transaction
     *  AuditLog row (Deletion Regulation art. 7). Null in direct-lib tests. */
    actorUserId?: string | null;
    /** TEST-ONLY seam: runs between the transaction commit and the verify pass —
     *  lets a test deterministically simulate a racing write in that window. */
    __afterTxHook?: () => Promise<void>;
  },
): Promise<ErasureScope | null> {
  const actorUserId = opts?.actorUserId ?? null;
  const __afterTxHook = opts?.__afterTxHook;
  const scope = await loadScope(organizationId, reservationId);
  if (!scope) return null;
  const { reservation, conversations, convIds } = scope;

  const keys = buildTombstoneKeys(organizationId, reservation); // BEFORE the mask nulls the sources
  const erasedAt = new Date();
  const names = [
    reservation.guestName,
    ...conversations.map((c) => c.guestIdentifier),
  ].filter((n): n is string => Boolean(n));

  const fp = currentKeyFingerprint(); // which key produced these hashes (Codex P1)

  await prisma.$transaction(async (tx) => {
    // Org-scoped mutual exclusion (auto-released at commit/rollback) — the same
    // lock every tombstone-scoped ingress write-transaction takes (RACE MODEL).
    await acquireErasureLock(tx, organizationId);
    if (keys.length) {
      await tx.erasureTombstone.createMany({
        data: keys.map((k) => ({
          organizationId,
          keyType: k.keyType,
          keyHash: k.keyHash,
          erasedAt,
          keyFingerprint: fp,
        })),
        skipDuplicates: true, // re-erasing the same guest → single row per key
      });
      // A repeat erasure of the SAME guest must ADVANCE the cutoff (Codex P2):
      // createMany(skipDuplicates) leaves a pre-existing key at its OLD erasedAt.
      // Bump only rows that are older (exact max semantics), refresh the
      // fingerprint, and clear any prior expiry (a fresh request has no bound
      // unless the lawyer sets one).
      await tx.erasureTombstone.updateMany({
        where: { organizationId, keyHash: { in: keys.map((k) => k.keyHash) }, erasedAt: { lt: erasedAt } },
        data: { erasedAt, keyFingerprint: fp, expiresAt: null },
      });
    }
    await maskReservationRows(tx, organizationId, reservation.id, names);

    // MANDATORY audit, IN THIS TRANSACTION (Codex P1-B): Deletion Regulation art. 7
    // requires the destruction to be LOGGED, so the legal record commits together
    // with the scrub — never one without the other. If this insert fails the whole
    // erasure rolls back and the route surfaces a 500 (the owner retries); we never
    // destroy without a log. Counts ONLY — never guest identifiers. This is the one
    // audit that must be atomic, so it does NOT use the fire-and-forget writeAudit.
    await writeAuditInTx(tx, {
      organizationId,
      actorUserId,
      action: "kvkk.guest_erasure",
      metadata: {
        reservationId: reservation.id, // opaque row id — not personal data
        conversations: convIds.length,
        inboundMessages: scope.inboundMessages,
        outboundMessages: scope.outboundMessages,
        tombstoneKeys: keys.length,
      },
    });
  },
  // The lock acquire can WAIT behind a long ingress write-transaction (a big
  // thread import holds the org lock for its whole TX) — give the executor the
  // same ceiling so a busy sync never times the erasure out.
  { timeout: 180_000, maxWait: 15_000 });

  if (__afterTxHook) await __afterTxHook();

  // VERIFY PASS (post-commit): a stale-guard sync interleaving with the
  // transaction can have written fresh rows the in-TX mask never saw. Re-read
  // and re-mask once — idempotent, and every later sync is blocked by the
  // now-committed tombstones anyway.
  await maskReservationRows(prisma, organizationId, reservation.id, names);

  return {
    reservationId: reservation.id,
    conversations: convIds.length,
    inboundMessages: scope.inboundMessages,
    outboundMessages: scope.outboundMessages,
    tombstoneKeys: keys.length,
  };
}
