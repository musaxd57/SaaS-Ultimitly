import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Altyapı envanteri 10-21 (kurucu: 111 konu listesi) — müşteriye dokunmayan iç sertleştirmeler. Veritabanı modülü tümden taklit edilir:
// canlılık yoklamasının DB'ye HİÇ dokunmadığı, DB'li yollar çağrılırsa taklit fırlatacağı için ölçülür.
const dbCalls = { queryRaw: 0, findMany: 0 };
vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn(async () => {
      dbCalls.queryRaw++;
      throw new Error("db down (test)");
    }),
    messageOutbox: {
      findMany: vi.fn(async () => {
        dbCalls.findMany++;
        return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => ({ organizationId: `org${n}` }));
      }),
    },
  },
}));

let inFlight = 0;
let peak = 0;
vi.mock("@/lib/billing/subscription", () => ({
  billingEnforced: () => true,
  premiumAllowed: vi.fn(async (orgId: string) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return !["org3", "org11"].includes(orgId);
  }),
}));

beforeEach(() => {
  dbCalls.queryRaw = 0;
  dbCalls.findMany = 0;
  inFlight = 0;
  peak = 0;
});

describe("sağlık: canlılık yoklaması (madde 57)", () => {
  it("?live=1 veritabanına dokunmadan 200 döner (DB düşükken de)", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET(new NextRequest("http://localhost/api/health?live=1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, live: true });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(dbCalls.queryRaw).toBe(0);
  });

  it("kontrol: parametresiz yoklama aynı durumda DB'yi okur ve 503 döner (hazır olma sözleşmesi değişmedi)", async () => {
    const { GET } = await import("@/app/api/health/route");
    const { clearProbeCache } = await import("@/lib/health-probe");
    clearProbeCache();
    const res = await GET(new NextRequest("http://localhost/api/health"));
    expect(res.status).toBe(503);
    expect(dbCalls.queryRaw).toBeGreaterThan(0);
  });

  it("live başka değerde (live=true) canlılık kipine girmez", async () => {
    const { GET } = await import("@/app/api/health/route");
    const { clearProbeCache } = await import("@/lib/health-probe");
    clearProbeCache();
    const res = await GET(new NextRequest("http://localhost/api/health?live=true"));
    expect(res.status).toBe(503);
  });
});

describe("ödeme bekletmesi: sınırlı eşzamanlılık (madde 44)", () => {
  it("işletme okumaları en çok BILLING_READ_CONCURRENCY kadar paralel; sonuç aynı", async () => {
    const { billingBlockedOrgIds, BILLING_READ_CONCURRENCY } = await import("@/lib/outbox/billing-hold");
    const ids = await billingBlockedOrgIds();
    expect(ids).toEqual(["org3", "org11"]);
    expect(peak).toBeLessThanOrEqual(BILLING_READ_CONCURRENCY);
    expect(peak).toBeGreaterThan(1); // hâlâ paralel (seri döngüye düşmedi)
  });
});

describe("hata e-postası kısıtlama haritası: bellek tavanı (madde 41)", () => {
  it("binlerce farklı bağlam haritayı tavanın üstüne büyütmez", async () => {
    vi.resetModules();
    process.env.ERROR_ALERT_EMAIL = "ops@example.test";
    process.env.RESEND_API_KEY = "test-key";
    const sendReporting = vi.fn(async () => ({ ok: true }));
    vi.doMock("@/lib/email-core", () => ({ emailService: { sendReporting } }));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const core = await import("@/lib/report-error-core");
    core.__resetReportThrottle();
    const n = core.EMAIL_THROTTLE_MAX_KEYS + 500;
    for (let i = 0; i < n; i++) await core.reportError(`ctx org=${i}`, new Error("boom"));
    expect(sendReporting).toHaveBeenCalledTimes(n); // her farklı bağlam yine kendi e-postasını alır
    expect(core.__emailThrottleSizeForTest()).toBeLessThanOrEqual(core.EMAIL_THROTTLE_MAX_KEYS);
    // Kısıtlama hâlâ çalışır: son bağlam pencere içinde ikinci kez e-posta üretmez.
    const again = await core.reportError(`ctx org=${n - 1}`, new Error("boom"));
    expect(again.throttled).toBe(true);
    expect(sendReporting).toHaveBeenCalledTimes(n);
    quiet.mockRestore();
    vi.doUnmock("@/lib/email-core");
    delete process.env.ERROR_ALERT_EMAIL;
    delete process.env.RESEND_API_KEY;
  });
});

describe("hata e-postası kısıtlama haritası: tavanda en eski DAMGA gider (Haiku 10-21)", () => {
  it("penceresi dolup yeniden damgalanan bağlam, tavan aşılınca taze olduğu için silinmez (yerinde set sırayı korusaydı silinirdi)", async () => {
    vi.resetModules();
    process.env.ERROR_ALERT_EMAIL = "ops@example.test";
    process.env.RESEND_API_KEY = "test-key";
    const sendReporting = vi.fn(async () => ({ ok: true }));
    vi.doMock("@/lib/email-core", () => ({ emailService: { sendReporting } }));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const core = await import("@/lib/report-error-core");
      core.__resetReportThrottle();
      const t0 = new Date("2026-10-21T10:00:00Z").getTime();
      vi.setSystemTime(t0);
      await core.reportError("ctx X", new Error("x"));
      vi.setSystemTime(t0 + 60_000);
      for (let i = 0; i < core.EMAIL_THROTTLE_MAX_KEYS - 2; i++) await core.reportError(`ctx Y${i}`, new Error("y"));
      vi.setSystemTime(t0 + 10 * 60_000 + 30_000); // X'in penceresi doldu, Y'lerinki dolmadı
      expect((await core.reportError("ctx X", new Error("x"))).throttled).toBe(false); // X yeniden damgalandı (en taze)
      await core.reportError("ctx Y-last", new Error("y")); // harita tavana ulaştı
      await core.reportError("ctx Z", new Error("z")); // tavan aşıldı → en eski DAMGA gider
      expect(core.__emailThrottleSizeForTest()).toBeLessThanOrEqual(core.EMAIL_THROTTLE_MAX_KEYS);
      expect((await core.reportError("ctx X", new Error("x"))).throttled).toBe(true);
      expect((await core.reportError("ctx Y0", new Error("y"))).throttled).toBe(false); // en eski damga buydu, silindi
    } finally {
      vi.useRealTimers();
      quiet.mockRestore();
      vi.doUnmock("@/lib/email-core");
      delete process.env.ERROR_ALERT_EMAIL;
      delete process.env.RESEND_API_KEY;
    }
  });
});

