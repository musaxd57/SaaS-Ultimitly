import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { hashPassword } from "@/lib/auth/password";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// ÖDEME ABONELİĞİ AÇIKKEN HESAP SİLİNMEZ — FAIL-CLOSED.
// (Codex denetimi, 2026-08-01 — madde 2.)
//
// Silme yolunda Paddle'a HİÇBİR iptal çağrısı yok (`deleteAccountData` yalnız
// webhook redaksiyonu + org silme yapar). Ekran ise silinenler listesinde
// "Abonelik ve faturalar" diyordu. Sonuç: ödeyen host hesabını siler, KARTINDAN
// ÇEKİLMEYE DEVAM EDER ve iptalin tek yolu olan "Aboneliği yönet" düğmesi artık
// giremediği hesabın içinde kalır — kendi kendine duramaz.
//
// Otomatik iptal para hot-path'idir ve ürün kararıdır → yapmıyoruz. Doğru
// davranış: silmeyi ENGELLE ve önce aboneliği iptal etmesini söyle.
//
// ⚠️ FAIL-CLOSED: durum BELİRSİZSE de silme yapılmaz. "Belirsiz" = sağlayıcıya
// bağlı (`provider: "paddle"`) bir abonelik satırı var ve durumu kesin olarak
// "bitmiş" (canceled) değil. Yerel durumu okuyamazsak (DB hatası) da silmeyiz.
// ---------------------------------------------------------------------------

let currentSession: SessionPayload | null = null;
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getSession: vi.fn(async () => currentSession),
    clearSessionCookie: vi.fn(async () => {}),
  };
});

import { POST } from "@/app/api/account/delete/route";

const PASSWORD = "correct-horse";

function req() {
  return new NextRequest("http://localhost/api/account/delete", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify({ password: PASSWORD }),
  });
}

async function seed(sub?: { provider: string; status: string }) {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Owner",
      email: "owner@example.com",
      passwordHash: await hashPassword(PASSWORD),
      role: "owner",
      emailVerifiedAt: new Date(),
    },
  });
  if (sub) {
    await prisma.subscription.create({
      data: { organizationId: org.id, provider: sub.provider, status: sub.status, planCode: "pro" },
    });
  }
  currentSession = {
    userId: user.id,
    organizationId: org.id,
    role: "owner",
    email: user.email,
    name: user.name,
    sessionEpoch: user.sessionEpoch,
  } as SessionPayload;
  return { orgId: org.id };
}

