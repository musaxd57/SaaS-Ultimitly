import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";

vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return {
    ...actual,
    setSessionCookie: vi.fn().mockResolvedValue(undefined),
    setKnownDeviceCookie: vi.fn().mockResolvedValue(undefined),
  };
});

import { POST } from "@/app/api/auth/login/route";

// ---------------------------------------------------------------------------
// DAVRANIŞSAL: giriş rotasının IP kovası IPv6 /64 öneki başınadır (09-23).
// Eskiden aynı /64'ten her adres AYRI kovaydı → "IP başına 10 deneme / 5 dk" tek bir
// VPS'e sahip saldırgan için fiilen SINIRSIZDI (parola püskürtme, sızıntı listesi deneme).
// Her istek FARKLI e-postaya gider → hesap kovası (20/15 dk) hiç dolmaz; 11. isteği
// durduran yalnız IP kovası olabilir.
// ---------------------------------------------------------------------------

function loginFrom(ip: string, i: number) {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email: `hedef${i}@example.com`, password: "yanlis-parola" }),
  });
}

describe("giriş IP kovası — IPv6 /64", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
  });

  it("aynı /64'ten 11 farklı adres: 11. istek 429 alır", async () => {
    const statuses: number[] = [];
    for (let i = 1; i <= 11; i++) {
      const res = await POST(loginFrom(`2001:db8:abcd:1234::${i.toString(16)}`, i));
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("KONTROL: farklı /64'ten gelen istek o kovadan ETKİLENMEZ", async () => {
    for (let i = 1; i <= 10; i++) await POST(loginFrom(`2001:db8:abcd:1234::${i.toString(16)}`, i));
    const other = await POST(loginFrom("2001:db8:abcd:9999::1", 99));
    expect(other.status).toBe(401);
  });
});
