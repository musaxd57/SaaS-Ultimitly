import { describe, it, expect } from "vitest";
import {
  buildTaskPhotoKey,
  isSafeObjectKey,
  orgIdFromKey,
  photoUrlForKey,
  keyFromPhotoUrl,
  isStoragePhotoUrl,
  isAcceptablePhotoUrl,
  STORAGE_PHOTO_URL_PREFIX,
} from "@/lib/storage/keys";
import { getStorageConfig, storageConfigured, storageUploadsEnabled } from "@/lib/storage/config";
import { presignGetUrl, signedRequest, SIGNED_URL_MAX_TTL_S } from "@/lib/storage/s3";
import { checkProductionEnv } from "../../scripts/env-check.mjs";

const SECRET = "super-secret-provider-key-DO-NOT-LEAK";
const CONFIG = {
  endpoint: "https://acc.r2.cloudflarestorage.com",
  bucket: "lixus-photos",
  region: "auto",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: SECRET,
};

describe("object keys — the tenant boundary, fail-closed", () => {
  it("builds an org/task-scoped key and round-trips through the photoUrl helpers", () => {
    const key = buildTaskPhotoKey("org123", "task456", "jpg");
    expect(key.startsWith("org/org123/task/task456/")).toBe(true);
    expect(key.endsWith(".jpg")).toBe(true);
    expect(isSafeObjectKey(key)).toBe(true);
    expect(orgIdFromKey(key)).toBe("org123");
    const url = photoUrlForKey(key);
    expect(url).toBe(STORAGE_PHOTO_URL_PREFIX + key);
    expect(isStoragePhotoUrl(url)).toBe(true);
    expect(keyFromPhotoUrl(url)).toBe(key);
    // The stored photoUrl passes the EXISTING taskUpdateSchema shape (same-origin relative).
    expect(/^\/(?!\/)/.test(url)).toBe(true);
  });

  it("rejects traversal, escapes and malformed shapes (red-first)", () => {
    for (const bad of [
      "org/o1/task/t1/../secret.jpg", //          traversal
      "org/o1/task/t1/..", //                     traversal tail
      "../org/o1/task/t1/a.jpg", //               leading traversal
      "/org/o1/task/t1/a.jpg", //                 absolute
      "org//task/t1/a.jpg", //                    empty segment
      "org/o1/task/t1/a b.jpg", //                whitespace
      "org/o1/task/t1/a.jpg/extra", //            too deep
      "org/o1/task/t1", //                        too shallow
      "other/o1/task/t1/a.jpg", //                wrong prefix literal
      "org/o1/note/t1/a.jpg", //                  wrong second literal
      "org/o$1/task/t1/a.jpg", //                 org charset
      "org/o1/task/t1/.hidden.jpg", //            leading-dot filename
      "org/o1/task/t1/a\\b.jpg", //               backslash
      "org/o1/task/t1/" + "x".repeat(600), //     length cap
      "", //                                      empty
    ]) {
      expect(isSafeObjectKey(bad), bad).toBe(false);
      expect(orgIdFromKey(bad), bad).toBeNull();
    }
    // keyFromPhotoUrl validates too: a crafted photoUrl never yields an unsafe key.
    expect(keyFromPhotoUrl(STORAGE_PHOTO_URL_PREFIX + "org/o1/task/t1/../x.jpg")).toBeNull();
    expect(keyFromPhotoUrl("/uploads/legacy/a.jpg")).toBeNull(); // legacy path is NOT storage
    expect(() => buildTaskPhotoKey("bad$org", "t1", "jpg")).toThrow();
  });

  it("isAcceptablePhotoUrl: a STORAGE url must belong to the org; legacy paths pass; cross-org/malformed rejected", () => {
    const mine = STORAGE_PHOTO_URL_PREFIX + "org/orgA/task/t1/1-a.jpg";
    const foreign = STORAGE_PHOTO_URL_PREFIX + "org/orgB/task/t1/1-a.jpg"; // another tenant's key
    expect(isAcceptablePhotoUrl(mine, "orgA")).toBe(true);
    expect(isAcceptablePhotoUrl(foreign, "orgA")).toBe(false); // cross-tenant → rejected at write time
    expect(isAcceptablePhotoUrl(STORAGE_PHOTO_URL_PREFIX + "garbage", "orgA")).toBe(false); // malformed storage url
    expect(isAcceptablePhotoUrl(STORAGE_PHOTO_URL_PREFIX + "org/orgA/task/t1/../x.jpg", "orgA")).toBe(false); // traversal
    // Non-storage (legacy /uploads or a plain relative) is unaffected by this guard.
    expect(isAcceptablePhotoUrl("/uploads/orgA/1-a.jpg", "orgA")).toBe(true);
    expect(isAcceptablePhotoUrl("/uploads/whatever.png", "orgA")).toBe(true);
  });
});

