import "server-only";

// ---------------------------------------------------------------------------
// Private object storage (S3/R2) — configuration. DEFAULT OFF.
//
// Two independent questions, on purpose:
//   • storageConfigured()     — are the provider credentials present? Governs
//     READ (signed GET) and the deletion drain, so a flag-off ROLLBACK never
//     breaks already-stored photos or strands queued deletions.
//   • storageUploadsEnabled() — is the STORAGE_ENABLED flag on AND configured?
//     Governs NEW uploads only. Flag off ⇒ the legacy local-disk path runs
//     byte-identically.
//
// Fail-closed: any missing/invalid piece ⇒ null config ⇒ every storage feature
// quietly stays off. Secrets are NEVER logged (values never leave this module
// except inside the SigV4 HMAC chain).
// ---------------------------------------------------------------------------

export interface StorageConfig {
  /** S3-compatible endpoint origin, e.g. https://<account>.r2.cloudflarestorage.com */
  endpoint: string;
  bucket: string;
  /** SigV4 region — R2 uses "auto". */
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function flagOn(v: string | undefined): boolean {
  const t = (v ?? "").trim().toLowerCase();
  return t === "1" || t === "true";
}

/** Resolve the provider config from env, or null when anything is missing/invalid. */
export function getStorageConfig(env: Record<string, string | undefined> = process.env): StorageConfig | null {
  const endpoint = (env.STORAGE_ENDPOINT ?? "").trim().replace(/\/+$/, "");
  const bucket = (env.STORAGE_BUCKET ?? "").trim();
  const region = (env.STORAGE_REGION ?? "").trim() || "auto";
  const accessKeyId = (env.STORAGE_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = (env.STORAGE_SECRET_ACCESS_KEY ?? "").trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  // HTTPS only — a plaintext endpoint would leak the signed URLs (and objects).
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  // Bucket goes into a URL path segment — keep it to the S3 naming charset.
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) return null;
  return { endpoint, bucket, region, accessKeyId, secretAccessKey };
}

/** Provider credentials present (governs signed GET + deletion drain). */
export function storageConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return getStorageConfig(env) !== null;
}

/** NEW uploads go to object storage (flag ON and configured). DEFAULT OFF. */
export function storageUploadsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return flagOn(env.STORAGE_ENABLED) && storageConfigured(env);
}
