import type { StorageAdapter } from "@/lib/storage/adapter";

/**
 * In-memory fake of the S3/R2 adapter. There is NO real bucket yet (and CI must
 * never call a provider), so every storage test runs against this. Mirrors the
 * real adapter's contract exactly: put stores bytes+contentType; delete is
 * IDEMPOTENT (deleting a missing key succeeds); failures throw status-code-only
 * errors like the real one.
 */
export class FakeStorageAdapter implements StorageAdapter {
  objects = new Map<string, { body: Uint8Array; contentType: string }>();
  puts: string[] = [];
  deletes: string[] = [];
  failPuts = false;
  failDeletes = false;

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    if (this.failPuts) throw new Error("storage put failed: HTTP 500");
    this.objects.set(key, { body, contentType });
    this.puts.push(key);
  }

  async delete(key: string): Promise<void> {
    this.deletes.push(key);
    if (this.failDeletes) throw new Error("storage delete failed: HTTP 503");
    this.objects.delete(key); // missing key → still success (S3/R2 semantics)
  }
}
