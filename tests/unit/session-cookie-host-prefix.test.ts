import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT, decodeJwt } from "jose";

// ---------------------------------------------------------------------------
// ① OTURUM ÇEREZİNE `__Host-` ÖNEKİ (kurucu onayı 09-23).
//
// `__Host-` adlı çerezi tarayıcı yalnız Secure + Path=/ + Domain'siz kabul eder: bir alt alan
// adı (ya da http üzerinden araya giren biri) bu adla çerez YAZAMAZ. Öneksiz ad buna açıktı →
// ele geçirilmiş/sarkan bir alt alan adı kurbanın tarayıcısına SALDIRGANIN oturumunu
// "fırlatıp" onu saldırganın hesabında çalıştırabilirdi (giriş-CSRF sınıfı).
// GEÇİŞ KİMSEYİ ÇIKIŞA ZORLAMAZ: okuma önce yeni adı, yoksa eski adı dener; middleware her
// sayfa görüntülemesinde yeni adla yazar ve eski çerezi siler. Eski ad yalnız bir geçiş
// süresi boyunca okunur (aktif oturumlar 14 günde bir zaten yenilenir), sonra koruma tamdır.
// Geliştirmede (http://localhost, Secure yok) tarayıcı `__Host-`i reddeder → orada eski ad.
// ---------------------------------------------------------------------------

type SetCall = { name: string; value: string; opts: Record<string, unknown> };
const calls: SetCall[] = [];
let jar: Record<string, string> = {};

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string, opts: Record<string, unknown>) => {
      calls.push({ name, value, opts });
    },
    get: (name: string) => (name in jar ? { name, value: jar[name] } : undefined),
  }),
}));

import {
  SESSION_COOKIE,
  SESSION_COOKIE_HOST,
  LEGACY_SESSION_COOKIE_READ_UNTIL,
  sessionCookieName,
  readSessionCookie,
  signSession,
  verifySession,
  type SessionPayload,
} from "@/lib/auth/session";
import { setSessionCookie, clearSessionCookie, getSession } from "@/lib/auth";
import { middleware } from "@/middleware";

const payload = (userId: string): SessionPayload => ({
  userId,
  organizationId: "o1",
  role: "owner",
  email: `${userId}@example.com`,
  name: "U",
  sessionEpoch: 0,
});

/** Yayından ÖNCEKİ kodun imzaladığı oturum: `hv` iddiası YOK (eski ad yalnız bunu taşıyabilir). */
async function signLegacySession(p: SessionPayload): Promise<string> {
  return new SignJWT({ ...p })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("14d")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
}

const BEFORE_CUTOFF = LEGACY_SESSION_COOKIE_READ_UNTIL - 24 * 60 * 60 * 1000;
const AFTER_CUTOFF = LEGACY_SESSION_COOKIE_READ_UNTIL + 24 * 60 * 60 * 1000;