describe("storage config — default OFF, fail-closed on any missing piece", () => {
  const FULL = {
    STORAGE_ENDPOINT: CONFIG.endpoint,
    STORAGE_BUCKET: CONFIG.bucket,
    STORAGE_ACCESS_KEY_ID: CONFIG.accessKeyId,
    STORAGE_SECRET_ACCESS_KEY: SECRET,
  } as Record<string, string | undefined>;

  it("no env at all → everything off", () => {
    expect(getStorageConfig({} as Record<string, string | undefined>)).toBeNull();
    expect(storageConfigured({} as Record<string, string | undefined>)).toBe(false);
    expect(storageUploadsEnabled({} as Record<string, string | undefined>)).toBe(false);
  });

  it("credentials WITHOUT the flag → configured (reads/drain work) but uploads stay OFF", () => {
    expect(storageConfigured(FULL)).toBe(true);
    expect(storageUploadsEnabled(FULL)).toBe(false); // DEFAULT OFF
  });

  it("flag ON but any credential missing → uploads still OFF (fail-closed)", () => {
    for (const missing of ["STORAGE_ENDPOINT", "STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY"]) {
      const env = { ...FULL, STORAGE_ENABLED: "1" } as Record<string, string | undefined>;
      delete env[missing as keyof typeof env];
      expect(storageUploadsEnabled(env), missing).toBe(false);
    }
    expect(storageUploadsEnabled({ ...FULL, STORAGE_ENABLED: "1" })).toBe(true);
  });

  it("plain-http endpoint is rejected (signed URLs must never travel plaintext)", () => {
    expect(getStorageConfig({ ...FULL, STORAGE_ENDPOINT: "http://insecure.example.com" })).toBeNull();
  });
});

describe("SigV4 presign — short-lived, deterministic, secret never leaves the HMAC", () => {
  const KEY = "org/o1/task/t1/123-abc.jpg";
  const NOW = new Date("2026-07-14T12:00:00.000Z");

  it("produces a bucket-scoped signed GET URL with a clamped expiry and NO secret material", () => {
    const url = presignGetUrl(CONFIG, KEY, { expiresSeconds: 300, now: NOW });
    const u = new URL(url);
    expect(u.origin).toBe(CONFIG.endpoint);
    expect(u.pathname).toBe(`/${CONFIG.bucket}/${KEY}`);
    expect(u.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(u.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(u.searchParams.get("X-Amz-Date")).toBe("20260714T120000Z");
    expect(u.searchParams.get("X-Amz-Credential")).toContain("20260714/auto/s3/aws4_request");
    expect(u.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    // THE assertion: the secret key appears NOWHERE in the URL.
    expect(url).not.toContain(SECRET);
    expect(url).not.toContain(encodeURIComponent(SECRET));
  });

  it("is deterministic for fixed (key, now) and the TTL is HARD-CAPPED at 15 minutes", () => {
    expect(presignGetUrl(CONFIG, KEY, { now: NOW })).toBe(presignGetUrl(CONFIG, KEY, { now: NOW }));
    const capped = new URL(presignGetUrl(CONFIG, KEY, { expiresSeconds: 86_400, now: NOW }));
    expect(capped.searchParams.get("X-Amz-Expires")).toBe(String(SIGNED_URL_MAX_TTL_S));
    const floor = new URL(presignGetUrl(CONFIG, KEY, { expiresSeconds: -5, now: NOW }));
    expect(floor.searchParams.get("X-Amz-Expires")).toBe("1");
    // Different key / different time ⇒ different signature (no reusable token).
    const sig = (k: string, d: Date) => new URL(presignGetUrl(CONFIG, k, { now: d })).searchParams.get("X-Amz-Signature");
    expect(sig(KEY, NOW)).not.toBe(sig("org/o1/task/t1/other.jpg", NOW));
    expect(sig(KEY, NOW)).not.toBe(sig(KEY, new Date("2026-07-14T13:00:00.000Z")));
  });

  it("header-signed PUT/DELETE requests carry the auth header, never the raw secret", () => {
    const put = signedRequest(CONFIG, "PUT", KEY, new Uint8Array([1, 2, 3]), NOW);
    const del = signedRequest(CONFIG, "DELETE", KEY, null, NOW);
    for (const r of [put, del]) {
      expect(r.url).toBe(`${CONFIG.endpoint}/${CONFIG.bucket}/${KEY}`);
      expect(r.headers.authorization).toContain("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/");
      expect(r.headers.authorization).toMatch(/Signature=[0-9a-f]{64}$/);
      expect(JSON.stringify(r)).not.toContain(SECRET);
    }
    expect(put.headers["x-amz-content-sha256"]).not.toBe(del.headers["x-amz-content-sha256"]); // payload-bound
  });
});

describe("env-check — storage vars REQUIRED only when STORAGE_ENABLED is on; never prints a value", () => {
  const BASE = {
    AUTH_SECRET: "a".repeat(40),
    ENCRYPTION_KEY: "b".repeat(40),
  };

  it("flag off → storage vars are NOT required", () => {
    const { errors } = checkProductionEnv({ ...BASE });
    expect(errors.filter((e: string) => e.includes("STORAGE"))).toEqual([]);
  });

  it("flag on + nothing set → one error per missing var, by NAME only", () => {
    const { errors } = checkProductionEnv({ ...BASE, STORAGE_ENABLED: "1" });
    for (const name of ["STORAGE_ENDPOINT", "STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY"]) {
      expect(errors.some((e: string) => e.includes(name))).toBe(true);
    }
  });

  it("flag on + everything set → no storage errors; http endpoint → error; secret value never echoed", () => {
    const full = {
      ...BASE,
      STORAGE_ENABLED: "true",
      STORAGE_ENDPOINT: "https://acc.r2.cloudflarestorage.com",
      STORAGE_BUCKET: "b",
      STORAGE_ACCESS_KEY_ID: "ak",
      STORAGE_SECRET_ACCESS_KEY: SECRET,
    };
    expect(checkProductionEnv(full).errors.filter((e: string) => e.includes("STORAGE"))).toEqual([]);
    const http = checkProductionEnv({ ...full, STORAGE_ENDPOINT: "http://x.example.com" });
    expect(http.errors.some((e: string) => e.includes("https"))).toBe(true);
    // No error string ever contains the secret VALUE.
    for (const e of [...http.errors, ...checkProductionEnv({ ...BASE, STORAGE_ENABLED: "1" }).errors]) {
      expect(e).not.toContain(SECRET);
    }
  });
});
