import "server-only";

import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Object-key scheme + validation. The key IS the tenant boundary:
//
//   org/{organizationId}/task/{taskId}/{timestamp}-{random}.{ext}
//
// Keys are ONLY ever built server-side from session/DB ids (never accepted from
// the client), and every consumer (serve route, deletion queue) re-validates
// with `isSafeObjectKey` + compares the org segment against the session — so a
// crafted key can't traverse (`..`), escape the org prefix, or smuggle a
// character the signer/provider might interpret. Fail-closed: anything outside
// the strict shape is rejected.
// ---------------------------------------------------------------------------

/** Same-origin serve prefix — what gets stored in Task/TaskUpdate.photoUrl. */
export const STORAGE_PHOTO_URL_PREFIX = "/api/storage/photo/";

const ID_SEGMENT = /^[a-zA-Z0-9-]{1,64}$/; // cuid-shaped ids only
const FILE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/; // no leading dot, no slash

export function buildTaskPhotoKey(organizationId: string, taskId: string, ext: "jpg" | "png" | "webp"): string {
  if (!ID_SEGMENT.test(organizationId) || !ID_SEGMENT.test(taskId)) {
    throw new Error("storage: invalid id for object key");
  }
  const name = `${Date.now()}-${randomBytes(6).toString("hex")}.${ext}`;
  return `org/${organizationId}/task/${taskId}/${name}`;
}

/** STRICT shape check — the only gate a key must pass before touching the provider. */
export function isSafeObjectKey(key: string): boolean {
  if (typeof key !== "string" || key.length === 0 || key.length > 512) return false;
  if (key.includes("..") || key.includes("//") || key.includes("\\")) return false;
  const parts = key.split("/");
  if (parts.length !== 5) return false;
  const [lit1, orgId, lit2, taskId, file] = parts;
  return (
    lit1 === "org" &&
    lit2 === "task" &&
    ID_SEGMENT.test(orgId) &&
    ID_SEGMENT.test(taskId) &&
    FILE_SEGMENT.test(file)
  );
}

/** The tenant segment of a valid key (null when the key is not safe). */
export function orgIdFromKey(key: string): string | null {
  if (!isSafeObjectKey(key)) return null;
  return key.split("/")[1] ?? null;
}

/** The task segment of a valid key (null when the key is not safe). */
export function taskIdFromKey(key: string): string | null {
  if (!isSafeObjectKey(key)) return null;
  return key.split("/")[3] ?? null;
}

/** photoUrl stored in the DB for a storage-backed photo (same-origin relative → passes the existing validator). */
export function photoUrlForKey(key: string): string {
  return STORAGE_PHOTO_URL_PREFIX + key;
}

export function isStoragePhotoUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith(STORAGE_PHOTO_URL_PREFIX);
}

/** Extract + validate the object key from a stored photoUrl (null when not ours / unsafe). */
export function keyFromPhotoUrl(url: string | null | undefined): string | null {
  if (!isStoragePhotoUrl(url)) return null;
  const key = (url as string).slice(STORAGE_PHOTO_URL_PREFIX.length);
  return isSafeObjectKey(key) ? key : null;
}

/** Eski yerel disk yüklemesinin dosya adı (`/api/upload` bayrak-kapalı dalı + öncesi). */
const LEGACY_UPLOAD_FILE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\.(?:jpe?g|png|webp)$/i;

/**
 * Eski yerel yükleme yolu mu: YALNIZ `/uploads/<bu org'un dizini>/<görsel dosya adı>`.
 *
 * 🚨 09-23 (güvenlik ajanı, kodda doğrulandı): depolama-DIŞI her URL için bu kapı eskiden
 * koşulsuz `true` dönüyordu. Şema yalnız "göreli yol" istediği için en düşük yetkili
 * kullanıcı (temizlikçi, `staff`) kendi görevine `/logout` ya da `/api/...` gibi HERHANGİ
 * bir aynı-kaynak yolu yazabiliyordu; değer sahibin panosunda `<img src>` + `<a href>`
 * olarak çiziliyor → sahibin çerezleriyle TIKSIZ bir GET (CSRF yüzeyi) ve güvenilir
 * görünen iç bağlantı. Uygulamanın ürettiği tek iki biçim depolama yolu ve bu dizindir.
 */
export function isLegacyUploadPhotoUrl(url: string, organizationId: string): boolean {
  const orgSlug = organizationId.replace(/[^a-zA-Z0-9-]/g, ""); // `/api/upload` ile AYNI türetme
  if (!orgSlug) return false;
  const prefix = `/uploads/${orgSlug}/`;
  return url.startsWith(prefix) && LEGACY_UPLOAD_FILE.test(url.slice(prefix.length));
}

/**
 * Guard a client-supplied photoUrl at WRITE time: a STORAGE url must resolve to a
 * safe key whose org segment equals `organizationId` AND (when a taskId is given)
 * whose task segment equals `taskId` — without the taskId check a member could PATCH
 * task-A's object key onto task-B, and deleting task-B would enqueue task-A's
 * still-referenced object for deletion (Codex). A NON-storage url must be this org's
 * legacy upload path (↑`isLegacyUploadPhotoUrl`) — any other same-origin path is
 * rejected. Defense-in-depth alongside the deletion choke point + the serve-time org check.
 */
export function isAcceptablePhotoUrl(url: string, organizationId: string, taskId?: string): boolean {
  if (!isStoragePhotoUrl(url)) return isLegacyUploadPhotoUrl(url, organizationId);
  const key = keyFromPhotoUrl(url);
  if (key === null || orgIdFromKey(key) !== organizationId) return false;
  return taskId === undefined || taskIdFromKey(key) === taskId;
}

/**
 * ÇİZİM kapısı: panoda `<img src>`/`<a href>` olarak basılacak değer. Yazma kapısının
 * görev şartı OLMADAN aynısı — bu düzeltmeden ÖNCE yazılmış (her aynı-kaynak yolunu kabul
 * eden dönemden kalma) satırlar da çizilmeden elenir.
 */
export function isRenderablePhotoUrl(url: string, organizationId: string): boolean {
  return isAcceptablePhotoUrl(url, organizationId);
}

/**
 * Görev başına EN YENİ ÇİZİLEBİLİR fotoğraf (satırlar yeniden eskiye sıralı gelir).
 * Çizilemeyen bir satır o görevin yuvasını KAPATMAZ: eski dönemden kalma keyfi bir yol
 * atlanır ve bir önceki gerçek fotoğraf gösterilir (kanıt kaybolmaz).
 */
export function latestRenderablePhotoByTask(
  rows: ReadonlyArray<{ taskId: string; photoUrl: string | null }>,
  organizationId: string,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    if (!row.photoUrl || out.has(row.taskId)) continue;
    if (!isRenderablePhotoUrl(row.photoUrl, organizationId)) continue;
    out.set(row.taskId, row.photoUrl);
  }
  return out;
}
