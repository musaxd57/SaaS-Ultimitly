import "server-only";

import { createHmac, scryptSync } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
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
// RACE MODEL (Codex hardening): a sync run loads the guard ONCE, so a request
// erased MID-RUN is protected by layers, not by the stale map:
//   • a single findMany is statement-snapshot-consistent → the guard can never
//     see a TORN tombstone set;
//   • rows scrubbed by the executor keep their ANON sentinels + message
//     externalIds, so the sync's own resurrection guards + id-dedup hold even
//     with a stale (pre-erasure) map;
//   • the one genuinely unguarded interleave — a stale-guard sync WRITING fresh
//     PII inside/around the erasure transaction — is closed by the executor's
//     POST-COMMIT VERIFY PASS below, which re-reads and re-masks anything that
//     slipped in. The executor also takes an org-scoped advisory xact lock so
//     two concurrent erasures (or a future writer that honors the same lock)
//     serialize instead of interleaving.
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

/** Test hook: forget the derived key (env stubs). */
export function __resetErasureHashKey(): void {
  cachedKey = null;
  cachedFrom = null;
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

// ---------------------------------------------------------------------------
// Ingress guard — one DB read per sync run, in-memory matching per record.
// ---------------------------------------------------------------------------

export interface ErasureGuard {
  /** True when the org has no tombstones — every check short-circuits. */
  isEmpty: boolean;
  /** ABSOLUTE block: this exact stay (by provider ref) was erased on request. */
  blocksSourceReference(sourceReference: string | null | undefined): boolean;
  /**
   * Era block for a PERSON key match: true when the incoming stay belongs to the
   * erased era (departure at/before the request's erasedAt — or unknown, which
   * fails closed for privacy). A stay that begins after the request proceeds
   * (new-data boundary).
   */
  blocksGuestStay(input: TombstoneKeyInput, departureDate: Date | null): boolean;
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

/**
 * Load the org's LIVE tombstones once (Map keyHash→erasedAt). Empty ⇒ no-op
 * guard that never hashes anything (also keeps envs without the dedicated
 * secret working until the first tombstone exists). Rows whose legal retention
 * bound has passed (expiresAt ≤ now) no longer guard (m41).
 */
export async function loadErasureGuard(organizationId: string): Promise<ErasureGuard> {
  const rows = await prisma.erasureTombstone.findMany({
    where: {
      organizationId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { keyHash: true, erasedAt: true },
  });
  if (rows.length === 0) return EMPTY_GUARD;
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
    blocksGuestStay(input, departureDate) {
      const erasedAt = guestEraFor(input);
      if (!erasedAt) return false;
      if (!departureDate) return true; // unknown era on an erased guest → fail closed
      return departureDate.getTime() <= erasedAt.getTime();
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
  /** TEST-ONLY seam: runs between the transaction commit and the verify pass —
   *  lets a test deterministically simulate a racing write in that window. */
  __afterTxHook?: () => Promise<void>,
): Promise<ErasureScope | null> {
  const scope = await loadScope(organizationId, reservationId);
  if (!scope) return null;
  const { reservation, conversations, convIds } = scope;

  const keys = buildTombstoneKeys(organizationId, reservation); // BEFORE the mask nulls the sources
  const erasedAt = new Date();
  const names = [
    reservation.guestName,
    ...conversations.map((c) => c.guestIdentifier),
  ].filter((n): n is string => Boolean(n));

  await prisma.$transaction(async (tx) => {
    // Org-scoped mutual exclusion (auto-released at commit/rollback).
    // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void, which
    // $queryRaw cannot deserialize.
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(${ERASURE_LOCK_NS}::int4, hashtext(${organizationId}))`,
    );
    if (keys.length) {
      await tx.erasureTombstone.createMany({
        data: keys.map((k) => ({
          organizationId,
          keyType: k.keyType,
          keyHash: k.keyHash,
          erasedAt,
        })),
        skipDuplicates: true, // re-erasing the same guest → single row per key
      });
    }
    await maskReservationRows(tx, reservation.id, names);
  });

  if (__afterTxHook) await __afterTxHook();

  // VERIFY PASS (post-commit): a stale-guard sync interleaving with the
  // transaction can have written fresh rows the in-TX mask never saw. Re-read
  // and re-mask once — idempotent, and every later sync is blocked by the
  // now-committed tombstones anyway.
  await maskReservationRows(prisma, reservation.id, names);

  return {
    reservationId: reservation.id,
    conversations: convIds.length,
    inboundMessages: scope.inboundMessages,
    outboundMessages: scope.outboundMessages,
    tombstoneKeys: keys.length,
  };
}
