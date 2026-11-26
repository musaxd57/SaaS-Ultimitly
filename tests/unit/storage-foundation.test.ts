import { describe, it, expect } from "vitest";
import {
  buildTaskPhotoKey,
  isSafeObjectKey,
  orgIdFromKey,
  photoUrlForKey,
  keyFromPhotoUrl,
  isStoragePhotoUrl,
  isAcceptablePhotoUrl,
  isRenderablePhotoUrl,
  latestRenderablePhotoByTask,
  STORAGE_PHOTO_URL_PREFIX,
} from "@/lib/storage/keys";
import { getStorageConfig, storageConfigured, storageUploadsEnabled } from "@/lib/storage/config";
import { presignGetUrl, signedRequest, SIGNED_URL_MAX_TTL_S } from "@/lib/storage/s3";
import { checkProductionEnv } from "../../scripts/env-check.mjs";

const SECRET = "super-secret-provider-key-DO-NOT-LEAK";
/** Virtual-hosted — the default, and what the live provider requires. */
const CONFIG = {
  endpoint: "https://acc.r2.cloudflarestorage.com",
  bucket: "lixus-photos",
  region: "auto",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: SECRET,
  pathStyle: false,
};
/** Path-style — the legacy shape, kept for providers that still need it. */
const PATH_STYLE_CONFIG = { ...CONFIG, pathStyle: true };

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
    // Eski yerel yükleme: YALNIZ bu org'un dizini + görsel dosya adı.
    expect(isAcceptablePhotoUrl("/uploads/orgA/1-a.jpg", "orgA")).toBe(true);
    expect(isAcceptablePhotoUrl("/uploads/orgA/1726000000000-0a1b2c3d4e5f.webp", "orgA")).toBe(true);
    // 🚨 TERS ÇEVRİLDİ (09-23): eski pin "düz göreli yol da geçer" diyordu — kusurun kendisi.
    expect(isAcceptablePhotoUrl("/uploads/whatever.png", "orgA")).toBe(false); // org dizini yok
  });

  it("🚨 09-23: depolama-DIŞI keyfi aynı-kaynak yolu REDDEDİLİR (panoda <img src> = tıksız GET)", () => {
    for (const bad of [
      "/logout",
      "/api/account/export",
      "/api/auth/logout?next=/",
      "/uploads/orgB/1-a.jpg", // başka kiracının dizini
      "/uploads/orgA/../orgB/1-a.jpg", // dizin dışına çıkma
      "/uploads/orgA/sub/1-a.jpg", // alt dizin
      "/uploads/orgA/1-a.svg", // görsel olmayan / betik taşıyabilen biçim
      "/uploads/orgA/1-a.html",
      "/uploads/orgA/.hidden.png",
      "/uploads/orgA/", // dosya adı yok
    ]) {
      expect(isAcceptablePhotoUrl(bad, "orgA"), bad).toBe(false);
      expect(isRenderablePhotoUrl(bad, "orgA"), bad).toBe(false);
    }
    // Org kimliği `/api/upload` ile AYNI türetmeyle dizine iner (tire korunur, diğerleri düşer).
    expect(isAcceptablePhotoUrl("/uploads/org-A1/1-a.png", "org-A1")).toBe(true);
  });

  it("pano: görev başına EN YENİ çizilebilir foto; eski keyfi yol yuvayı KAPATMAZ (önceki gerçek foto gösterilir)", () => {
    const good = STORAGE_PHOTO_URL_PREFIX + "org/orgA/task/t1/1-a.jpg";
    const rows = [
      { taskId: "t1", photoUrl: "/logout" }, // en yeni satır — eski dönemden kalma, ÇİZİLMEZ
      { taskId: "t1", photoUrl: good }, // bir önceki gerçek foto
      { taskId: "t2", photoUrl: null },
      { taskId: "t3", photoUrl: STORAGE_PHOTO_URL_PREFIX + "org/orgB/task/t3/1-a.jpg" }, // başka kiracı
    ];
    const m = latestRenderablePhotoByTask(rows, "orgA");
    expect(m.get("t1")).toBe(good);
    expect(m.has("t2")).toBe(false);
    expect(m.has("t3")).toBe(false);
    // Sıra: yeniden eskiye gelen İLK çizilebilir satır kazanır.
    const newer = STORAGE_PHOTO_URL_PREFIX + "org/orgA/task/t1/2-b.jpg";
    expect(latestRenderablePhotoByTask([{ taskId: "t1", photoUrl: newer }, { taskId: "t1", photoUrl: good }], "orgA").get("t1")).toBe(newer);
  });

  it("çizim kapısı görev şartı OLMADAN yazma kapısının aynısıdır (eski satırlar da elenir)", () => {
    const other = STORAGE_PHOTO_URL_PREFIX + "org/orgA/task/t2/1-a.jpg";
    expect(isRenderablePhotoUrl(other, "orgA")).toBe(true); // aynı org, başka görev → çizilir
    expect(isRenderablePhotoUrl(STORAGE_PHOTO_URL_PREFIX + "org/orgB/task/t2/1-a.jpg", "orgA")).toBe(false);
  });

  it("isAcceptablePhotoUrl: taskId verilince key'in TASK segmenti de eşleşmeli (Codex — org-içi çapraz-görev)", () => {
    const taskA = STORAGE_PHOTO_URL_PREFIX + "org/orgA/task/t1/1-a.jpg";
    expect(isAcceptablePhotoUrl(taskA, "orgA", "t1")).toBe(true); // doğru görev
    expect(isAcceptablePhotoUrl(taskA, "orgA", "t2")).toBe(false); // t1'in foto'su t2'ye yazılamaz
    // taskId verilmezse (geriye uyumluluk) yalnız org kontrol edilir.
    expect(isAcceptablePhotoUrl(taskA, "orgA")).toBe(true);
    // Yanlış org, taskId doğru olsa bile reddedilir.
    expect(isAcceptablePhotoUrl(taskA, "orgB", "t1")).toBe(false);
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

  it("adresleme varsayılanı VIRTUAL-HOSTED; path-style açık tercihtir", () => {
    expect(getStorageConfig(FULL)?.pathStyle).toBe(false);
    expect(getStorageConfig({ ...FULL, STORAGE_PATH_STYLE: "1" })?.pathStyle).toBe(true);
    expect(getStorageConfig({ ...FULL, STORAGE_PATH_STYLE: "true" })?.pathStyle).toBe(true);
    // Tanınmayan değer = KAPALI (canlı sağlayıcının istediği yön güvenli yön).
    for (const v of ["", " ", "0", "false", "evet", "yes"]) {
      expect(getStorageConfig({ ...FULL, STORAGE_PATH_STYLE: v })?.pathStyle, v).toBe(false);
    }
  });

  it("NOKTALI bucket adı virtual-hosted'da REDDEDİLİR (joker sertifika eşleşmez)", () => {
    // "a.b" + ".t3.storageapi.dev" → iki seviyeli alt alan; *.t3.storageapi.dev
    // joker sertifikası bunu KAPSAMAZ, yani TLS el sıkışması çuvallar. Yükleme
    // anında anlaşılması güç bir sertifika hatası yerine burada fail-closed.
    const dotted = { ...FULL, STORAGE_BUCKET: "lixus.photos" };
    expect(getStorageConfig(dotted)).toBeNull();
    // Path-style'da nokta zararsız — bucket host'a değil yola giriyor.
    expect(getStorageConfig({ ...dotted, STORAGE_PATH_STYLE: "1" })?.bucket).toBe("lixus.photos");
  });
});