beforeEach(() => {
  calls.length = 0;
  jar = {};
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("ad seçimi ve okuma sırası (saf)", () => {
  it("üretimde yazılan ad `__Host-`; geliştirme/testte eski ad", () => {
    expect(SESSION_COOKIE_HOST).toBe(`__Host-${SESSION_COOKIE}`);
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookieName()).toBe(SESSION_COOKIE_HOST);
    vi.stubEnv("NODE_ENV", "development");
    expect(sessionCookieName()).toBe(SESSION_COOKIE);
  });

  it("okuma: yeni ad ÖNCE; yoksa geçiş süresince eski ad (eski kodun imzaladığı)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const old = await signLegacySession(payload("u1"));
    const both = { [SESSION_COOKIE_HOST]: "yeni", [SESSION_COOKIE]: old } as Record<string, string>;
    expect(readSessionCookie((n) => both[n], BEFORE_CUTOFF)).toBe("yeni");
    const legacyOnly = { [SESSION_COOKIE]: old } as Record<string, string>;
    expect(readSessionCookie((n) => legacyOnly[n], BEFORE_CUTOFF)).toBe(old);
  });

  it("geçiş süresi BİTİNCE eski ad okunmaz (koruma tam: fırlatılan eski-adlı çerez işe yaramaz)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const legacyOnly = { [SESSION_COOKIE]: await signLegacySession(payload("u1")) } as Record<string, string>;
    expect(readSessionCookie((n) => legacyOnly[n], AFTER_CUTOFF)).toBeUndefined();
    const hostOnly = { [SESSION_COOKIE_HOST]: "yeni" } as Record<string, string>;
    expect(readSessionCookie((n) => hostOnly[n], AFTER_CUTOFF)).toBe("yeni");
  });

  it("🚨 geçişte de FIRLATMA yok: bu sürümün imzaladığı (hv) oturum eski adla gelirse okunmaz", async () => {
    // Saldırgan kendi (yeni) oturumunu eski ada çevirip kurbanın tarayıcısına fırlatır; eskiden
    // middleware onu `__Host-` adıyla yeniden imzalayıp KALICILAŞTIRIRDI.
    vi.stubEnv("NODE_ENV", "production");
    const planted = { [SESSION_COOKIE]: await signSession(payload("saldirgan")) } as Record<string, string>;
    expect(readSessionCookie((n) => planted[n], BEFORE_CUTOFF)).toBeUndefined();
    const garbage = { [SESSION_COOKIE]: "cozulemeyen-token" } as Record<string, string>;
    expect(readSessionCookie((n) => garbage[n], BEFORE_CUTOFF)).toBeUndefined();
  });

  it("signSession `hv` iddiasını yazar; doğrulanmış oturuma SIZMAZ (beyaz liste)", async () => {
    const token = await signSession(payload("u1"));
    expect(decodeJwt(token).hv).toBe(1);
    const back = await verifySession(token);
    expect(back).not.toHaveProperty("hv");
    expect(back?.userId).toBe("u1");
  });

  it("KONTROL: geliştirmede eski ad CANLI addır — tarih ne olursa olsun okunur", () => {
    vi.stubEnv("NODE_ENV", "development");
    const legacyOnly = { [SESSION_COOKIE]: "dev" } as Record<string, string>;
    expect(readSessionCookie((n) => legacyOnly[n], AFTER_CUTOFF)).toBe("dev");
  });

  it("geliştirmede `__Host-` OKUNMAZ (yerel `next start` kalıntısı geliştirme girişini ezmez)", () => {
    vi.stubEnv("NODE_ENV", "development");
    const both = { [SESSION_COOKIE_HOST]: "kalinti", [SESSION_COOKIE]: "dev" } as Record<string, string>;
    expect(readSessionCookie((n) => both[n], BEFORE_CUTOFF)).toBe("dev");
    const hostOnly = { [SESSION_COOKIE_HOST]: "kalinti" } as Record<string, string>;
    expect(readSessionCookie((n) => hostOnly[n], BEFORE_CUTOFF)).toBeUndefined();
  });
});

