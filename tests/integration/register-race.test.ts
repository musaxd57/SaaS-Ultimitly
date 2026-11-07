import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// KAYIT YARIŞI: AYNI YENİ E-POSTAYLA İKİ EŞZAMANLI KAYIT → 500 + ALARM OLMAZ (09-23).
//
// "Bu e-posta var mı" okuması ile ekleme arasında ~300 ms'lik parola hash'i var. İki
// istek ikisi de "yok" görüp eklemeye koşunca ikincisi `User.email` eşsizlik ihlaline
// (P2002) çarpıyordu → genel `catch` → `serverError` → 500 + `reportError("api")` →
// ALARM E-POSTASI. Hesabı olmayan herkes tetikleyebiliyordu (kayıt açık) ve "api" alarm
// bağlamı TÜM rotalarla ortak olduğundan sürekli bir damla gerçek alarmları gömerdi —
// sabahki alarm selinin aynı sınıfı. Artık kaybeden istek, var-olan-hesap dalıyla
// BİREBİR aynı 201'i alır (numaralandırma kâhini de doğmaz); yarım org kalmaz (TX geri alınır).
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(async () => {}), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })) };
});

import { reportError } from "@/lib/report-error";
import { POST as register } from "@/app/api/auth/register/route";

function registerReq(ip: string) {
  return new NextRequest("https://www.lixusai.com/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", host: "www.lixusai.com", "x-forwarded-for": ip },
    body: JSON.stringify({
      organizationName: "İşletme",
      name: "Test Host",
      email: "yaris@example.com",
      password: "sifre12345",
      consent: true,
    }),
  });
}

describe("POST /api/auth/register — eşzamanlı aynı e-posta", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.stubEnv("REGISTRATION_OPEN", "1");
  });

  it("iki eşzamanlı kayıt: ikisi de 201, TEK hesap + TEK org, alarm YOK", async () => {
    const [a, b] = await Promise.all([register(registerReq("5.5.5.1")), register(registerReq("5.5.5.2"))]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(await a.json()).toEqual(await b.json());
    expect(await prisma.user.count({ where: { email: "yaris@example.com" } })).toBe(1);
    // Kaybeden TX geri alındı: yetim org/abonelik kalmadı.
    expect(await prisma.organization.count()).toBe(1);
    expect(await prisma.subscription.count()).toBe(1);
    expect(vi.mocked(reportError)).not.toHaveBeenCalled();
  });
});