describe("SigV4 presign — short-lived, deterministic, secret never leaves the HMAC", () => {
  const KEY = "org/o1/task/t1/123-abc.jpg";
  const NOW = new Date("2026-07-14T12:00:00.000Z");

  // -------------------------------------------------------------------------
  // ADRESLEME BİÇİMİ. Bu imzalayıcı path-style yazılmıştı (/{bucket}/{key}).
  // Canlı sağlayıcı (Railway Buckets = Tigris) 19.02.2025 SONRASI oluşturulan
  // bucket'larda path-style'ı KALDIRDI — yani o yolla imza tutmaz. Varsayılan
  // artık virtual-hosted ({bucket}.{host}/{key}); path-style hâlâ mümkün ama
  // artık AÇIK bir tercih (STORAGE_PATH_STYLE).
  //
  // Bu ayrım imzanın İÇİNE girer: host ve canonical URI imzalanan metnin
  // parçasıdır, dolayısıyla yanlış biçim "AccessDenied/SignatureDoesNotMatch"
  // olarak döner — kimlik bilgisi hatası gibi görünen ama aslında adresleme
  // olan bir arıza. İki modun imzasının FARKLI olduğunu asserte ediyoruz;
  // aynı çıksaydı host'un imzaya girmediği anlamına gelirdi.
  // -------------------------------------------------------------------------
  it("VIRTUAL-HOSTED (varsayılan): bucket host'a taşınır, yol yalnız key'dir", () => {
    const u = new URL(presignGetUrl(CONFIG, KEY, { now: NOW }));
    expect(u.host).toBe(`${CONFIG.bucket}.acc.r2.cloudflarestorage.com`);
    expect(u.pathname).toBe(`/${KEY}`);
    expect(u.protocol).toBe("https:");
  });

  it("PATH-STYLE (opt-in): eski biçim BİREBİR korunur", () => {
    const u = new URL(presignGetUrl(PATH_STYLE_CONFIG, KEY, { now: NOW }));
    expect(u.origin).toBe(CONFIG.endpoint);
    expect(u.pathname).toBe(`/${CONFIG.bucket}/${KEY}`);
  });

  it("adresleme biçimi İMZAYA girer (host imzalanmamış olsaydı aynı çıkardı)", () => {
    const sig = (c: typeof CONFIG) =>
      new URL(presignGetUrl(c, KEY, { now: NOW })).searchParams.get("X-Amz-Signature");
    expect(sig(CONFIG)).not.toBe(sig(PATH_STYLE_CONFIG));
    expect(sig(CONFIG)).toMatch(/^[0-9a-f]{64}$/);
    // PUT/DELETE de aynı biçimi izler.
    const vh = signedRequest(CONFIG, "PUT", KEY, new Uint8Array([1]), NOW);
    const ps = signedRequest(PATH_STYLE_CONFIG, "PUT", KEY, new Uint8Array([1]), NOW);
    expect(vh.url).toBe(`https://${CONFIG.bucket}.acc.r2.cloudflarestorage.com/${KEY}`);
    expect(ps.url).toBe(`${CONFIG.endpoint}/${CONFIG.bucket}/${KEY}`);
    expect(vh.headers.authorization).not.toBe(ps.headers.authorization);
  });

  it("produces a bucket-scoped signed GET URL with a clamped expiry and NO secret material", () => {
    const url = presignGetUrl(PATH_STYLE_CONFIG, KEY, { expiresSeconds: 300, now: NOW });
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
    const put = signedRequest(PATH_STYLE_CONFIG, "PUT", KEY, new Uint8Array([1, 2, 3]), NOW);
    const del = signedRequest(PATH_STYLE_CONFIG, "DELETE", KEY, null, NOW);
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

  it("BOOT: geçersiz bucket adı SESSİZ no-op değil, HATA olmalı", () => {
    // Yaşanan tuzak: sağlayıcı panelinde "Lixus-uploads" yazıyor, insana normal
    // görünüyor, ama S3 adlandırması küçük harf istiyor → getStorageConfig null
    // döner ve bayrak AÇIKken depolama sessizce kapalı kalır. Boot'ta yakala.
    const errs = (b: string, extra: Record<string, string> = {}) =>
      checkProductionEnv({
        ...BASE,
        STORAGE_ENABLED: "1",
        STORAGE_ENDPOINT: "https://acc.r2.cloudflarestorage.com",
        STORAGE_ACCESS_KEY_ID: "ak",
        STORAGE_SECRET_ACCESS_KEY: SECRET,
        STORAGE_BUCKET: b,
        ...extra,
      }).errors.filter((e: string) => e.includes("STORAGE_BUCKET"));
    expect(errs("Lixus-uploads").length, "büyük harf").toBeGreaterThan(0);
    expect(errs("ab").length, "çok kısa").toBeGreaterThan(0);
    expect(errs("-leading").length, "harf/rakamla başlamıyor").toBeGreaterThan(0);
    expect(errs("lixus-uploads-ssokr6h6veq"), "sağlayıcının verdiği gerçek ad").toEqual([]);
    // Noktalı ad: virtual-hosted'da HATA, path-style'da serbest.
    expect(errs("lixus.photos").length).toBeGreaterThan(0);
    expect(errs("lixus.photos", { STORAGE_PATH_STYLE: "1" })).toEqual([]);
  });

  it("flag on + everything set → no storage errors; http endpoint → error; secret value never echoed", () => {
    const full = {
      ...BASE,
      STORAGE_ENABLED: "true",
      STORAGE_ENDPOINT: "https://acc.r2.cloudflarestorage.com",
      STORAGE_BUCKET: "lixus-photos", // must be a REAL S3-legal name now (was "b")
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
