import { decryptSecretBound, encryptSecretBound, encryptionKeyFingerprint } from "./crypto-core";

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

/**
 * Phase-4 contract sentinel — the value the plaintext `url` column holds once
 * a row's real URL lives ONLY in urlEnc. Chosen because it can never collide
 * with a legitimate value: the create API has required `https://…` since the
 * column existed, so no real row ever equals "enc:".
 */
export const CALENDAR_URL_SENTINEL = "enc:";

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
  | { ok: false; reason: "key-fingerprint-mismatch" | "decrypt-failed" | "sentinel-without-ciphertext" };

/** Resolve the usable feed URL for a row. See the module header for the policy. */
export function getCalendarSourceUrl(
  row: CalendarSourceUrlRow,
  organizationId: string,
): ResolvedCalendarUrl {
  if (row.urlEnc == null) {
    // A sentinel with no ciphertext is a corrupt state (contract ran but urlEnc
    // was lost/cleared?) — the legacy branch must NEVER hand "enc:" to a fetch
    // as if it were a URL. Fail closed with a named diagnosis instead.
    if (row.url === CALENDAR_URL_SENTINEL) {
      return { ok: false, reason: "sentinel-without-ciphertext" };
    }
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

/** Feed URLs embed bearer-like export secrets (Codex #21) — render host +
 *  masked tail only. Lives here (not in the client component) so the SERVER
 *  masks before anything reaches an RSC payload; post-contract the client
 *  cannot mask anyway (it would only ever see the sentinel). */
export function maskFeedUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/…${url.slice(-6)}`;
  } catch {
    return `…${url.slice(-6)}`;
  }
}

export interface UrlContractReport {
  /** Rows whose url column now (or already) holds the sentinel. */
  sentineled: number;
  /** Rows converted by THIS run. */
  converted: number;
  /** Rows skipped because the last-instant decrypt+compare failed — NEVER converted. */
  refused: number;
  /** Legacy rows (urlEnc NULL) — fatal for the contract, they must be backfilled first. */
  nullEnc: number;
  badIds: string[];
}

/**
 * Phase-4 contract executor: overwrite the plaintext `url` of encrypted rows
 * with the sentinel. IRREVERSIBLE per row once written (the plaintext then
 * lives only in urlEnc + backups), therefore paranoid by construction:
 *
 *   • Each row is decrypted and compared === to its plaintext AT THE LAST
 *     INSTANT, in this process — a row whose ciphertext does not reproduce its
 *     plaintext is REFUSED, never sentineled (the pre-run bulk verify can be
 *     minutes stale; this one cannot).
 *   • The write is a CAS: WHERE id AND url = <the exact plaintext just
 *     verified> AND urlEnc NOT NULL — a concurrent change loses nothing.
 *   • urlEnc-NULL rows are never touched and are reported as fatal.
 *
 * Wired for tests and for a MANUAL, user-approved production run via
 * scripts/contract-calendar-url-sentinel.ts; nothing in the app calls this.
 */
export async function contractCalendarSourceUrlSentinel(
  db: {
    calendarSource: {
      findMany(args: {
        select: {
          id: true;
          url: true;
          urlEnc: true;
          urlKeyFp: true;
          property: { select: { organizationId: true } };
        };
        orderBy: { id: "asc" };
      }): Promise<
        { id: string; url: string; urlEnc: string | null; urlKeyFp: string | null; property: { organizationId: string } }[]
      >;
      updateMany(args: {
        where: { id: string; url: string; urlEnc: { not: null } };
        data: { url: string };
      }): Promise<{ count: number }>;
    };
  },
): Promise<UrlContractReport> {
  const rows = await db.calendarSource.findMany({
    select: { id: true, url: true, urlEnc: true, urlKeyFp: true, property: { select: { organizationId: true } } },
    orderBy: { id: "asc" },
  });
  const report: UrlContractReport = { sentineled: 0, converted: 0, refused: 0, nullEnc: 0, badIds: [] };
  const bad = (id: string) => {
    if (report.badIds.length < 20) report.badIds.push(id);
  };
  for (const row of rows) {
    if (row.urlEnc == null) {
      report.nullEnc++;
      bad(row.id);
      continue;
    }
    if (row.url === CALENDAR_URL_SENTINEL) {
      report.sentineled++; // already contracted (idempotent re-run)
      continue;
    }
    const resolved = getCalendarSourceUrl(row, row.property.organizationId);
    if (!resolved.ok || resolved.url !== row.url) {
      report.refused++;
      bad(row.id);
      continue;
    }
    const res = await db.calendarSource.updateMany({
      where: { id: row.id, url: row.url, urlEnc: { not: null } },
      data: { url: CALENDAR_URL_SENTINEL },
    });
    if (res.count === 1) {
      report.converted++;
      report.sentineled++;
    } else {
      // The row changed between read and write — nothing was overwritten.
      report.refused++;
      bad(row.id);
    }
  }
  return report;
}

/**
 * Rollback tool for the contract window (works as long as ENCRYPTION_KEY is
 * intact): re-materialize the plaintext `url` of sentineled rows by decrypting
 * urlEnc. The write is CAS'd on the sentinel so it can never clobber a real
 * URL. Manual, operator-run (scripts/restore-calendar-url-plaintext.ts).
 */
export async function restoreCalendarSourceUrlPlaintext(
  db: {
    calendarSource: {
      findMany(args: {
        select: {
          id: true;
          url: true;
          urlEnc: true;
          urlKeyFp: true;
          property: { select: { organizationId: true } };
        };
        orderBy: { id: "asc" };
      }): Promise<
        { id: string; url: string; urlEnc: string | null; urlKeyFp: string | null; property: { organizationId: string } }[]
      >;
      updateMany(args: {
        where: { id: string; url: string };
        data: { url: string };
      }): Promise<{ count: number }>;
    };
  },
): Promise<{ restored: number; unreadable: number; badIds: string[] }> {
  const rows = await db.calendarSource.findMany({
    select: { id: true, url: true, urlEnc: true, urlKeyFp: true, property: { select: { organizationId: true } } },
    orderBy: { id: "asc" },
  });
  const out = { restored: 0, unreadable: 0, badIds: [] as string[] };
  for (const row of rows) {
    if (row.url !== CALENDAR_URL_SENTINEL) continue;
    const resolved = row.urlEnc == null ? null : getCalendarSourceUrl(row, row.property.organizationId);
    if (!resolved || !resolved.ok) {
      out.unreadable++;
      if (out.badIds.length < 20) out.badIds.push(row.id);
      continue;
    }
    const res = await db.calendarSource.updateMany({
      where: { id: row.id, url: CALENDAR_URL_SENTINEL },
      data: { url: resolved.url },
    });
    out.restored += res.count;
  }
  return out;
}

export interface UrlContractVerifyReport {
  total: number;
  /** url === sentinel AND urlEnc decrypts cleanly — the only healthy post-contract state. */
  ok: number;
  /** Rows still carrying a real plaintext url (contract incomplete). */
  plaintextRemaining: number;
  nullEnc: number;
  fpMismatch: number;
  decryptFailed: number;
  badIds: string[];
}

/**
 * READ-ONLY post-contract verification. The pre-contract verifier compares the
 * decrypted value to the plaintext column — by definition impossible once the
 * column holds the sentinel. This one asserts the post state instead: every
 * row must have url === sentinel and a urlEnc that actually decrypts under the
 * current key.
 */
export async function verifyCalendarSourceUrlContract(db: {
  calendarSource: {
    findMany(args: {
      select: {
        id: true;
        url: true;
        urlEnc: true;
        urlKeyFp: true;
        property: { select: { organizationId: true } };
      };
      orderBy: { id: "asc" };
    }): Promise<
      { id: string; url: string; urlEnc: string | null; urlKeyFp: string | null; property: { organizationId: string } }[]
    >;
  };
}): Promise<UrlContractVerifyReport> {
  const rows = await db.calendarSource.findMany({
    select: { id: true, url: true, urlEnc: true, urlKeyFp: true, property: { select: { organizationId: true } } },
    orderBy: { id: "asc" },
  });
  const report: UrlContractVerifyReport = {
    total: rows.length,
    ok: 0,
    plaintextRemaining: 0,
    nullEnc: 0,
    fpMismatch: 0,
    decryptFailed: 0,
    badIds: [],
  };
  const bad = (id: string) => {
    if (report.badIds.length < 20) report.badIds.push(id);
  };
  for (const row of rows) {
    if (row.urlEnc == null) {
      report.nullEnc++;
      bad(row.id);
      continue;
    }
    if (row.url !== CALENDAR_URL_SENTINEL) {
      report.plaintextRemaining++;
      bad(row.id);
      continue;
    }
    const resolved = getCalendarSourceUrl(row, row.property.organizationId);
    if (!resolved.ok) {
      if (resolved.reason === "key-fingerprint-mismatch") report.fpMismatch++;
      else report.decryptFailed++;
      bad(row.id);
      continue;
    }
    report.ok++;
  }
  return report;
}

export interface UrlEncVerifyReport {
  total: number;
  nullEnc: number;
  ok: number;
  fpMismatch: number;
  decryptFailed: number;
  plaintextMismatch: number;
  /** First few offending row ids, for diagnosis without dumping the table. */
  badIds: string[];
}

/**
 * READ-ONLY full verification (the contract-phase precondition, also the
 * post-backfill check): every encrypted row must decrypt under its own AAD,
 * carry the active key's fingerprint, and — while the plaintext column still
 * exists — decrypt to EXACTLY that plaintext. Counting rows proves none of
 * this, which is why this walks and opens every single row.
 */
export async function verifyCalendarSourceUrlEnc(db: {
  calendarSource: {
    findMany(args: {
      select: {
        id: true;
        url: true;
        urlEnc: true;
        urlKeyFp: true;
        property: { select: { organizationId: true } };
      };
      orderBy: { id: "asc" };
    }): Promise<
      { id: string; url: string; urlEnc: string | null; urlKeyFp: string | null; property: { organizationId: string } }[]
    >;
  };
}): Promise<UrlEncVerifyReport> {
  const rows = await db.calendarSource.findMany({
    select: { id: true, url: true, urlEnc: true, urlKeyFp: true, property: { select: { organizationId: true } } },
    orderBy: { id: "asc" },
  });
  const report: UrlEncVerifyReport = {
    total: rows.length,
    nullEnc: 0,
    ok: 0,
    fpMismatch: 0,
    decryptFailed: 0,
    plaintextMismatch: 0,
    badIds: [],
  };
  const bad = (id: string) => {
    if (report.badIds.length < 20) report.badIds.push(id);
  };
  for (const row of rows) {
    if (row.urlEnc == null) {
      report.nullEnc++;
      continue;
    }
    const resolved = getCalendarSourceUrl(row, row.property.organizationId);
    if (!resolved.ok) {
      if (resolved.reason === "key-fingerprint-mismatch") report.fpMismatch++;
      else report.decryptFailed++;
      bad(row.id);
      continue;
    }
    if (resolved.url !== row.url) {
      report.plaintextMismatch++;
      bad(row.id);
      continue;
    }
    report.ok++;
  }
  return report;
}
