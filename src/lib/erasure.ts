import "server-only";

import { createHmac, scryptSync } from "crypto";
import { prisma } from "@/lib/db";
import { ANON_NAME, ANON_ID, ANON_BODY, redactNameFromBody } from "@/lib/data-retention";

// ---------------------------------------------------------------------------
// KVKK EXPLICIT-erasure (m40) — guest-level "silme talebi" (Law 6698 art. 11 via
// art. 7; Deletion Regulation art. 12). Design: docs/DATA-RETENTION-ERASURE-
// DRAFT.md §8c. Two halves:
//
//  * eraseReservationData — the executor. Captures the guest's identifiers as
//    HMAC hashes (tombstones) FIRST, then applies the SAME irreversible scrub the
//    retention sweep uses (anonymization satisfies art. 7 — "sil, yok et VEYA
//    anonim hale getir"). Rows stay (occupancy/reports intact), personal data goes.
//
//  * Ingress guards (used by hospitable-sync + iCal import) — the piece that makes
//    the erasure DURABLE: erased data must stay "tekrar kullanılamaz" (Regulation
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

// Key derivation mirrors src/lib/crypto.ts (scrypt over ENCRYPTION_KEY with a
// module-specific salt → no new required env var; AUTH_SECRET fallback keeps
// dev/test working). Deterministic on purpose: lookups must re-derive the hash.
const HASH_SALT = "lixus-erasure-tombstone-v1";
let cachedKey: Buffer | null = null;
function hashKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY (veya AUTH_SECRET) tanımlı değil — erasure hash üretilemiyor.");
  }
  cachedKey = scryptSync(secret, HASH_SALT, 32);
  return cachedKey;
}

/** Test hook: forget the derived key (env stubs). */
export function __resetErasureHashKey(): void {
  cachedKey = null;
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

/** HMAC-SHA256("type:normalized") — the ONLY form an identifier is stored in. */
export function tombstoneKeyHash(type: TombstoneKeyType, value: string): string | null {
  const norm = normalizeTombstoneValue(type, value);
  if (norm === null) return null;
  return createHmac("sha256", hashKey()).update(`${type}:${norm}`).digest("hex");
}

export interface TombstoneKeyInput {
  sourceReference?: string | null;
  guestExternalId?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
}

/** Hash every usable identifier of a guest/stay into tombstone key rows. */
export function buildTombstoneKeys(input: TombstoneKeyInput): { keyType: TombstoneKeyType; keyHash: string }[] {
  const out: { keyType: TombstoneKeyType; keyHash: string }[] = [];
  const push = (keyType: TombstoneKeyType, raw: string | null | undefined) => {
    if (!raw) return;
    const keyHash = tombstoneKeyHash(keyType, raw);
    if (keyHash) out.push({ keyType, keyHash });
  };
  push("source_reference", input.sourceReference);
  push("guest_external_id", input.guestExternalId);
  push("guest_email", input.guestEmail);
  push("guest_phone", input.guestPhone);
  return out;
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

/** Load the org's tombstones once (Map keyHash→erasedAt). Empty ⇒ no-op guard
 *  that never hashes anything (also keeps envs without ENCRYPTION_KEY working). */
export async function loadErasureGuard(organizationId: string): Promise<ErasureGuard> {
  const rows = await prisma.erasureTombstone.findMany({
    where: { organizationId },
    select: { keyHash: true, erasedAt: true },
  });
  if (rows.length === 0) return EMPTY_GUARD;
  const byHash = new Map(rows.map((r) => [r.keyHash, r.erasedAt]));

  const guestEraFor = (input: TombstoneKeyInput): Date | null => {
    let latest: Date | null = null;
    for (const k of buildTombstoneKeys({ ...input, sourceReference: null })) {
      const at = byHash.get(k.keyHash);
      if (at && (!latest || at > latest)) latest = at;
    }
    return latest;
  };

  return {
    isEmpty: false,
    blocksSourceReference(sourceReference) {
      if (!sourceReference) return false;
      const h = tombstoneKeyHash("source_reference", sourceReference);
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

/** What WOULD be scrubbed — shown to the host before they confirm. No writes. */
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
    tombstoneKeys: buildTombstoneKeys(scope.reservation).length,
  };
}

/**
 * Execute the explicit erasure for ONE stay. Irreversible. Order matters:
 * tombstones are written IN THE SAME TRANSACTION as the scrub, from identifiers
 * captured BEFORE anything is overwritten — a crash can never leave the data
 * scrubbed-but-unprotected or protected-but-present inconsistently.
 * Scrub = the retention sweep's exact mechanic (same sentinels), so every
 * existing resurrection guard keeps recognizing the rows.
 */
export async function eraseReservationData(
  organizationId: string,
  reservationId: string,
): Promise<ErasureScope | null> {
  const scope = await loadScope(organizationId, reservationId);
  if (!scope) return null;
  const { reservation, conversations, convIds } = scope;

  const keys = buildTombstoneKeys(reservation); // BEFORE the scrub nulls the sources
  const erasedAt = new Date();

  // Outbound bodies keep the host's record — only the guest's name is redacted.
  // Names captured pre-scrub (sweep precedent).
  const names = [
    reservation.guestName,
    ...conversations.map((c) => c.guestIdentifier),
  ].filter((n): n is string => Boolean(n));
  const outbound = convIds.length
    ? await prisma.message.findMany({
        where: { conversationId: { in: convIds }, direction: "outbound" },
        select: { id: true, body: true },
      })
    : [];
  const bodyRedactions: { id: string; body: string }[] = [];
  for (const m of outbound) {
    const red = redactNameFromBody(m.body, names);
    if (red !== m.body) bodyRedactions.push({ id: m.id, body: red });
  }

  await prisma.$transaction([
    ...(keys.length
      ? [
          prisma.erasureTombstone.createMany({
            data: keys.map((k) => ({ organizationId, keyType: k.keyType, keyHash: k.keyHash, erasedAt })),
            skipDuplicates: true, // re-erasing the same guest → single row per key
          }),
        ]
      : []),
    ...(convIds.length
      ? [
          prisma.message.updateMany({
            where: { conversationId: { in: convIds }, direction: "inbound", body: { not: ANON_BODY } },
            data: { body: ANON_BODY, senderName: ANON_ID, aiSuggestedReply: null },
          }),
          prisma.conversation.updateMany({
            where: { id: { in: convIds } },
            data: { guestIdentifier: ANON_ID },
          }),
        ]
      : []),
    ...bodyRedactions.map((r) => prisma.message.update({ where: { id: r.id }, data: { body: r.body } })),
    prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        guestName: ANON_NAME,
        guestPhone: null,
        guestEmail: null,
        guestExternalId: null,
        guestCheckoutTime: null,
        notes: null,
      },
    }),
  ]);

  return {
    reservationId: reservation.id,
    conversations: convIds.length,
    inboundMessages: scope.inboundMessages,
    outboundMessages: scope.outboundMessages,
    tombstoneKeys: keys.length,
  };
}