describe("middleware — üretimde geçiş", () => {
  beforeEach(() => vi.stubEnv("NODE_ENV", "production"));

  it("eski adlı çerezle gelen kullanıcı ÇIKIŞA DÜŞMEZ: yeni adla yazılır, eski silinir", async () => {
    // Saat geçiş süresinin İÇİNE sabitlenir (yoksa bu test kesim tarihinden sonra kendiliğinden
    // kırmızıya dönerdi — 09-15 saat-bombası dersi).
    vi.useFakeTimers({ now: BEFORE_CUTOFF, toFake: ["Date"] });
    const req = new NextRequest("https://www.lixusai.com/dashboard");
    req.cookies.set(SESSION_COOKIE, await signLegacySession(payload("u1")));
    const res = await middleware(req);
    expect(res.headers.get("location")).toBeNull(); // girişe yönlendirilmedi
    const fresh = res.cookies.get(SESSION_COOKIE_HOST);
    expect(fresh?.value).toBeTruthy();
    expect((await verifySession(fresh!.value))?.userId).toBe("u1");
    // Tarayıcının `__Host-`i kabul etmesinin üç şartı: Secure + Path=/ + Domain YOK.
    const hostLine = res.headers.getSetCookie().find((l) => l.startsWith(`${SESSION_COOKIE_HOST}=`)) ?? "";
    expect(hostLine).toMatch(/;\s*Secure/i);
    expect(hostLine).toMatch(/;\s*Path=\/(;|$)/i);
    expect(hostLine).not.toMatch(/Domain=/i);
    // Eski ad temizlendi (bir sonraki istekte yalnız yeni ad gelir).
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBe("");
  });

  it("ikisi birden varsa YENİ adlı oturum geçerlidir (fırlatılan eski-adlı çerez ezemez)", async () => {
    const req = new NextRequest("https://www.lixusai.com/dashboard");
    req.cookies.set(SESSION_COOKIE_HOST, await signSession(payload("kurban")));
    req.cookies.set(SESSION_COOKIE, await signSession(payload("saldirgan")));
    const res = await middleware(req);
    const fresh = res.cookies.get(SESSION_COOKIE_HOST);
    expect((await verifySession(fresh!.value))?.userId).toBe("kurban");
  });

  it("geçiş bittikten sonra yalnız eski adlı çerez = oturum YOK (girişe yönlendirilir)", async () => {
    vi.useFakeTimers({ now: AFTER_CUTOFF, toFake: ["Date"] });
    const req = new NextRequest("https://www.lixusai.com/dashboard");
    req.cookies.set(SESSION_COOKIE, await signLegacySession(payload("u1")));
    const res = await middleware(req);
    expect(res.headers.get("location")).toMatch(/\/login/);
  });

  it("🚨 fırlatılan (hv'li) eski-adlı çerez geçişte bile `__Host-`e YÜKSELTİLMEZ", async () => {
    vi.useFakeTimers({ now: BEFORE_CUTOFF, toFake: ["Date"] });
    const req = new NextRequest("https://www.lixusai.com/dashboard");
    req.cookies.set(SESSION_COOKIE, await signSession(payload("saldirgan")));
    const res = await middleware(req);
    expect(res.headers.get("location")).toMatch(/\/login/);
    expect(res.cookies.get(SESSION_COOKIE_HOST)).toBeUndefined();
  });

  it("KONTROL: geliştirmede davranış birebir eski (eski adla yazılır, önek yok)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const req = new NextRequest("http://localhost:3000/dashboard");
    req.cookies.set(SESSION_COOKIE, await signSession(payload("u1")));
    const res = await middleware(req);
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBeTruthy();
    expect(res.cookies.get(SESSION_COOKIE_HOST)).toBeUndefined();
  });
});

describe("sunucu tarafı çerez yazma/okuma — üretimde", () => {
  beforeEach(() => vi.stubEnv("NODE_ENV", "production"));

  it("setSessionCookie yeni adla Secure + Path=/ yazar ve eski adı siler", async () => {
    await setSessionCookie(payload("u1"));
    const fresh = calls.find((c) => c.name === SESSION_COOKIE_HOST);
    expect(fresh).toBeDefined();
    expect(fresh!.opts.secure).toBe(true);
    expect(fresh!.opts.path).toBe("/");
    expect(fresh!.opts.domain).toBeUndefined();
    const legacy = calls.find((c) => c.name === SESSION_COOKIE);
    expect(legacy?.value).toBe("");
    expect(legacy?.opts.maxAge).toBe(0);
  });

  it("clearSessionCookie İKİ adı da temizler (çıkış gerçekten çıkış)", async () => {
    await clearSessionCookie();
    for (const name of [SESSION_COOKIE_HOST, SESSION_COOKIE]) {
      const c = calls.find((x) => x.name === name);
      expect(c, name).toBeDefined();
      expect(c!.value).toBe("");
      expect(c!.opts.maxAge).toBe(0);
    }
  });

  it("getSession yeni adı tercih eder, geçişte eski adı da okur", async () => {
    jar = { [SESSION_COOKIE_HOST]: await signSession(payload("kurban")), [SESSION_COOKIE]: await signSession(payload("x")) };
    expect((await getSession())?.userId).toBe("kurban");
    vi.useFakeTimers({ now: BEFORE_CUTOFF, toFake: ["Date"] });
    jar = { [SESSION_COOKIE]: await signLegacySession(payload("eski-kullanici")) };
    expect((await getSession())?.userId).toBe("eski-kullanici");
  });
});
