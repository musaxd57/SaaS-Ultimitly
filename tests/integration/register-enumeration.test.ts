import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(async () => {}), sendReporting: vi.fn(async () => ({ ok: true })) },
}));

import { POST as register } from "@/app/api/auth/register/route";

// ---------------------------------------------------------------------------
// KAYIT ROTASI HESAP VARLIĞINI SIZDIRMAZ (Codex denetimi, 2026-08-01 — madde 4).
//
// `REGISTRATION_OPEN=1` iken var olan bir e-posta açıkça "zaten kayıtlı" 400'ü
// alıyordu. Giriş, şifre-sıfırlama ve doğrulama-tekrar yollarının HEPSİ bu
// konuda sıkıyken tek kalan sızıntı noktası buydu: saldırgan hedef adresi
// gönderip hesabın VARLIĞINI kesinleştiriyor, parola püskürtme öncesi hedef
// listesi çıkarıyordu.
//
// ⚠️ GENEL YANIT TEK BAŞINA YETMEZ — ZAMANLAMA DA EŞLEŞMELİ. Normal yol bir
// bcrypt (yavaş) harcıyor; var-olan dalı erken dönseydi yanıt gözle görülür
// biçimde hızlı olur ve gövde aynı olsa bile varlık yine sızardı. Bu yüzden o
// dal da AYNI bcrypt maliyetini öder (giriş rotasındaki dummy-compare emsali).
//
// ⚠️ MEVCUT AKIŞ BOZULMAZ: yeni kayıt aynen 201 + doğrulama e-postası.
// ---------------------------------------------------------------------------

function registerReq(email: string) {
  return new NextRequest("https://www.lixusai.com/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", host: "www.lixusai.com" },
    body: JSON.stringify({
      organizationName: "İşletme",
      name: "Test Host",
      email,
      password: "sifre12345",
      consent: true,
    }),
  });
}

describe("POST /api/auth/register — enumeration kapalı", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.stubEnv("REGISTRATION_OPEN", "1");
  });

  it("VAR OLAN e-posta, YENİ kayıtla AYNI yanıtı alır", async () => {
    const fresh = await register(registerReq("yeni@example.com"));
    expect(fresh.status).toBe(201);
    const freshBody = await fresh.json();

    const dup = await register(registerReq("yeni@example.com"));
    expect(dup.status).toBe(201); // ⬅️ ARIZADA 400 "zaten kayıtlı"
    expect(await dup.json()).toEqual(freshBody); // gövde de BİREBİR aynı
  });

  it("ikinci istek HİÇBİR ŞEY yaratmaz (org/kullanıcı/abonelik sayısı sabit)", async () => {
    await register(registerReq("tek@example.com"));
    const before = {
      orgs: await prisma.organization.count(),
      users: await prisma.user.count(),
      subs: await prisma.subscription.count(),
    };

    await register(registerReq("tek@example.com"));

    expect(await prisma.organization.count()).toBe(before.orgs);
    expect(await prisma.user.count()).toBe(before.users);
    expect(await prisma.subscription.count()).toBe(before.subs);
  });

  it("var olan kullanıcının doğrulama durumu EZİLMEZ", async () => {
    await register(registerReq("sabit@example.com"));
    const first = await prisma.user.findUniqueOrThrow({ where: { email: "sabit@example.com" } });
    // Kullanıcı e-postasını doğrulamış olsun.
    await prisma.user.update({
      where: { id: first.id },
      data: { emailVerifiedAt: new Date(), emailVerifyTokenHash: null },
    });

    await register(registerReq("sabit@example.com"));

    const after = await prisma.user.findUniqueOrThrow({ where: { email: "sabit@example.com" } });
    expect(after.emailVerifiedAt).not.toBeNull(); // doğrulanmış kalır
    expect(after.emailVerifyTokenHash).toBeNull(); // yeni token BASILMAZ
    expect(after.passwordHash).toBe(first.passwordHash); // şifresi DEĞİŞMEZ
  });

  it("ZAMANLAMA PARİTESİ: var-olan dalı da bir bcrypt harcar (kaynak pini)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/app/api/auth/register/route.ts", "utf8");
    const dupBranch = src.slice(src.indexOf("if (existing)"), src.indexOf("if (existing)") + 900);
    expect(dupBranch).toMatch(/hashPassword\(/); // erken dönüş YOK, maliyet ödenir
    expect(dupBranch).not.toMatch(/zaten kayıtlı/); // eski sızdıran metin geri gelmesin
  });

  it("YENİ kayıt akışı bozulmadı (regresyon pini)", async () => {
    const res = await register(registerReq("taze@example.com"));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, verifyEmail: true });
    const u = await prisma.user.findUniqueOrThrow({ where: { email: "taze@example.com" } });
    expect(u.role).toBe("owner");
    expect(u.emailVerifyTokenHash).not.toBeNull(); // doğrulama tokenı basıldı
  });
});
