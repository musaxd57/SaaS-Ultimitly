import "server-only";

import { getStorageConfig } from "./config";
import { signedRequest } from "./s3";

// ---------------------------------------------------------------------------
// Provider adapter boundary. Everything that TALKS to the object-storage
// provider goes through this interface, so tests run against an in-memory fake
// (no bucket exists yet → the real adapter must never be exercised in CI) and a
// future provider swap is one class. Errors carry HTTP status codes only —
// never a provider body, never a credential.
// ---------------------------------------------------------------------------

export interface StorageAdapter {
  /** Store one object. Throws (status-code-only message) on any non-2xx. */
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /**
   * Delete one object. IDEMPOTENT: deleting a missing object is SUCCESS
   * (S3/R2 return 204 for missing keys; a 404 is treated as done too), so the
   * deletion queue can retry safely forever.
   */
  delete(key: string): Promise<void>;
}

class S3StorageAdapter implements StorageAdapter {
  constructor(private readonly config: NonNullable<ReturnType<typeof getStorageConfig>>) {}

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const { url, headers } = signedRequest(this.config, "PUT", key, body);
    const res = await fetch(url, { method: "PUT", headers: { ...headers, "content-type": contentType }, body });
    if (!res.ok) throw new Error(`storage put failed: HTTP ${res.status}`);
  }

  async delete(key: string): Promise<void> {
    const { url, headers } = signedRequest(this.config, "DELETE", key, null);
    const res = await fetch(url, { method: "DELETE", headers });
    // 404/204 both mean "the object is not there anymore" → idempotent success.
    if (!res.ok && res.status !== 404) throw new Error(`storage delete failed: HTTP ${res.status}`);
  }
}

/** The real provider adapter, or null when storage env is not configured (fail-closed). */
export function getStorageAdapter(): StorageAdapter | null {
  const config = getStorageConfig();
  if (!config) return null;
  return new S3StorageAdapter(config);
}
