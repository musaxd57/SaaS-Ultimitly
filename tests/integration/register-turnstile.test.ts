import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(async () => {}), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => {}) };
});

import { POST as register } from "@/app/api/auth/register/route";
import { reportError } from "@/lib/report-error";

// ---------------------------------------------------------------------------
// U15 (kurucu 10-22): kayıt rotası Turnstile belirtecini HESAP ARAMASINDAN ÖNCE doğrular. Red → 400 + hiçbir şey yazılmaz; Cloudflare'e
// ulaşılamazsa kayıt geçer + hata kaydı; anahtar kapalıyken belirteç hiç sorulmaz (bugünkü davranış).
// ---------------------------------------------------------------------------

function req(body: Record<string, unknown>, ip = "9.9.9.9") {
  return new NextRequest("https://www.lixusai.com/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", host: "www.lixusai.com", "x-forwarded-for": ip },
    body: JSON.stringify({
      organizationName: "İşletme",
      name: "Test Host",
      email: "yeni@example.com",
      password: "sifre12345",
      consent: true,
      ...body,
    }),
  });
}

const fetchMock = vi.fn();

describe("POST /api/auth/register — Turnstile (U15)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubEnv("REGISTRATION_OPEN", "1");
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function enable() {
    vi.stubEnv("SIGNUP_TURNSTILE_ENABLED", "1");
    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret-key");
  }

  it("anahtar KAPALI: belirteçsiz kayıt eskisi gibi 201, Cloudflare'e gidilmez", async () => {
    const res = await register(req({}));
    expect(res.status).toBe(201);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.user.count()).toBe(1);
  });

  it("anahtar AÇIK + Cloudflare 'geçmedi' → 400 (captcha), kullanıcı / işletme YAZILMAZ", async () => {
    enable();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ success: false }), { status: 200 }));
    const res = await register(req({ turnstileToken: "bad" }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.captcha).toBeTruthy();
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.organization.count()).toBe(0);
  });

  it("anahtar AÇIK + belirteç yok → 400, Cloudflare'e bile gidilmez", async () => {
    enable();
    const res = await register(req({}));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.user.count()).toBe(0);
  });

  it("anahtar AÇIK + Cloudflare 'geçti' → 201", async () => {
    enable();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ success: true, action: "register" }), { status: 200 }));
    const res = await register(req({ turnstileToken: "good" }));
    expect(res.status).toBe(201);
    expect(await prisma.user.count()).toBe(1);
  });

  it("anahtar AÇIK + Cloudflare'e ulaşılamıyor → kayıt GEÇER + hata kaydı", async () => {
    enable();
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const res = await register(req({ turnstileToken: "any" }));
    expect(res.status).toBe(201);
    expect(await prisma.user.count()).toBe(1);
    expect(vi.mocked(reportError).mock.calls.some(([ctx]) => ctx === "register.turnstile-unavailable")).toBe(true);
  });

  it("red cevabı adresin kayıtlı olup olmadığından BAĞIMSIZ (varlık sızmaz)", async () => {
    // Önce anahtar kapalıyken hesap aç, sonra aynı adresle reddedilen deneme ↔ yeni adresle reddedilen deneme: gövde aynı.
    await register(req({}, "1.1.1.1"));
    enable();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ success: false }), { status: 200 }));
    const known = await register(req({ turnstileToken: "bad" }, "2.2.2.2"));
    const unknown = await register(req({ turnstileToken: "bad", email: "baska@example.com" }, "3.3.3.3"));
    expect(known.status).toBe(400);
    expect(await known.json()).toEqual(await unknown.json());
  });
});
