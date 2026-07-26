import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";

// Kayıt rotası e-posta gönderir; sağlayıcıya hiç gitmesin.
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(async () => {}), sendReporting: vi.fn(async () => ({ ok: true })) },
}));

import { POST as register } from "@/app/api/auth/register/route";

// ---------------------------------------------------------------------------
// KAYITTA SAAT DİLİMİ — uçtan uca.
//
// Organization.timezone şemada Europe/Istanbul default'lu ve kayıt rotası bu
// alanı HİÇ yazmıyordu. Türkiye'de doğru cevap; .eu'da değil. Tarayıcı kendi
// IANA dilimini bildiriyor, sunucu DOĞRULUYOR ve org'a yazıyor.
//
// Değerin istemciden gelmesi güvenlik açısından sınırlı: host yalnız KENDİ
// org'unun dilimini etkiler ve zaten Ayarlar'dan değiştirebilir. Yine de
// doğrulanmadan yazılmaz — DB'ye çöp girmesin.
// ---------------------------------------------------------------------------

let n = 0;
function registerReq(body: Record<string, unknown>) {
  return new NextRequest("https://www.lixusai.com/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", host: "www.lixusai.com" },
    body: JSON.stringify({
      organizationName: `İşletme ${++n}`,
      name: "Test Host",
      email: `host${n}@example.com`,
      password: "sifre12345",
      consent: true,
      ...body,
    }),
  });
}

/** Kaydı çalıştır ve yaratılan org'u döndür. */
async function registerAndReadOrg(body: Record<string, unknown>) {
  __resetRateLimit(); // rota IP başına 5/saat sınırlıyor
  const res = await register(registerReq(body));
  expect(res.status).toBe(201);
  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "desc" } });
  expect(org).not.toBeNull();
  return org!;
}

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  vi.clearAllMocks();
  process.env.REGISTRATION_OPEN = "1";
  delete process.env.APP_DEFAULT_TIMEZONE;
});
afterAll(async () => {
  delete process.env.REGISTRATION_OPEN;
  delete process.env.APP_DEFAULT_TIMEZONE;
  await prisma.$disconnect();
});

describe("kayıt — Organization.timezone", () => {
  it("tarayıcının bildirdiği geçerli dilim org'a YAZILIR", async () => {
    const org = await registerAndReadOrg({ timezone: "Europe/Berlin" });
    expect(org.timezone).toBe("Europe/Berlin");
  });

  it("dilim hiç gönderilmezse .com varsayılanı korunur (eski davranışın aynısı)", async () => {
    const org = await registerAndReadOrg({});
    expect(org.timezone).toBe("Europe/Istanbul");
  });

  it("APP_DEFAULT_TIMEZONE ayarlıysa fallback ODUR (.eu)", async () => {
    process.env.APP_DEFAULT_TIMEZONE = "Europe/Berlin";
    const org = await registerAndReadOrg({});
    expect(org.timezone).toBe("Europe/Berlin");
  });

  it("geçersiz dilim kaydı REDDETMEZ — sessizce varsayılana düşer", async () => {
    // Eski/tuhaf bir tarayıcının çöp göndermesi kimseyi kayıttan alıkoymamalı.
    const org = await registerAndReadOrg({ timezone: "Mars/Olympus" });
    expect(org.timezone).toBe("Europe/Istanbul");
  });

  it("dilim alanı string DEĞİLSE de kayıt geçer (400 değil)", async () => {
    const org = await registerAndReadOrg({ timezone: { evil: true } });
    expect(org.timezone).toBe("Europe/Istanbul");
  });

  it("uzun çöp değer kaydı bozmaz", async () => {
    const org = await registerAndReadOrg({ timezone: "A".repeat(5000) });
    expect(org.timezone).toBe("Europe/Istanbul");
  });

  it("MEVCUT organizasyonların dilimi kayıt akışından ETKİLENMEZ", async () => {
    // Var olan bir org (Ayarlar'dan Dubai'ye çekilmiş) — yeni kayıt onu oynatamaz.
    const existing = await prisma.organization.create({
      data: { name: "Mevcut İşletme", timezone: "Asia/Dubai" },
    });
    await registerAndReadOrg({ timezone: "America/New_York" });
    const after = await prisma.organization.findUnique({ where: { id: existing.id } });
    expect(after?.timezone).toBe("Asia/Dubai");
  });
});
