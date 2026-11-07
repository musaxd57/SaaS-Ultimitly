import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { resumeConfirmText, signResumeToken, verifyResumeToken } from "@/lib/billing/resume";
import { signPlanChangeToken, verifyPlanChangeToken } from "@/lib/billing/plan-change";

// I4 C (10-17): devam ettirme onay belirteci — imzalı, süreli, tek kuruluş + fiyat + tutar bağlı; paket değiştirme belirteciyle ALAN AYRIMLI.

beforeEach(() => vi.stubEnv("AUTH_SECRET", "test-auth-secret-0123456789-abcdefghijkl"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("devam ettirme belirteci", () => {
  it("imzalı belirteç doğrulanır; alan bozulursa reddedilir", () => {
    const t = signResumeToken({ org: "o1", priceId: "pri_pro", amount: "₺899,00" });
    expect(verifyResumeToken(t)).toMatchObject({ org: "o1", priceId: "pri_pro", amount: "₺899,00" });
    const [body, mac] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, "base64url").toString()), amount: "₺1,00" })).toString("base64url");
    expect(verifyResumeToken(`${forged}.${mac}`)).toBeNull();
    expect(verifyResumeToken(null)).toBeNull();
  });

  it("🚨 ALAN AYRIMI: paket değiştirme belirteci devam ettirmede, devam belirteci paket değiştirmede GEÇMEZ", () => {
    const plan = signPlanChangeToken({ org: "o1", priceId: "pri_pro", mode: "upgrade", amount: "₺899,00" });
    expect(verifyResumeToken(plan)).toBeNull();
    const res = signResumeToken({ org: "o1", priceId: "pri_pro", amount: "₺899,00" });
    expect(verifyPlanChangeToken(res)).toBeNull();
  });

  it("10 dakika sonra süresi dolar; gizli anahtar yoksa hiçbir belirteç geçmez", () => {
    vi.useFakeTimers();
    const t = signResumeToken({ org: "o1", priceId: "pri_pro", amount: "₺899,00" });
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(verifyResumeToken(t)).toBeNull();
    vi.useRealTimers();
    const fresh = signResumeToken({ org: "o1", priceId: "pri_pro", amount: "₺899,00" });
    vi.stubEnv("AUTH_SECRET", "");
    expect(verifyResumeToken(fresh)).toBeNull();
  });

  it("kurucu C1 metni (büyük yazı + küçük tahsilat cümlesi) sabit", () => {
    expect(resumeConfirmText("Pro", "₺899,00")).toEqual({
      headline: "Pro planınız hemen açılır.",
      fine: "₺899,00 kayıtlı kartınızdan şimdi tahsil edilecek.",
    });
    // Opus 10-17 A3: yıllık abone yıllık devam eder — dönem söylenir.
    expect(resumeConfirmText("Pro", "₺8.990,00", true).fine).toBe("₺8.990,00 kayıtlı kartınızdan şimdi tahsil edilecek (yıllık ödeme).");
  });
});