describe("yavaş sorgu satırı (madde 26)", () => {
  it("eşiği aşan sorgu tek satır; parametre değerleri satıra girmez; uzun SQL kırpılır", async () => {
    const { slowQueryLine } = await import("@/lib/db-slow-query");
    const line = slowQueryLine({ query: 'SELECT "id"\n  FROM "Message" WHERE "body" = $1', duration: 1500, params: '["misafir@ornek.test"]' } as never, 1000);
    expect(line).toBe('[db] yavaş sorgu 1500 ms: SELECT "id" FROM "Message" WHERE "body" = $1');
    expect(line).not.toContain("misafir@ornek.test");
    const long = slowQueryLine({ query: `SELECT ${"x".repeat(500)}`, duration: 2000 }, 1000)!;
    expect(long.length).toBeLessThan(260);
    expect(long.endsWith("…")).toBe(true);
  });

  it("eşik altı, eşik 0 (kapalı) ve bozuk süre → satır yok", async () => {
    const { slowQueryLine } = await import("@/lib/db-slow-query");
    expect(slowQueryLine({ query: "SELECT 1", duration: 999 }, 1000)).toBeNull();
    expect(slowQueryLine({ query: "SELECT 1", duration: 5000 }, 0)).toBeNull();
    expect(slowQueryLine({ query: "SELECT 1", duration: "abc" }, 1000)).toBeNull();
    expect(slowQueryLine({ query: "SELECT 1", duration: 1000 }, 1000)).not.toBeNull(); // sınır dahil
  });

  it("eşik ortamdan okunur: boş → 1000, '0' → kapalı, bozuk → 1000", async () => {
    const { slowQueryThresholdMs } = await import("@/lib/db-slow-query");
    expect(slowQueryThresholdMs({})).toBe(1000);
    expect(slowQueryThresholdMs({ DB_SLOW_QUERY_MS: "0" })).toBe(0);
    expect(slowQueryThresholdMs({ DB_SLOW_QUERY_MS: "250" })).toBe(250);
    expect(slowQueryThresholdMs({ DB_SLOW_QUERY_MS: "-5" })).toBe(1000);
    expect(slowQueryThresholdMs({ DB_SLOW_QUERY_MS: "yavaş" })).toBe(1000);
  });
});

describe("açılış uyarıları: Sentry + bağlantı havuzu (madde 58 / 28)", () => {
  const base = {
    NODE_ENV: "production",
    AUTH_SECRET: "a".repeat(40),
    ENCRYPTION_KEY: "b".repeat(40),
    APP_URL: "https://www.lixusai.com",
  } as Record<string, string>;

  it("SENTRY_DSN yoksa uyarı var; varsa yok", async () => {
    const { checkProductionEnv } = await import("../../scripts/env-check.mjs");
    expect(checkProductionEnv(base).warnings.some((w: string) => w.startsWith("SENTRY_DSN is not set"))).toBe(true);
    const withDsn = checkProductionEnv({ ...base, SENTRY_DSN: "https://abc@o1.ingest.sentry.io/123" });
    expect(withDsn.warnings.some((w: string) => w.startsWith("SENTRY_DSN is not set"))).toBe(false);
  });

  it("DATABASE_URL connection_limit taşımıyorsa uyarı; taşıyorsa yok; adresin kendisi (parola) basılmaz", async () => {
    const { checkProductionEnv } = await import("../../scripts/env-check.mjs");
    const url = "postgresql://u:gizliParola@db.internal:5432/app";
    const r = checkProductionEnv({ ...base, DATABASE_URL: url });
    const w = r.warnings.find((x: string) => x.startsWith("DATABASE_URL has no connection_limit"));
    expect(w).toBeTruthy();
    expect(r.warnings.join("\n")).not.toContain("gizliParola");
    expect(r.errors.join("\n")).not.toContain("gizliParola");
    const ok = checkProductionEnv({ ...base, DATABASE_URL: `${url}?sslmode=disable&connection_limit=10` });
    expect(ok.warnings.some((x: string) => x.startsWith("DATABASE_URL has no connection_limit"))).toBe(false);
    // Uyarıdır, açılışı durdurmaz.
    expect(r.errors.some((x: string) => x.includes("connection_limit"))).toBe(false);
  });
});