describe("hesap silme — ödeme aboneliği kapısı (fail-closed)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    currentSession = null;
  });

  for (const status of ["active", "past_due", "trialing"]) {
    it(`ENGELLER: sağlayıcı aboneliği "${status}" iken silme yapılmaz`, async () => {
      const { orgId } = await seed({ provider: "paddle", status });
      const res = await POST(req());

      expect(res.status).toBe(409); // ⬅️ ARIZADA 200 (silinir, tahsilat sürer)
      const body = await res.json();
      // ⚠️ Türkçe ünsüz yumuşaması: "abonelik" → "aboneliğiniz" (k→ğ), yani
      // "abonelik" ALT DİZE OLARAK GEÇMEZ. Kök üzerinden eşleştir.
      expect(String(body.error)).toMatch(/abonel/i);
      // Ve mesaj gerçekten YAPILACAK İŞİ söylüyor (yalnız "hayır" demiyor).
      expect(String(body.error)).toMatch(/iptal/i);
      expect(String(body.error)).not.toContain("\\"); // kaçış karakteri sızmasın
      // Org DURUYOR — hiçbir şey silinmedi.
      expect(await prisma.organization.count({ where: { id: orgId } })).toBe(1);
    });
  }

  it("BELİRSİZ durum da engeller (tanınmayan status → fail-closed)", async () => {
    const { orgId } = await seed({ provider: "paddle", status: "some_new_paddle_state" });
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(await prisma.organization.count({ where: { id: orgId } })).toBe(1);
  });

  it("İZİN VERİR: DÖNEM SONU iptali planlanmışsa silinir (çıkışsız döngü yok)", async () => {
    // ⚠️ Paddle portalından yapılan iptal DÖNEM SONUNA planlanır: `status` "active"
    // KALIR, yalnız `cancelAtPeriodEnd` true olur. Bunu görmezsek zaten iptal etmiş
    // müşteri 409 alır ve mesaj ona yaptığı şeyi TEKRAR yapmasını söyler — yıllık
    // planda ~12 ay sürebilecek çıkışsız bir döngü (bağımsız denetim, 08-01).
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Owner",
        email: "owner@example.com",
        passwordHash: await hashPassword(PASSWORD),
        role: "owner",
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.subscription.create({
      data: {
        organizationId: org.id,
        provider: "paddle",
        status: "active", // ⬅️ HÂLÂ aktif…
        planCode: "pro",
        cancelAtPeriodEnd: true, // ⬅️ …ama yeni tahsilat YAPILMAYACAK
      },
    });
    currentSession = {
      userId: user.id,
      organizationId: org.id,
      role: "owner",
      email: user.email,
      name: user.name,
      sessionEpoch: user.sessionEpoch,
    } as SessionPayload;

    const res = await POST(req());
    expect(res.status).toBe(200); // ⬅️ ARIZADA 409 (müşteri kilitli kalıyordu)
    expect(await prisma.organization.count({ where: { id: org.id } })).toBe(0);
  });

  it("KAYNAK PİNİ: abonelik yaratan HER dosya `provider` alanını AÇIKÇA belirler", async () => {
    // ⚠️ Şema varsayılanı `provider: "iyzico"` + `status: "active"` — yani
    // `provider`'ı belirlemeyen YENİ bir yol, org'u KALICI olarak silinemez yapar
    // (kapı onu gerçek bir ödeme aboneliği sanır). Bugün her yol ya alanı doğrudan
    // yazıyor ya da `newTrialSubscriptionData()` yardımcısını kullanıyor.
    //
    // ⚠️ SINIR (dürüstçe): bu DOSYA düzeyinde bir taramadır. Alan çoğu yerde
    // çağrının ÜSTÜNDE hazırlanan bir değişkende belirleniyor (`admin/customers`
    // `subData` gibi), o yüzden çağrının etrafına bakan dar bir pencere YANLIŞ
    // ALARM verir — ilk yazımda tam olarak öyle oldu. Dosya düzeyi daha kaba ama
    // DOĞRU: `provider`'ı hiç anmayan yeni bir yol eklenirse test kırmızıya döner.
    const fs = await import("node:fs/promises");
    async function walk(dir: string): Promise<string[]> {
      const out: string[] = [];
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const full = `${dir}/${e.name}`;
        if (e.isDirectory()) out.push(...(await walk(full)));
        else if (/\.tsx?$/.test(e.name)) out.push(full);
      }
      return out;
    }

    const offenders: string[] = [];
    for (const file of await walk("src")) {
      const src = await fs.readFile(file, "utf8");
      if (!/subscription\.create\(/.test(src)) continue;
      if (!/provider:/.test(src) && !/newTrialSubscriptionData/.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);

    // Ve yardımcının KENDİSİ provider'ı belirliyor (zincirin diğer ucu).
    const helper = await fs.readFile("src/lib/billing/subscription.ts", "utf8");
    expect(helper.slice(helper.indexOf("newTrialSubscriptionData"), helper.indexOf("newTrialSubscriptionData") + 600)).toMatch(
      /provider:/,
    );
  });

  it("İZİN VERİR: abonelik iptal edilmişse silinir", async () => {
    const { orgId } = await seed({ provider: "paddle", status: "canceled" });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await prisma.organization.count({ where: { id: orgId } })).toBe(0);
  });

  it("İZİN VERİR: hiç ödeme aboneliği yoksa silinir", async () => {
    const { orgId } = await seed();
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await prisma.organization.count({ where: { id: orgId } })).toBe(0);
  });

  it("İZİN VERİR: sağlayıcısız (trial/manual) satır tahsilat üretmez", async () => {
    const { orgId } = await seed({ provider: "trial", status: "trialing" });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await prisma.organization.count({ where: { id: orgId } })).toBe(0);
  });
});
