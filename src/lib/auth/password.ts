import bcrypt from "bcryptjs";

// bcrypt cost factor. 12 is the current sane default; existing hashes carry
// their own cost so older 10-cost hashes keep verifying (re-hashed on next set).
const SALT_ROUNDS = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// A fixed, valid bcrypt hash (cost 12, matching SALT_ROUNDS) of a throwaway
// secret. It is NEVER anyone's real password, so a comparison against it always
// fails — its only job is to spend the SAME bcrypt time on a login attempt for a
// non-existent email as for a real account.
const DUMMY_HASH = "$2a$12$pW7aCpH9gDjLDJgWwMZS9e4XetljqUVeM6688s259LuXEGh42XYii";

/**
 * Constant-time guard for the "no such user" branch: runs a real bcrypt compare
 * (result discarded) so an attacker can't tell a registered email from an
 * unregistered one by response latency (user enumeration). Always resolves; the
 * caller still returns the same generic "wrong credentials" error either way.
 */
export async function dummyVerifyPassword(password: string): Promise<void> {
  await bcrypt.compare(password, DUMMY_HASH);
}
