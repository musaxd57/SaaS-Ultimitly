import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

// ---------------------------------------------------------------------------
// Tiny authenticated-encryption box for secrets at rest (e.g. each customer's
// Hospitable Personal Access Token). AES-256-GCM, so a stored value is both
// confidential and tamper-evident.
//
// The key is derived from ENCRYPTION_KEY (preferred) or AUTH_SECRET (fallback,
// always present) via scrypt — so no new required env var. NOTE: if that secret
// ever changes, previously encrypted values can no longer be decrypted and the
// owner simply re-connects. Keep ENCRYPTION_KEY stable in production.
// ---------------------------------------------------------------------------

const ALG = "aes-256-gcm";
const SALT = "lixus-secret-box-v1"; // fixed salt: key is per-deployment, not per-value

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "ENCRYPTION_KEY (veya AUTH_SECRET) tanımlı değil — gizli veri şifrelenemiyor.",
    );
  }
  cachedKey = scryptSync(secret, SALT, 32);
  return cachedKey;
}

/**
 * Encrypt a plaintext secret into a compact, self-describing string:
 *   "v1.<iv b64>.<authTag b64>.<ciphertext b64>"
 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

/** Decrypt a value produced by {@link encryptSecret}. Throws if tampered or garbled. */
export function decryptSecret(payload: string): string {
  const [v, ivb, tagb, datab] = payload.split(".");
  if (v !== "v1" || !ivb || !tagb || !datab) {
    throw new Error("Bozuk şifreli veri.");
  }
  const decipher = createDecipheriv(ALG, key(), Buffer.from(ivb, "base64"));
  decipher.setAuthTag(Buffer.from(tagb, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(datab, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
