import { describe, it, expect, afterEach, vi } from "vitest";

import {
  DEFAULT_APP_ORIGIN,
  DEPLOYABLE_ORIGINS,
  appCanonicalOrigin,
} from "@/lib/app-config";
import { appBaseUrl, isTrustedAppUrl, verifyUrl, baseUrlFromHost } from "@/lib/auth/email-verify";
import { canonicalOAuthRedirectUri, isTrustedRedirectUri } from "@/lib/hospitable-oauth";
import { checkProductionEnv } from "../../scripts/env-check.mjs";

// ---------------------------------------------------------------------------
// DEPLOYMENT KİMLİĞİ TEK KAYNAK.
//
// Alan adı KODUN 9 YERİNDE 4 FARKLI mekanizmayla sabitlenmişti: kaynak sabiti
// (`CANONICAL_BASE`, OAuth callback, metadataBase, robots, sitemap, structured
// data), AYRI bir env (`APP_BASE_URL`, yalnız deneme e-postası), env-override'lı
// ama domain-kilitli OAuth redirect'i, ve düz UI metni.
//
// Sonuç: ".eu yalnız env ile açılır" vaadi YANLIŞTI. `APP_URL=…eu` verilince
// boot kapısı reddediyordu; kapı atlansa doğrulama linki `.com`'a gidiyordu —
// yani müşteri kendi hesabının OLMADIĞI deployment'a yönlendirilirdi.
//
// Artık deployment kimliği TEK girdi: `appCanonicalOrigin()`. Liste KAPALI
// (SUPPORTED_BILLING_CURRENCIES emsali) — token taşıyan link tabanı asla
// "herhangi bir https" olamaz, yeni bir origin eklemek KOD değişikliğidir.
// ---------------------------------------------------------------------------

const COM = "https://www.lixusai.com";
const EU = "https://www.lixusai.eu";

afterEach(() => vi.unstubAllEnvs());

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe("appCanonicalOrigin — kapalı liste, fail-closed", () => {
  it("env yoksa gönderilen .com origin'i", () => {
    expect(appCanonicalOrigin(env({}))).toBe(COM);
    expect(DEFAULT_APP_ORIGIN).toBe(COM);
    expect([...DEPLOYABLE_ORIGINS]).toEqual([COM, EU]);
  });

  it(".com ve .eu kabul edilir; yol/eğik çizgi origin'e indirgenir", () => {
    expect(appCanonicalOrigin(env({ APP_URL: COM }))).toBe(COM);
    expect(appCanonicalOrigin(env({ APP_URL: `${COM}/` }))).toBe(COM);
    expect(appCanonicalOrigin(env({ APP_URL: `${EU}/herhangi/yol` }))).toBe(EU);
    expect(appCanonicalOrigin(env({ APP_URL: "HTTPS://WWW.LIXUSAI.EU" }))).toBe(EU);
  });

  it("liste dışı her şey gönderilen origin'e DÜŞER (token yabancı alana gitmez)", () => {
    for (const bad of [
      "https://app.example.com",
      "http://www.lixusai.com", // http'li canonical bile RED
      "https://lixusai.com.evil.com", // sonek hilesi
      "https://www.lixusai.com.tr",
      "not-a-url",
      "javascript:alert(1)",
      "",
    ]) {
      expect(appCanonicalOrigin(env({ APP_URL: bad })), `${bad} kabul edilmemeli`).toBe(COM);
    }
  });
});

describe(".com REGRESYONU — env yokken çıktı BİREBİR bugünkü", () => {
  it("appBaseUrl / verifyUrl / OAuth callback hepsi .com", () => {
    expect(appBaseUrl()).toBe(COM);
    expect(verifyUrl("tok123")).toBe(`${COM}/api/auth/verify-email?token=tok123`);
    expect(canonicalOAuthRedirectUri()).toBe(`${COM}/api/hospitable/oauth/callback`);
  });

  it("güven kuralları değişmedi: canonical geçer, yabancı https GEÇMEZ", () => {
    expect(isTrustedAppUrl(COM)).toBe(true);
    expect(isTrustedAppUrl(`${COM}/`)).toBe(true);
    expect(isTrustedAppUrl("https://app.example.com")).toBe(false);
    expect(isTrustedRedirectUri(`${COM}/api/hospitable/oauth/callback`)).toBe(true);
    expect(isTrustedRedirectUri("https://evil.example/callback")).toBe(false);
  });

  it("apex host in-browser redirect'te hâlâ kabul (lixusai.com)", () => {
    expect(baseUrlFromHost("lixusai.com")).toBe("https://lixusai.com");
    expect(baseUrlFromHost("www.lixusai.com")).toBe(COM);
    expect(baseUrlFromHost("evil.example")).toBe(COM); // sahte Host → sabit tabana düşer
  });

  it("dev/test'te localhost ailesi hâlâ çalışıyor", () => {
    expect(isTrustedAppUrl("http://localhost:3000")).toBe(true);
    expect(baseUrlFromHost("localhost:3000")).toBe("http://localhost:3000");
  });
});

