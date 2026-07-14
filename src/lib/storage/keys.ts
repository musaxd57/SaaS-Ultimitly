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

/**
 * Guard a client-supplied photoUrl at WRITE time: a STORAGE url must resolve to a
 * safe key whose org segment equals `organizationId`. Returns true for a non-storage
 * (legacy /uploads) url — this only rejects a storage url that is malformed or points
 * at ANOTHER tenant, so a poisoned cross-org row can never be stored in the first place
 * (defense-in-depth alongside the deletion choke point + the serve-time org check).
 */
export function isAcceptablePhotoUrl(url: string, organizationId: string): boolean {
  if (!isStoragePhotoUrl(url)) return true; // legacy /uploads or plain path — unaffected here
  const key = keyFromPhotoUrl(url);
  return key !== null && orgIdFromKey(key) === organizationId;
}
