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
// alanı HİÇ yazmıyordu. Artık AÇIKÇA yazıyor — ama neyi yazacağına DEPLOYMENT
// karar veriyor, istemci değil:
//
//   .com (bayrak KAPALI, varsayılan) → daima APP_DEFAULT_TIMEZONE. Her müşteri
//   Türkiye'deki daireleri yöneten bir Türk host; tarayıcı yalnızca YANLIŞ OLMA
//   YOLU ekler (yurt dışındayken kaydolmak) ve yanlış dilim neredeyse görünmez:
//   belirti "mesaj tuhaf saatte gitti" olur, saat dilimi hatasına benzemez.
//
//   .eu (APP_TRUST_BROWSER_TIMEZONE=1) → tarayıcının bildirdiği gerçek dilim.
//
// Tarayıcı her iki hâlde de dilimini GÖNDERİR; değişen, sunucunun ona inanıp
// inanmadığıdır. Bu yüzden .eu'yu açmak env değişikliği, istemci değişikliği
// değil. Bayrak açıkken bile değer DOĞRULANIR — DB'ye çöp girmesin.
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
  delete process.env.APP_TRUST_BROWSER_TIMEZONE;
});
afterAll(async () => {
  delete process.env.REGISTRATION_OPEN;
  delete process.env.APP_DEFAULT_TIMEZONE;
  delete process.env.APP_TRUST_BROWSER_TIMEZONE;
  await prisma.$disconnect();
});

describe("kayıt — .com (bayrak KAPALI): tarayıcı dilimi YOK SAYILIR", () => {
  it("tarayıcı Berlin dese bile org İstanbul'da başlar", async () => {
    // Asıl korunan senaryo: Türk host Almanya'da tatildeyken kaydoluyor.
    const org = await registerAndReadOrg({ timezone: "Europe/Berlin" });
    expect(org.timezone).toBe("Europe/Istanbul");
  });

  it("dilim hiç gönderilmezse de İstanbul (kayıt öncesi davranışın aynısı)", async () => {
    const org = await registerAndReadOrg({});
    expect(org.timezone).toBe("Europe/Istanbul");
  });

  it("APP_DEFAULT_TIMEZONE ayarlıysa TEK kaynak odur — tarayıcı yine ezemez", async () => {
    process.env.APP_DEFAULT_TIMEZONE = "Europe/Lisbon";
    const org = await registerAndReadOrg({ timezone: "America/New_York" });
    expect(org.timezone).toBe("Europe/Lisbon");
  });
});

describe("kayıt — .eu (APP_TRUST_BROWSER_TIMEZONE=1): tarayıcı dilimi YAZILIR", () => {
  beforeEach(() => {
    process.env.APP_TRUST_BROWSER_TIMEZONE = "1";
  });

  it("tarayıcının bildirdiği geçerli dilim org'a yazılır", async () => {
    const org = await registerAndReadOrg({ timezone: "Europe/Berlin" });
    expect(org.timezone).toBe("Europe/Berlin");
  });

  it("bayrak açıkken bile deployment varsayılanı fallback olarak durur", async () => {
    process.env.APP_DEFAULT_TIMEZONE = "Europe/Berlin";
    const org = await registerAndReadOrg({});
    expect(org.timezone).toBe("Europe/Berlin");
  });

  it("bayrak açıkken bile geçersiz değer kaydı REDDETMEZ — varsayılana düşer", async () => {
    const org = await registerAndReadOrg({ timezone: "Mars/Olympus" });
    expect(org.timezone).toBe("Europe/Istanbul");
  });
});

describe("kayıt — dilimden bağımsız güvenceler", () => {
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
