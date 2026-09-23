import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// ③ YENİ PAROLA 72 BAYTI AŞAMAZ — ÜÇ BELİRLEME YOLUNDA DA (kurucu onayı 09-23).
//
// bcrypt 72 bayttan sonrasını SESSİZCE yok sayar: sınır olmadan "uzun ve sonunda gizli
// kelime olan" bir parolanın o kelimesi hiç sayılmıyordu. Kural tek kaynaktan
// (`password-policy.ts`); burada ÜÇ yolun da ona bağlı olduğu davranışsal olarak
// sınanır (biri unutulsa o yoldan sınırsız parola belirlenebilirdi).
// "ş" UTF-8'de 2 bayttır: 37 × ş = 74 bayt (37 karakter — eski 200 karakter
// sınırının çok altında, yani bu testleri yalnız YENİ kural düşürebilir).
// ---------------------------------------------------------------------------

const TOO_LONG = "ş".repeat(37);
const OK_LONG = "ş".repeat(36); // tam 72 bayt

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(async () => {}), sendReporting: vi.fn(async () => ({ ok: true })) },
}));

import { POST as register } from "@/app/api/auth/register/route";
import { POST as changePassword } from "@/app/api/account/password/route";
import { POST as forgotPassword } from "@/app/api/account/forgot-password/route";

function jsonReq(url: string, body: unknown, ip = "4.4.4.4") {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", host: "www.lixusai.com", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("③ yeni parola 72 bayt sınırı — kayıt / değiştirme / sıfırlama", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.stubEnv("REGISTRATION_OPEN", "1");
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, name: "U", email: "u@example.com", passwordHash: "x", role: "owner" },
    });
    session = { userId: user.id, organizationId: org.id, role: "owner", email: "u@example.com", name: "U", sessionEpoch: 0 };
  });

  it("kayıt: 74 baytlık parola 400 + açıklayıcı metin; hesap AÇILMAZ", async () => {
    const res = await register(
      jsonReq("https://www.lixusai.com/api/auth/register", {
        organizationName: "İşletme",
        name: "Test Host",
        email: "yeni@example.com",
        password: TOO_LONG,
        consent: true,
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).fields?.password).toMatch(/72 bayt/);
    expect(await prisma.user.count({ where: { email: "yeni@example.com" } })).toBe(0);
  });

  it("KONTROL: kayıt tam 72 baytla açılır", async () => {
    const res = await register(
      jsonReq("https://www.lixusai.com/api/auth/register", {
        organizationName: "İşletme",
        name: "Test Host",
        email: "yeni@example.com",
        password: OK_LONG,
        consent: true,
      }),
    );
    expect(res.status).toBe(201);
  });

  it("değiştirme (oturumlu): 74 baytlık yeni parola kod kontrolünden ÖNCE reddedilir", async () => {
    const res = await changePassword(
      jsonReq("https://www.lixusai.com/api/account/password", {
        action: "confirm",
        code: "12345678",
        newPassword: TOO_LONG,
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).fields?.newPassword).toMatch(/72 bayt/);
  });

  it("sıfırlama (e-posta bağlantısı): 74 baytlık yeni parola reddedilir", async () => {
    const res = await forgotPassword(
      jsonReq("https://www.lixusai.com/api/account/forgot-password", {
        action: "confirm",
        token: "herhangi-bir-token",
        code: "12345678",
        newPassword: TOO_LONG,
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).fields?.newPassword).toMatch(/72 bayt/);
  });

  it("KONTROL: kısa parola hâlâ 'en az 8' metnini alır (iki yolda da)", async () => {
    const a = await changePassword(
      jsonReq("https://www.lixusai.com/api/account/password", { action: "confirm", code: "12345678", newPassword: "kisa" }),
    );
    expect((await a.json()).fields?.newPassword).toMatch(/en az 8/);
    const b = await forgotPassword(
      jsonReq("https://www.lixusai.com/api/account/forgot-password", {
        action: "confirm",
        token: "t",
        code: "12345678",
        newPassword: "kisa",
      }),
    );
    expect((await b.json()).fields?.newPassword).toMatch(/en az 8/);
  });
});
