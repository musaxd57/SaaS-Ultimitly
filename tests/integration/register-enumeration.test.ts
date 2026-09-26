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

function registerReq(email: string, ip?: string) {
  return new NextRequest("https://www.lixusai.com/api/auth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "www.lixusai.com",
      // IP verilirse her istek FARKLI bir adresten gelmiş sayılır — IP kovasını
      // (5/saat) devre dışı bırakıp ADRES kovasını yalıtmak için.
      ...(ip ? { "x-forwarded-for": ip } : {}),
    },
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

  // -------------------------------------------------------------------------
  // "ZATEN HESABIN VAR" BİLDİRİMİ (08-06).
  //
  // Enumeration koruması SESSİZ BİR ÇIKMAZ üretiyordu: hesabı olduğunu unutan
  // gerçek kullanıcı "kutunuzu kontrol edin" görüp hiçbir şey almıyor, kayıt
  // ekranındaki tek düğme "yeniden gönder" ve o da doğrulanmış hesapta sessizce
  // yutuluyordu → kapalı döngü. Bildirim döngüyü kırar.
  //
  // 🚨 YANIT DEĞİŞMEZ. Bilgi HTTP kanalından değil, YALNIZ adresin sahibinin
  // posta kutusundan akar — saldırgan kurbanın adresini yazarsa cevabı kendisi
  // değil kurban alır.
  // -------------------------------------------------------------------------
  it("var olan adrese BİLDİRİM gider ama yanıt birebir aynı kalır", async () => {
    await register(registerReq("sahip@example.com"));
    vi.clearAllMocks();

    const res = await register(registerReq("sahip@example.com"));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, verifyEmail: true });

    const { emailService } = await import("@/lib/email");
    const calls = vi.mocked(emailService.sendReporting).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("sahip@example.com");
    expect(calls[0][1]).toMatch(/zaten bir hesabınız var/i);
  });

  it("YENİ adreste bildirim GİTMEZ — yalnız doğrulama maili", async () => {
    // ⚠️ Ters yön: bildirim koşulsuz gönderilirse burası kırmızı olur.
    const res = await register(registerReq("yepyeni@example.com"));
    expect(res.status).toBe(201);

    const { emailService } = await import("@/lib/email");
    const subjects = vi.mocked(emailService.sendReporting).mock.calls.map((c) => c[1]);
    expect(subjects).toHaveLength(1);
    expect(subjects[0]).toMatch(/doğrulayın/i);
    expect(subjects[0]).not.toMatch(/zaten bir hesabınız var/i);
  });

  it("BİLDİRİM METNİ istek gövdesinden HİÇBİR ŞEY taşımaz (kimlik avı enjeksiyonu)", async () => {
    // `registerSchema` `name` ve `organizationName` için 200 karakter SERBEST
    // METİN kabul ediyor ve bu maili tetikleyen istek SALDIRGANDAN gelebilir.
    // "Merhaba {name}" yazmak, kurbanın GÜVENDİĞİ bir e-postaya saldırganın
    // metnini koymak olurdu; `escapeHtml` HTML'i kaçar ama METNİ engellemez.
    await register(registerReq("kurban@example.com"));
    vi.clearAllMocks();

    const zehirli = new NextRequest("https://www.lixusai.com/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", host: "www.lixusai.com" },
      body: JSON.stringify({
        organizationName: "ACIL: hesabiniz kapatilacak",
        name: "Buraya tiklayin hemen",
        email: "kurban@example.com",
        password: "sifre12345",
        consent: true,
      }),
    });
    await register(zehirli);

    const { emailService } = await import("@/lib/email");
    const html = String(vi.mocked(emailService.sendReporting).mock.calls[0][2]);
    expect(html).not.toContain("ACIL: hesabiniz kapatilacak");
    expect(html).not.toContain("Buraya tiklayin hemen");
  });

  it("BİLDİRİMDE eylem tetikleyen bağlantı YOK (yalnız düz gezinme)", async () => {
    // Rota kimliksiz ve saldırgan tetikleyicisi → maildeki her token'lı bağlantı,
    // saldırganın kurbana karşı tetiklediği bir eyleme dönüşürdü. Ayrıca e-posta
    // tarayıcılarının ön-ısıtma istekleri tek-kullanımlık token'ı tüketir.
    await register(registerReq("baglanti@example.com"));
    vi.clearAllMocks();
    await register(registerReq("baglanti@example.com"));

    const { emailService } = await import("@/lib/email");
    const html = String(vi.mocked(emailService.sendReporting).mock.calls[0][2]);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).not.toMatch(/#t=|\?t=|token/i);
      expect(new URL(href).search).toBe("");
      expect(new URL(href).hash).toBe("");
    }
  });

  it("ADRES BAŞINA kova dolunca mail susar ama YANIT değişmez", async () => {
    // 🚨 HER İSTEK FARKLI IP'DEN: gerçek tehdit modeli bu. IP kovası (5/saat)
    // tek başına yetmez çünkü saldırgan proxy/botnet ile adres döndürür; kurbanı
    // koruyan şey ADRES başına kovadır.
    await register(registerReq("kova@example.com", "9.9.0.1"));

    const { emailService } = await import("@/lib/email");
    const statuses: number[] = [];
    // Kova 4/15dk → tavandan sonra bildirim susmalı, yanıt YİNE 201 olmalı.
    for (let i = 0; i < 6; i++) {
      const r = await register(registerReq("kova@example.com", `9.9.1.${i}`));
      statuses.push(r.status);
    }
    expect(new Set(statuses)).toEqual(new Set([201]));

    const notices = vi
      .mocked(emailService.sendReporting)
      .mock.calls.filter((c) => /zaten bir hesabınız var/i.test(String(c[1])));
    // 429 ASLA dönmedi (yukarıda pinli) ama mail sayısı tavanla sınırlı.
    expect(notices.length).toBeLessThanOrEqual(4);
    expect(notices.length).toBeGreaterThan(0);
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
