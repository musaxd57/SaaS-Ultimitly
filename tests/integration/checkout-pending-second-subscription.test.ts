import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// ÖDEME — İKİNCİ AKTİF ABONELİK ALARMI + "ÖDEMENİZ İŞLENİYOR" KİLİDİ (kurucu onayı 10-10;
// `docs/TASARIM-2026-10-10-odeme-idempotency-ve-deneme-kotuye-kullanim.md` §1 boşluk 1–2).
// Boşluk: "zaten aktif abonelik var" kontrolü yalnız webhook'un yazdığı satıra bakıyordu → webhook gelmeden ikinci sekmede ikinci ödeme
// tamamlanabiliyor; ikinci abonelik ilkinin yerine SESSİZCE geçiyor, ilki Paddle'da faturalanmaya devam edebiliyordu.
// ---------------------------------------------------------------------------

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn() }));
// Codex 11-04 P1: başarısızlık olayının kilit kararı Paddle'daki GERÇEK işlem durumunu okur → testte işlem başına durum tablosu.
const { txnStatus } = vi.hoisted(() => ({ txnStatus: new Map<string, string | null>() }));
vi.mock("@/lib/billing/paddle-transaction-status", async (orig) => {
  const actual = await orig<typeof import("@/lib/billing/paddle-transaction-status")>();
  return { ...actual, paddleTransactionStatus: vi.fn(async (id: string) => (txnStatus.has(id) ? txnStatus.get(id)! : null)) };
});
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: reportErrorMock };
});
// B-1 (kurucu 11-04): kayıtlı aboneliğin Paddle'daki oluşturulma zamanı — testte abonelik başına tablo (yoksa "bilinmiyor" = null).
const { subCreated } = vi.hoisted(() => ({ subCreated: new Map<string, string>() }));
vi.mock("@/lib/payments/paddle", async (orig) => {
  const actual = await orig<typeof import("@/lib/payments/paddle")>();
  return { ...actual, getSubscriptionCreatedAt: vi.fn(async (id: string) => (subCreated.has(id) ? new Date(subCreated.get(id)!) : null)) };
});

import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { POST as webhook } from "@/app/api/webhooks/paddle/route";
import { POST as consentPost } from "@/app/api/billing/consent/route";
import { POST as pendingPost } from "@/app/api/billing/checkout-pending/route";
import { CHECKOUT_PENDING_MESSAGE, CHECKOUT_PENDING_MS } from "@/lib/billing/checkout-pending-shared";
import { checkoutPendingLockName } from "@/lib/billing/checkout-pending";

const SECRET = "test-webhook-hmac-key-not-a-real-secret";
const ALARM = "paddle-webhook-second-subscription";
const ctx = { params: Promise.resolve({} as Record<string, never>) };

