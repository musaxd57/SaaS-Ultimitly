import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// KİMLİK ROTALARI: JSON KONTROLÜ IP KOVASINDAN ÖNCE (09-23; `login` F8 emsali)
//
// `application/json` CORS-safelisted DEĞİL → başka bir site onu tarayıcıdan preflight'sız
// gönderemez; `text/plain` ise gönderebilir. JSON kontrolü kovadan SONRA olunca kötü niyetli
// bir sayfa, ziyaretçilerinin tarayıcılarıyla bütün bir ofis/mobil NAT'ının kayıt, parola
// sıfırlama ve doğrulama kovalarını yakıp o ağı bu akışlardan dakikalarca dışarıda bırakabilirdi.
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(async () => {}), sendReporting: vi.fn(async () => ({ ok: true })) },
}));

import { POST as register } from "@/app/api/auth/register/route";
import { POST as forgot } from "@/app/api/account/forgot-password/route";
import { POST as resend } from "@/app/api/auth/resend-verification/route";

const ROUTES = [
  { name: "register", handler: register, url: "http://localhost/api/auth/register", bucket: "register:" },
  { name: "forgot-password", handler: forgot, url: "http://localhost/api/account/forgot-password", bucket: "forgot:" },
  { name: "resend-verification", handler: resend, url: "http://localhost/api/auth/resend-verification", bucket: "verify-resend:" },
] as const;

const req = (url: string, contentType: string, body: string) =>
  new NextRequest(url, {
    method: "POST",
    headers: { "content-type": contentType, "x-forwarded-for": "203.0.113.7" },
    body,
  });

describe.each(ROUTES)("$name — tarayıcıdan gönderilebilen JSON-dışı istek kovaya DOKUNMAZ", ({ handler, url, bucket }) => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.stubEnv("REGISTRATION_OPEN", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 25 × text/plain → hepsi 415, IP kovası HİÇ yazılmaz, meşru JSON istek hâlâ geçer", async () => {
    for (let i = 0; i < 25; i++) {
      const res = await handler(req(url, "text/plain", JSON.stringify({ email: "x@x.com" })));
      expect(res.status).toBe(415);
    }
    const burned = await prisma.rateLimitCounter.count({ where: { key: { startsWith: bucket } } });
    expect(burned, "JSON-dışı istek IP kovasını tüketti").toBe(0);

    const ok = await handler(req(url, "application/json", JSON.stringify({})));
    expect([415, 429]).not.toContain(ok.status);
    // ANTİ-VAKUM: meşru istek kovayı GERÇEKTEN tüketiyor (sayaç yolu çalışıyor).
    expect(await prisma.rateLimitCounter.count({ where: { key: { startsWith: bucket } } })).toBe(1);
  });

  it("parametreli JSON başlığı (charset) kabul edilir — kendi formlarımızın biçimi", async () => {
    const res = await handler(req(url, "application/json; charset=utf-8", JSON.stringify({})));
    expect(res.status).not.toBe(415);
  });
});
