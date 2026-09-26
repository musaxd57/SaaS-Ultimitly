import "server-only";

import { createHash, randomInt } from "crypto";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// 2FA recovery codes (Codex #20) — the "telefonumu kaybettim" escape hatch.
//
//  * 10 codes per generation, format XXXX-XXXX-XXXX from a 30-char alphabet
//    with the confusable glyphs removed (no I/L/O/U/0/1) → ~59 bits each.
//    crypto.randomInt = CSPRNG.
//  * Stored as domain-separated sha256 HASHES of the normalized code — the
//    plaintext exists only in the generation response (shown once). sha256 is
//    appropriate here (a ~59-bit RANDOM credential, not a human password);
//    deliberately NOT keyed with AUTH_SECRET so a secret rotation can't brick
//    a locked-out user's last way in.
//  * Single-use burn is ATOMIC: conditional updateMany on usedAt (the same
//    pattern as the TOTP step burn / e-mail-verify consume) — two concurrent
//    logins with one code can't both pass.
//  * Regeneration deletes the user's old rows in the same transaction, so old
//    codes die the moment new ones exist.
// ---------------------------------------------------------------------------

export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // 30 chars, unambiguous
const GROUPS = 3;
const GROUP_LEN = 4;
export const RECOVERY_CODE_LEN = GROUPS * GROUP_LEN; // normalized length (12)

/** Uppercase and strip separators/junk — "abcd-efgh jkmn" → "ABCDEFGHJKMN". */
export function normalizeRecoveryCode(input: string): string {
  return (input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Domain-separated hash of a NORMALIZED code (deterministic → indexable). */
export function hashRecoveryCode(normalized: string): string {
  return createHash("sha256").update(`lixus-2fa-recovery:v1:${normalized}`).digest("hex");
}

/** One plaintext code, e.g. "K7QW-P2MH-9DTR". */
export function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let s = "";
    for (let i = 0; i < GROUP_LEN; i++) s += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(s);
  }
  return groups.join("-");
}

/**
 * Replace the user's recovery codes with a fresh set and return the PLAINTEXTS
 * (the only time they ever exist outside the caller's response). Atomic: old
 * codes are gone iff the new ones are in.
 */
export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  await prisma.$transaction([
    prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } }),
    prisma.twoFactorRecoveryCode.createMany({
      data: codes.map((c) => ({ userId, codeHash: hashRecoveryCode(normalizeRecoveryCode(c)) })),
    }),
  ]);
  return codes;
}

/** Delete every recovery code of a user (2FA disable — codes die with it). */
export async function clearRecoveryCodes(userId: string): Promise<void> {
  await prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } });
}

/** Unused codes left — surfaced in Settings so the host knows when to renew. */
export async function remainingRecoveryCodes(userId: string): Promise<number> {
  return prisma.twoFactorRecoveryCode.count({ where: { userId, usedAt: null } });
}

/**
 * Try to burn one recovery code for this user. TRUE exactly once per code:
 * the conditional updateMany is the atomic arbiter (usedAt must still be null),
 * scoped to userId so one user's code can never unlock another's account.
 */
export async function consumeRecoveryCode(userId: string, input: string): Promise<boolean> {
  const normalized = normalizeRecoveryCode(input);
  if (normalized.length !== RECOVERY_CODE_LEN) return false;
  const res = await prisma.twoFactorRecoveryCode.updateMany({
    where: { userId, codeHash: hashRecoveryCode(normalized), usedAt: null },
    data: { usedAt: new Date() },
  });
  return res.count === 1;
}