function sign(body: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac("sha256", SECRET).update(`${ts}:${body}`, "utf8").digest("hex");
  return `ts=${ts};h1=${h1}`;
}
const postEvent = (event: Record<string, unknown>) => {
  const body = JSON.stringify(event);
  return webhook(
    new NextRequest("http://localhost/api/webhooks/paddle", {
      method: "POST",
      headers: { "content-type": "application/json", "paddle-signature": sign(body) },
      body,
    }),
  );
};
const jsonReq = (url: string, body: unknown) =>
  new NextRequest(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const alarms = () => reportErrorMock.mock.calls.filter(([context]) => context === ALARM);

describe("ödeme — ikinci aktif abonelik alarmı + 'ödemeniz işleniyor' kilidi", () => {
  let orgId = "";
  let consentId = "";
  let n = 0;
  const subEvent = (subId: string, status: string) => ({
    event_id: `evt_${++n}`,
    event_type: "subscription.updated",
    occurred_at: new Date(Date.now() - 1_000 + n).toISOString(),
    data: { id: subId, status, customer_id: "ctm_1", custom_data: { consentId }, items: [{ price: { id: "pri_pro" } }] },
  });

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    txnStatus.clear();
    subCreated.clear();
    reportErrorMock.mockResolvedValue({ notified: true, throttled: false, configured: true });
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
    orgId = (await prisma.organization.create({ data: { name: "Org" } })).id;
    const user = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" } });
    session = { userId: user.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
    consentId = (
      await prisma.checkoutConsent.create({
        data: { organizationId: orgId, userId: user.id, planCode: "pro", priceId: "pri_pro", legalVersion: "2026-06", ip: "1.2.3.4" },
        select: { id: true },
      })
    ).id;
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const seedSub = (providerRef: string, status: string) =>
    prisma.subscription.create({ data: { organizationId: orgId, planCode: "pro", status, provider: "paddle", providerRef } });

  describe("alarm", () => {
    it("🚨 iptal EDİLMEMİŞ abonelik varken farklı abonelik aktifleşir → yeni abonelik yerine geçer (davranış AYNEN) + operatöre TEK alarm", async () => {
      await seedSub("sub_A", "active");
      expect((await postEvent(subEvent("sub_B", "active"))).status).toBe(200);
      expect((await prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } })).providerRef).toBe("sub_B");
      expect(alarms()).toHaveLength(1);
      expect(String(alarms()[0][1])).toMatch(/sub_A.*sub_B/);
      // Aynı yeni aboneliğin sonraki olayları yeniden uyarmaz (geçiş tabanlı).
      expect((await postEvent(subEvent("sub_B", "active"))).status).toBe(200);
      expect(alarms()).toHaveLength(1);
    });

    it("KONTROL: kayıtlı abonelik İPTAL edilmişse yeni abonelik alarm üretmez (meşru yeniden abonelik)", async () => {
      await seedSub("sub_A", "canceled");
      await postEvent(subEvent("sub_B", "active"));
      expect(alarms()).toHaveLength(0);
    });

    it("🚨 KONTROL (Haiku incelemesi): yeni abonelik zaten yazılıyken ESKİ aboneliğin GECİKMİŞ 'aktif' olayı sıra korumasıyla düşer → alarm YOK", async () => {
      await prisma.subscription.create({
        data: { organizationId: orgId, planCode: "pro", status: "active", provider: "paddle", providerRef: "sub_B", lastEventAt: new Date() },
      });
      const stale = { ...subEvent("sub_A", "active"), occurred_at: new Date(Date.now() - 3_600_000).toISOString() };
      expect((await postEvent(stale)).status).toBe(200);
      expect((await prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } })).providerRef).toBe("sub_B");
      expect(alarms()).toHaveLength(0);
    });

    it("KONTROL: aynı aboneliğin olayı (yenileme) ve aktif OLMAYAN farklı abonelik alarm üretmez", async () => {
      await seedSub("sub_A", "active");
      await postEvent(subEvent("sub_A", "active"));
      await postEvent(subEvent("sub_C", "past_due"));
      expect(alarms()).toHaveLength(0);
      expect((await prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } })).providerRef).toBe("sub_A");
    });
  });

  // ---------------------------------------------------------------------------
  // B-1 (kurucu 11-04 "böyle birşey olamaz kesinlikle hata"; derin ajan turu 2): iki abonelik açılınca yeni (B) eskisinin (A) yerine geçer.
  // Operatör alarma uyup A'yı "dönem sonunda iptal" edince Paddle A için AKTİF bir güncelleme yollar → kimlik şartı aktif olayda olmadığı için
  // satır A'ya geri dönüyordu; dönem sonunda A'nın iptali hesabı kapatıyor, B her ay ödendiği hâlde bir daha bağlanmıyordu. Artık farklı
  // aboneliğin aktif olayı, o abonelik kayıtlı olandan DAHA ESKİ olduğu KESİN biliniyorsa yerine geçmez (yalnız kaydedilir + alarm).
  // ---------------------------------------------------------------------------
  describe("B-1 — eski aboneliğin sonraki aktif olayı yeni aboneliğin yerini ALAMAZ", () => {
    const OLDER = "paddle-webhook-older-subscription-event";
    const withCreated = (ev: ReturnType<typeof subEvent>, createdAt: string, extra: Record<string, unknown> = {}) => ({
      ...ev,
      data: { ...ev.data, created_at: createdAt, ...extra },
    });

    it("🚨 kayıtlı B (10:02) varken A'nın (10:00) dönem sonu iptal planı (aktif) gelir → satır B'de KALIR, operatöre alarm", async () => {
      await seedSub("sub_B", "active");
      subCreated.set("sub_B", "2026-11-04T10:02:00Z");
      const ev = withCreated(subEvent("sub_A", "active"), "2026-11-04T10:00:00Z", { scheduled_change: { action: "cancel" } });
      expect((await postEvent(ev)).status).toBe(200);
      const row = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });
      expect(row.providerRef).toBe("sub_B");
      expect(row.status).toBe("active");
      expect(row.cancelAtPeriodEnd).toBe(false);
      expect(reportErrorMock.mock.calls.filter(([c]) => c === OLDER)).toHaveLength(1);
      expect(alarms()).toHaveLength(0); // "ikinci abonelik aktifleşti" yanıltıcı alarmı da yok
    });

    it("KONTROL: DAHA YENİ abonelik (B 10:02) kayıtlı eskinin (A 10:00) yerine geçer — bugünkü davranış + ikinci abonelik alarmı", async () => {
      await seedSub("sub_A", "active");
      subCreated.set("sub_A", "2026-11-04T10:00:00Z");
      expect((await postEvent(withCreated(subEvent("sub_B", "active"), "2026-11-04T10:02:00Z"))).status).toBe(200);
      expect((await prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } })).providerRef).toBe("sub_B");
      expect(alarms()).toHaveLength(1);
      expect(reportErrorMock.mock.calls.filter(([c]) => c === OLDER)).toHaveLength(0);
    });

    it("KONTROL: zaman bilinmezse (Paddle okunamadı / olayda yok) bugünkü davranış AYNEN — yerine geçer", async () => {
      await seedSub("sub_B", "active");
      expect((await postEvent(withCreated(subEvent("sub_A", "active"), "2026-11-04T10:00:00Z"))).status).toBe(200);
      expect((await prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } })).providerRef).toBe("sub_A");
    });
  });

  describe("kilit", () => {
    it("🚨 tamamlanan ödeme sinyali → 10 dk kilit; kilit varken yeni ödeme ekranı (onay kaydı) AÇILMAZ, müşteriye sade metin", async () => {
      const t0 = Date.now();
      expect((await pendingPost(jsonReq("http://localhost/api/billing/checkout-pending", { consentId }), ctx)).status).toBe(200);
      const lock = await prisma.systemLock.findUniqueOrThrow({ where: { name: checkoutPendingLockName(orgId) } });
      expect(lock.lockedUntil.getTime()).toBeGreaterThanOrEqual(t0 + CHECKOUT_PENDING_MS - 5_000);
      expect(lock.lockedUntil.getTime()).toBeLessThanOrEqual(Date.now() + CHECKOUT_PENDING_MS + 5_000);

      const before = await prisma.checkoutConsent.count();
      const res = await consentPost(jsonReq("http://localhost/api/billing/consent", { planCode: "pro", priceId: "pri_pro" }), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).fields._).toBe(CHECKOUT_PENDING_MESSAGE);
      expect(await prisma.checkoutConsent.count()).toBe(before);
    });

    it("KONTROL: kilit yokken ya da süresi dolmuşken ödeme ekranı açılır", async () => {
      expect((await consentPost(jsonReq("http://localhost/api/billing/consent", { planCode: "pro", priceId: "pri_pro" }), ctx)).status).toBe(201);
      await prisma.systemLock.create({ data: { name: checkoutPendingLockName(orgId), lockedUntil: new Date(Date.now() - 1_000), holder: consentId } });
      expect((await consentPost(jsonReq("http://localhost/api/billing/consent", { planCode: "pro", priceId: "pri_pro" }), ctx)).status).toBe(201);
    });

    it("🚨 başka işletmenin onayı 404, eski onay (3 saatten eski) reddedilir — kilit YAZILMAZ", async () => {
      const other = await prisma.organization.create({ data: { name: "Diğer" } });
      const foreign = await prisma.checkoutConsent.create({
        data: { organizationId: other.id, planCode: "pro", priceId: "pri_pro", legalVersion: "2026-06", ip: "1.2.3.4" },
        select: { id: true },
      });
      expect((await pendingPost(jsonReq("http://localhost/api/billing/checkout-pending", { consentId: foreign.id }), ctx)).status).toBe(404);
      const old = await prisma.checkoutConsent.create({
        data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "2026-06", ip: "1.2.3.4", createdAt: new Date(Date.now() - 4 * 3_600_000) },
        select: { id: true },
      });
      expect((await pendingPost(jsonReq("http://localhost/api/billing/checkout-pending", { consentId: old.id }), ctx)).status).toBe(400);
      expect((await pendingPost(jsonReq("http://localhost/api/billing/checkout-pending", {}), ctx)).status).toBe(400);
      expect(await prisma.systemLock.count({ where: { name: { startsWith: "checkout-pending:" } } })).toBe(0);
    });

    it("yalnız işletme SAHİBİ (ödeme ekranı da yalnız sahibe açılır)", async () => {
      session = { ...session!, role: "manager" };
      expect((await pendingPost(jsonReq("http://localhost/api/billing/checkout-pending", { consentId }), ctx)).status).toBe(403);
      expect(await prisma.systemLock.count({ where: { name: checkoutPendingLockName(orgId) } })).toBe(0);
    });

    it("🚨 aynı onay kilidi UZATAMAZ (Haiku incelemesi); kilit varken yeni onay kaydı verilmediği için uzatma yolu kalmaz", async () => {
      await pendingPost(jsonReq("http://localhost/api/billing/checkout-pending", { consentId }), ctx);
      const soon = new Date(Date.now() + 60_000);
      await prisma.systemLock.update({ where: { name: checkoutPendingLockName(orgId) }, data: { lockedUntil: soon } });
      expect((await pendingPost(jsonReq("http://localhost/api/billing/checkout-pending", { consentId }), ctx)).status).toBe(200);
      expect((await prisma.systemLock.findUniqueOrThrow({ where: { name: checkoutPendingLockName(orgId) } })).lockedUntil.getTime()).toBe(soon.getTime());
    });

    it("🚨 'ödeme başarısız' olayı kilidi ANINDA kaldırır (kurucu: ödeme alınamazsa beklemesin); başka işletmenin olayı dokunmaz", async () => {
      await pendingPost(jsonReq("http://localhost/api/billing/checkout-pending", { consentId }), ctx);
      const other = await prisma.organization.create({ data: { name: "Diğer" } });
      const foreign = await prisma.checkoutConsent.create({
        data: { organizationId: other.id, planCode: "pro", priceId: "pri_pro", legalVersion: "2026-06", ip: "1.2.3.4" },
        select: { id: true },
      });
      const failed = (cid: string) => {
        const id = `txn_${++n}`;
        txnStatus.set(id, "past_due"); // Paddle: işlem ÖDENMEMİŞ (gerçek başarısızlık)
        return { event_id: `evt_f_${n}`, event_type: "transaction.payment_failed", occurred_at: new Date().toISOString(), data: { id, status: "past_due", custom_data: { consentId: cid } } };
      };
      expect((await postEvent(failed(foreign.id))).status).toBe(200);
      expect(await prisma.systemLock.count({ where: { name: checkoutPendingLockName(orgId) } })).toBe(1);
      expect((await postEvent(failed(consentId))).status).toBe(200);
      expect(await prisma.systemLock.count({ where: { name: checkoutPendingLockName(orgId) } })).toBe(0);
      expect(await prisma.invoice.count()).toBe(0); // yalnız kilit kalkar, başka hiçbir şey yazılmaz
    });

    describe("Codex 11-04 P1 — sırasız gelen başarısızlık başarılı ödemenin korumasını kaldıramaz", () => {
      const failure = (cid: string | null, txnId: string | null) => ({
        event_id: `evt_ff_${++n}`,
        event_type: "transaction.payment_failed",
        occurred_at: new Date(Date.now() - 60_000).toISOString(),
        data: { ...(txnId ? { id: txnId } : {}), status: "past_due", custom_data: cid ? { consentId: cid } : {} },
      });
      const lockCount = () => prisma.systemLock.count({ where: { name: checkoutPendingLockName(orgId) } });
      const consentBlocked = async () => {
        const res = await consentPost(jsonReq("http://localhost/api/billing/consent", { planCode: "pro", priceId: "pri_pro" }), ctx);
        return res.status === 400 && (await res.json()).fields._ === CHECKOUT_PENDING_MESSAGE;
      };

      it("🚨 başarı sonrası ESKİ deneme başarısızlığı (Paddle işlemi ÖDENMİŞ gösteriyor) → kilit KALIR, ikinci ödeme ekranı açılmaz", async () => {
        await pendingPost(jsonReq("http://localhost/api/billing/checkout-pending", { consentId }), ctx);
        txnStatus.set("txn_paid1", "completed");
        expect((await postEvent(failure(consentId, "txn_paid1"))).status).toBe(200);
        expect(await lockCount()).toBe(1);
        expect(await consentBlocked()).toBe(true);
        txnStatus.set("txn_paid2", "paid");
        await postEvent(failure(consentId, "txn_paid2"));
        expect(await lockCount()).toBe(1);
      });

      it("🚨 aynı işletmenin BAŞKA ödemesinin (başka onay kaydı) başarısızlığı bu kilidi kaldırmaz", async () => {
        await pendingPost(jsonReq("http://localhost/api/billing/checkout-pending", { consentId }), ctx);
        const second = await prisma.checkoutConsent.create({
          data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "2026-06", ip: "1.2.3.4" },
          select: { id: true },
        });
        txnStatus.set("txn_other", "past_due");
        await postEvent(failure(second.id, "txn_other"));
        expect(await lockCount()).toBe(1);
        expect(await consentBlocked()).toBe(true);
      });

      it("🚨 Paddle okunamazsa (durum bilinmiyor) ya da olayda onay / işlem kimliği yoksa kilit KALIR (en çok 10 dk'da kendiliğinden düşer)", async () => {
        await pendingPost(jsonReq("http://localhost/api/billing/checkout-pending", { consentId }), ctx);
        await postEvent(failure(consentId, "txn_unknown")); // tabloda yok → null
        expect(await lockCount()).toBe(1);
        await postEvent(failure(null, "txn_x"));
        await postEvent(failure(consentId, null));
        expect(await lockCount()).toBe(1);
      });

      it("KONTROL (kurucu 10-10 kuralı): aynı ödemenin GERÇEK başarısızlığı (Paddle ödenmemiş) kilidi hâlâ ANINDA kaldırır", async () => {
        await pendingPost(jsonReq("http://localhost/api/billing/checkout-pending", { consentId }), ctx);
        txnStatus.set("txn_realfail", "past_due");
        await postEvent(failure(consentId, "txn_realfail"));
        expect(await lockCount()).toBe(0);
        expect(await consentBlocked()).toBe(false);
      });

      it("🚨 durum okunurken AYNI onay için taze kilit yazılırsa (ödeme o arada başarıyla bitti) taze kilit silinmez", async () => {
        await pendingPost(jsonReq("http://localhost/api/billing/checkout-pending", { consentId }), ctx);
        const { clearCheckoutPendingOnFailure } = await import("@/lib/billing/checkout-pending");
        const outcome = await clearCheckoutPendingOnFailure(
          orgId,
          { consentId, transactionId: "txn_race" },
          async () => {
            await prisma.systemLock.update({
              where: { name: checkoutPendingLockName(orgId) },
              data: { lockedUntil: new Date(Date.now() + CHECKOUT_PENDING_MS + 60_000) },
            });
            return "past_due";
          },
          (st) => st === "paid" || st === "completed",
        );
        expect(outcome).toBe("no_lock");
        expect(await lockCount()).toBe(1);
      });
    });

    it("🚨 abonelik AKTİF yazılınca kilit kalkar; aktif olmayan olay kaldırmaz", async () => {
      await pendingPost(jsonReq("http://localhost/api/billing/checkout-pending", { consentId }), ctx);
      await postEvent(subEvent("sub_A", "past_due"));
      expect(await prisma.systemLock.count({ where: { name: checkoutPendingLockName(orgId) } })).toBe(1);
      await postEvent(subEvent("sub_A", "active"));
      expect(await prisma.systemLock.count({ where: { name: checkoutPendingLockName(orgId) } })).toBe(0);
    });
  });
});
