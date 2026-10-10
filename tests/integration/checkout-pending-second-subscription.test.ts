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
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: reportErrorMock };
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

    it("KONTROL: aynı aboneliğin olayı (yenileme) ve aktif OLMAYAN farklı abonelik alarm üretmez", async () => {
      await seedSub("sub_A", "active");
      await postEvent(subEvent("sub_A", "active"));
      await postEvent(subEvent("sub_C", "past_due"));
      expect(alarms()).toHaveLength(0);
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

    it("🚨 abonelik AKTİF yazılınca kilit kalkar; aktif olmayan olay kaldırmaz", async () => {
      await pendingPost(jsonReq("http://localhost/api/billing/checkout-pending", { consentId }), ctx);
      await postEvent(subEvent("sub_A", "past_due"));
      expect(await prisma.systemLock.count({ where: { name: checkoutPendingLockName(orgId) } })).toBe(1);
      await postEvent(subEvent("sub_A", "active"));
      expect(await prisma.systemLock.count({ where: { name: checkoutPendingLockName(orgId) } })).toBe(0);
    });
  });
});