describe("HEPSİ BİRLİKTE — .eu'da tek bir yüzey .com'a KAÇMAZ", () => {
  it("APP_URL=.eu verilince link/OAuth tabanlarının TAMAMI .eu olur", () => {
    vi.stubEnv("APP_URL", EU);
    // Bu testin bütün mesele buydu: eskiden doğrulama linki .com'a gidiyordu.
    expect(appBaseUrl()).toBe(EU);
    expect(verifyUrl("tok123")).toBe(`${EU}/api/auth/verify-email?token=tok123`);
    expect(canonicalOAuthRedirectUri()).toBe(`${EU}/api/hospitable/oauth/callback`);
    expect(isTrustedAppUrl(EU)).toBe(true);
    expect(isTrustedRedirectUri(`${EU}/api/hospitable/oauth/callback`)).toBe(true);
    // .eu deployment'ında .com ARTIK güvenilir taban DEĞİL (ters kaçış da kapalı).
    expect(isTrustedAppUrl(COM)).toBe(false);
    expect(isTrustedRedirectUri(`${COM}/api/hospitable/oauth/callback`)).toBe(false);
  });

  it(".eu'da apex host'u da .eu ailesinden sayılır", () => {
    vi.stubEnv("APP_URL", EU);
    expect(baseUrlFromHost("lixusai.eu")).toBe("https://lixusai.eu");
    expect(baseUrlFromHost("www.lixusai.com")).toBe(EU); // .com artık yabancı → sabit tabana
  });
});

describe("TEK KAYNAK PİNİ — origin başka hiçbir yerde sabitlenmez", () => {
  it("kaynak kodda `https://www.lixusai.com` YALNIZ app-config'in allowlist'inde geçer", async () => {
    // Bulgunun kökü buydu: origin 9 ayrı yerde sabitti, biri düzeltilince
    // diğerleri sessizce .com'da kalıyordu. Bu pin, gelecekte yeni bir yere
    // origin yazılmasını derhal kırmızıya çevirir — arama yapmaya gerek kalmaz.
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name)) {
          // Yalnız ORIGIN literal'i aranır; kullanıcıya gösterilen düz metin
          // ("lixusai.com/login") ve e-posta alan adı bu desene UYMAZ.
          if (readFileSync(p, "utf8").includes('"https://www.lixusai.com"')) {
            hits.push(p.replace(/\\/g, "/").replace(/^.*?src\//, "src/"));
          }
        }
      }
    };
    walk("src");
    expect(hits.sort()).toEqual(["src/lib/app-config.ts"]);
  });
});

describe("boot kapısı — canonical origin", () => {
  const base = {
    NODE_ENV: "production",
    AUTH_SECRET: "a-real-production-secret-value-32ch",
    ENCRYPTION_KEY: "a-different-real-production-key-32c",
    DATABASE_URL: "postgresql://u@h:5432/d",
    RESEND_API_KEY: "re_x",
    CRON_SECRET: "x",
  } as unknown as Record<string, string | undefined>;
  const errs = (e: Record<string, string | undefined>, re: RegExp) =>
    checkProductionEnv(e).errors.filter((x: string) => re.test(x));

  it("APP_URL verilmezse hata YOK (.com bugünkü hâli)", () => {
    expect(errs({ ...base }, /APP_URL|APP_BASE_URL|OAUTH_REDIRECT/)).toEqual([]);
  });

  it(".eu ARTIK kabul ediliyor (eskiden boot'u durduruyordu)", () => {
    expect(
      errs(
        {
          ...base,
          APP_URL: EU,
          HOSPITABLE_OAUTH_REDIRECT_URI: `${EU}/api/hospitable/oauth/callback`,
        },
        /APP_URL|OAUTH_REDIRECT/,
      ),
    ).toEqual([]);
  });

  it("liste dışı APP_URL → HATA", () => {
    expect(errs({ ...base, APP_URL: "https://app.example.com" }, /APP_URL/).length).toBeGreaterThan(0);
    expect(errs({ ...base, APP_URL: "http://www.lixusai.com" }, /APP_URL/).length).toBeGreaterThan(0);
  });

  it("OAuth redirect'i canonical origin'le AYNI olmalı — çapraz alan RED", () => {
    // .eu deployment'ına .com callback'i verilmesi tam olarak yakalanmak istenen hata.
    expect(
      errs({ ...base, APP_URL: EU, HOSPITABLE_OAUTH_REDIRECT_URI: `${COM}/api/hospitable/oauth/callback` }, /OAUTH_REDIRECT/)
        .length,
    ).toBeGreaterThan(0);
  });

  it("APP_BASE_URL canonical'dan SAPARSA boot durur (sessiz ikinci kaynak yok)", () => {
    expect(errs({ ...base, APP_BASE_URL: "https://panel.example.com" }, /APP_BASE_URL/).length).toBeGreaterThan(0);
    // Canonical'la aynıysa sorun yok (bugünkü prod değeri bu olabilir).
    expect(errs({ ...base, APP_BASE_URL: COM }, /APP_BASE_URL/)).toEqual([]);
    expect(errs({ ...base, APP_URL: EU, APP_BASE_URL: EU }, /APP_BASE_URL/)).toEqual([]);
  });
});
