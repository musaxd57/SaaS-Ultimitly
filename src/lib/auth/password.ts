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
