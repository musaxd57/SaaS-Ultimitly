import { describe, it, expect, vi, afterEach } from "vitest";
import { turnstileSiteKey, verifyTurnstileToken, TURNSTILE_VERIFY_URL } from "@/lib/auth/turnstile";

// ---------------------------------------------------------------------------
// U15 (kurucu 10-22): kayıt formunda Cloudflare Turnstile — anahtar KAPALI. Karar kuralları `lib/auth/turnstile.ts` başlığında:
// kapalı / anahtar eksik → doğrulama yok; Cloudflare "geçmedi" → red; Cloudflare'e ulaşılamıyor → kayıt geçer (kesinti kayıtları durdurmaz).
// ---------------------------------------------------------------------------

function on() {
  vi.stubEnv("SIGNUP_TURNSTILE_ENABLED", "1");
  vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "secret-key");
}
const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllEnvs());

describe("turnstile — anahtar ve yapılandırma", () => {
  it("anahtar kapalı → site anahtarı yok, doğrulama 'disabled' (ağa çıkmaz)", async () => {
    vi.stubEnv("SIGNUP_TURNSTILE_ENABLED", "");
    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret-key");
    const f = reply({ success: true });
    expect(turnstileSiteKey()).toBeNull();
    expect(await verifyTurnstileToken("t", null, { fetch: f })).toBe("disabled");
    expect(f).not.toHaveBeenCalled();
  });

  it("anahtar açık ama gizli anahtar eksik → 'disabled' (yanlış yapılandırma kayıtları kilitlemez)", async () => {
    vi.stubEnv("SIGNUP_TURNSTILE_ENABLED", "1");
    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(turnstileSiteKey()).toBeNull();
    expect(await verifyTurnstileToken("t", null, { fetch: reply({ success: true }) })).toBe("disabled");
  });

  it("'true' yazımı açmaz (yalnız \"1\")", () => {
    vi.stubEnv("SIGNUP_TURNSTILE_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret-key");
    expect(turnstileSiteKey()).toBeNull();
  });

  it("açık + iki anahtar → site anahtarı forma verilir", () => {
    on();
    expect(turnstileSiteKey()).toBe("site-key");
  });
});

describe("turnstile — sunucu doğrulaması", () => {
  it("success:true → ok; istek gizli anahtar + belirteç + IP ile Cloudflare'e gider", async () => {
    on();
    const f = reply({ success: true, action: "register" });
    expect(await verifyTurnstileToken("tok-1", "1.2.3.4", { fetch: f })).toBe("ok");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TURNSTILE_VERIFY_URL);
    const body = new URLSearchParams(String(init.body));
    expect(body.get("secret")).toBe("secret-key");
    expect(body.get("response")).toBe("tok-1");
    expect(body.get("remoteip")).toBe("1.2.3.4");
  });

  it("success:false → rejected", async () => {
    on();
    expect(await verifyTurnstileToken("tok", null, { fetch: reply({ success: false, "error-codes": ["timeout-or-duplicate"] }) })).toBe(
      "rejected",
    );
  });

  it("başka formun eylem adı → rejected", async () => {
    on();
    expect(await verifyTurnstileToken("tok", null, { fetch: reply({ success: true, action: "login" }) })).toBe("rejected");
  });

  it("belirteç yok / boş / tip yanlış / aşırı uzun → rejected, ağa çıkmaz", async () => {
    on();
    const f = reply({ success: true });
    for (const t of [undefined, "", 42, "x".repeat(2049)]) {
      expect(await verifyTurnstileToken(t, null, { fetch: f })).toBe("rejected");
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("Cloudflare'e ulaşılamıyor (ağ hatası, 5xx, bozuk cevap) → unavailable (kayıt geçer)", async () => {
    on();
    const boom = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await verifyTurnstileToken("tok", null, { fetch: boom as unknown as typeof fetch })).toBe("unavailable");
    expect(await verifyTurnstileToken("tok", null, { fetch: reply({}, 503) })).toBe("unavailable");
    const garbage = vi.fn(async () => new Response("<html>", { status: 200 }));
    expect(await verifyTurnstileToken("tok", null, { fetch: garbage })).toBe("unavailable");
  });

  it("Cloudflare bizim gizli anahtarımızı reddederse (yanlış yapılandırma) → unavailable (kayıtlar kilitlenmez)", async () => {
    on();
    for (const code of ["invalid-input-secret", "missing-input-secret"]) {
      expect(await verifyTurnstileToken("tok", null, { fetch: reply({ success: false, "error-codes": [code] }) })).toBe("unavailable");
    }
    expect(await verifyTurnstileToken("tok", null, { fetch: reply({ success: false, "error-codes": ["invalid-input-response"] }) })).toBe(
      "rejected",
    );
  });
});
