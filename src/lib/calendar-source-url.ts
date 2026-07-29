import "server-only";

import { decryptSecretBound, encryptSecretBound, encryptionKeyFingerprint } from "@/lib/crypto";

// ---------------------------------------------------------------------------
// THE accessor for a calendar feed URL — the single place the plaintext leaves
// storage (docs/CALENDAR-URL-ENCRYPTION-DESIGN.md).
//
// Feed URLs carry credentials in their query string, so the column is a secret.
// Expand-contract state: rows written since phase 1 carry urlEnc (AES-256-GCM,
// AAD-bound to this exact row and org via encryptSecretBound) alongside the
// plaintext `url`; legacy rows carry only `url` until the backfill runs.
//
// Read policy, deliberately asymmetric:
//   • urlEnc present  → decrypt it, and on ANY failure (key-fingerprint
//     mismatch, tamper, wrong AAD) FAIL CLOSED — never quietly fall back to the
//     plaintext column. A fallback would make the encryption decorative: the
//     one row an attacker tampered with is exactly the row that must not sync.
//   • urlEnc absent   → plaintext `url` (the migration window for legacy rows).
//
// AAD carries the row id + organizationId, so a ciphertext copied onto another
// row or another org's row fails authentication (EmailOutbox m44 precedent).
// The id therefore has to exist BEFORE encrypting — writers generate it first.
// ---------------------------------------------------------------------------

function calendarUrlAad(id: string, organizationId: string): string {
  return `calendar-source-url:v1:${id}:${organizationId}`;
}

/** Encrypt a feed URL for a row whose id was generated up front (dual-write). */
export function encryptCalendarSourceUrl(
  url: string,
  id: string,
  organizationId: string,
): { urlEnc: string; urlKeyFp: string } {
  return {
    urlEnc: encryptSecretBound(url, calendarUrlAad(id, organizationId)),
    urlKeyFp: encryptionKeyFingerprint(),
  };
}

export interface CalendarSourceUrlRow {
  id: string;
  url: string;
  urlEnc: string | null;
  urlKeyFp: string | null;
}

export type ResolvedCalendarUrl =
  | { ok: true; url: string; legacyPlaintext: boolean }
  | { ok: false; reason: "key-fingerprint-mismatch" | "decrypt-failed" };

/** Resolve the usable feed URL for a row. See the module header for the policy. */
export function getCalendarSourceUrl(
  row: CalendarSourceUrlRow,
  organizationId: string,
): ResolvedCalendarUrl {
  if (row.urlEnc == null) {
    return { ok: true, url: row.url, legacyPlaintext: true };
  }
  // Fingerprint first: a rotated/wrong key gets a named diagnosis instead of a
  // generic auth failure (erasure key-fingerprint precedent).
  if (row.urlKeyFp != null && row.urlKeyFp !== encryptionKeyFingerprint()) {
    return { ok: false, reason: "key-fingerprint-mismatch" };
  }
  try {
    return { ok: true, url: decryptSecretBound(row.urlEnc, calendarUrlAad(row.id, organizationId)), legacyPlaintext: false };
  } catch {
    return { ok: false, reason: "decrypt-failed" };
  }
}

/**
 * Phase-2 backfill: encrypt legacy rows in place, in batches, idempotently
 * (WHERE urlEnc IS NULL — a second run finds nothing to do). Wired for tests
 * and for a MANUAL, user-approved production run; nothing schedules it.
 * Returns how many rows were encrypted.
 */
export async function backfillCalendarSourceUrlEnc(
  db: {
    calendarSource: {
      findMany(args: {
        where: { urlEnc: null };
        select: { id: true; url: true; property: { select: { organizationId: true } } };
        orderBy: { id: "asc" };
        take: number;
      }): Promise<{ id: string; url: string; property: { organizationId: string } }[]>;
      updateMany(args: {
        where: { id: string; urlEnc: null };
        data: { urlEnc: string; urlKeyFp: string };
      }): Promise<{ count: number }>;
    };
  },
  batchSize = 100,
): Promise<number> {
  let encrypted = 0;
  // Loop until a pass finds nothing — updateMany's urlEnc:null guard makes a
  // concurrent writer (phase-1 dual-write) harmless: whoever wrote first wins.
  for (;;) {
    const rows = await db.calendarSource.findMany({
      where: { urlEnc: null },
      select: { id: true, url: true, property: { select: { organizationId: true } } },
      orderBy: { id: "asc" },
      take: batchSize,
    });
    if (rows.length === 0) return encrypted;
    for (const row of rows) {
      const res = await db.calendarSource.updateMany({
        where: { id: row.id, urlEnc: null },
        data: encryptCalendarSourceUrl(row.url, row.id, row.property.organizationId),
      });
      encrypted += res.count;
    }
  }
}
