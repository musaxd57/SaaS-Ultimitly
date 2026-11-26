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
   * (S3/R2 return 204 for missing keys; a 404 `NoSuchKey` is treated as done too —
   * any OTHER 404, e.g. `NoSuchBucket`, is a failure), so the deletion queue can
   * retry safely forever.
   */
  delete(key: string): Promise<void>;
}

/**
 * Sağlayıcı isteğinin üst süresi (15 ajan A11, 10-01 — ölçüldü): PUT / DELETE zaman aşımsızdı → bağlantıyı kabul edip cevap vermeyen
 * sağlayıcıda her DELETE undici'nin 300 sn'lik başlık süresini bekliyordu; silme kuyruğu genel senkron geçişinin İÇİNDE sırayla koştuğu
 * için 25'lik bir parti ~2 saat sürer ve o süre boyunca TÜM kiracıların senkronu / oto-yanıtı / giriş mesajı `already_running` ile
 * dururdu. Diğer bütün dış çağrılar gibi `AbortSignal.timeout`; zaman aşımı yeniden denenebilir hatadır (satır `pending` kalır).
 */
export const STORAGE_REQUEST_TIMEOUT_MS = 10_000;

class S3StorageAdapter implements StorageAdapter {
  constructor(private readonly config: NonNullable<ReturnType<typeof getStorageConfig>>) {}

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const { url, headers } = signedRequest(this.config, "PUT", key, body);
    const res = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "content-type": contentType },
      body,
      signal: AbortSignal.timeout(STORAGE_REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`storage put failed: HTTP ${res.status}`);
  }

  async delete(key: string): Promise<void> {
    const { url, headers } = signedRequest(this.config, "DELETE", key, null);
    const res = await fetch(url, { method: "DELETE", headers, signal: AbortSignal.timeout(STORAGE_REQUEST_TIMEOUT_MS) });
    if (res.ok) return;
    // 404 yalnız "anahtar yok" (`NoSuchKey`) ise başarıdır (S3 / R2 eksik anahtara zaten 204 döner). Başka 404 — `NoSuchBucket`
    // (yanlış / değişmiş `STORAGE_BUCKET`) — başarı SAYILMAZ: sayılsaydı kuyruk her satırı `deleted` yapar ve `objectKey @unique`
    // yüzünden o silme niyetleri bir daha kuyruğa giremezdi (KVKK; 15 ajan A11). Gövde yalnız okunur, hataya / loga GİRMEZ.
    if (res.status === 404 && (await noSuchKey(res))) return;
    throw new Error(`storage delete failed: HTTP ${res.status}`);
  }
}

/** 404 gövdesi `NoSuchKey` mi (S3 XML hata kodu). Okunamayan gövde = hayır (silme başarısız sayılır, yeniden denenir). */
async function noSuchKey(res: Response): Promise<boolean> {
  try {
    const body = (await res.text()).slice(0, 4_096);
    return /<Code>\s*NoSuchKey\s*<\/Code>/i.test(body);
  } catch {
    return false;
  }
}

/** The real provider adapter, or null when storage env is not configured (fail-closed). */
export function getStorageAdapter(): StorageAdapter | null {
  const config = getStorageConfig();
  if (!config) return null;
  return new S3StorageAdapter(config);
}
