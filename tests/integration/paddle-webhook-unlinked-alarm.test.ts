import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// BAĞLANAMAYAN ÖDEME SESSİZ KALMAZ (15 ajan A10 F1, 10-01): imzası doğru bir ödeme olayı hiçbir işletmeye bağlanamayınca (onay yok /
// 24 saatten eski / bilinmiyor) olay "işlendi" sayılıp düşüyordu ve kimse bilmiyordu — müşteri ödüyor, hesap denemede kalıyor.
// Bağlama kararı ve satır durumu AYNEN; eklenen yalnız operatör alarmı (Paddle kimliğiyle anahtarlı, geçiş tabanlı).
// ---------------------------------------------------------------------------

const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn() }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: reportErrorMock };
});

import { POST } from "@/app/api/webhooks/paddle/route";
import { prisma, resetDb } from "../helpers/db";

const SECRET = "test-webhook-hmac-key-not-a-real-secret";
const CONTEXT = "paddle-webhook-unlinked-payment";

function sign(body: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac("sha256", SECRET).update(`${ts}:${body}`, "utf8").digest("hex");
  return `ts=${ts};h1=${h1}`;
}
const post = (event: Record<string, unknown>) => {
  const body = JSON.stringify(event);
  return POST(
    new NextRequest("http://localhost/api/webhooks/paddle", {
      method: "POST",
      headers: { "content-type": "application/json", "paddle-signature": sign(body) },
      body,
    }),
  );
};
const alarms = () => reportErrorMock.mock.calls.filter(([context]) => context === CONTEXT);
const state = (id: string) => prisma.systemLock.count({ where: { name: `alert-state:paddle-webhook:unlinked:${id}` } });

describe("Paddle webhook — bağlanamayan ödeme alarmı", () => {
  let orgId = "";
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    reportErrorMock.mockResolvedValue({ notified: true, throttled: false, configured: true });
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
    orgId = (await prisma.organization.create({ data: { name: "Org" } })).id;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 eski onaylı (24 saati aşmış) ÖDEMELİ abonelik: bağlanmaz (karar aynı) ama operatöre TEK alarm; aynı abonelik yinelenince yeni e-posta yok", async () => {
    const consent = await prisma.checkoutConsent.create({
      data: {
        organizationId: orgId,
        planCode: "pro",
        priceId: "pri_pro",
        legalVersion: "2026-06",
        ip: "1.2.3.4",
        createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      },
      select: { id: true },
    });
    const event = (eventId: string) => ({
      event_id: eventId,
      event_type: "subscription.activated",
      occurred_at: new Date(Date.now() - 60_000).toISOString(),
      data: {
        id: "sub_stale",
        status: "active",
        customer_id: "ctm_01",
        custom_data: { consentId: consent.id },
        items: [{ price: { id: "pri_pro" } }],
      },
    });
    expect((await post(event("evt_1"))).status).toBe(200);
    expect(await prisma.subscription.count()).toBe(0); // bağlama kararı aynı
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: "evt_1" } })).status).toBe("processed");
    expect(alarms()).toHaveLength(1);
    const msg = String((alarms()[0][1] as Error).message);
    expect(msg).toContain("sub_stale");
    expect(msg).toContain("ctm_01");
    expect(await state("sub_stale")).toBe(1);

    expect((await post(event("evt_2"))).status).toBe(200);
    expect(alarms()).toHaveLength(1);
  });

  it("🚨 onaysız tamamlanmış İŞLEM (transaction.completed): fatura yazılmaz, operatöre alarm", async () => {
    const res = await post({
      event_id: "evt_tx",
      event_type: "transaction.completed",
      occurred_at: new Date().toISOString(),
      data: { id: "txn_orphan", status: "completed", currency_code: "TRY", details: { totals: { grand_total: "89900" } } },
    });
    expect(res.status).toBe(200);
    expect(await prisma.invoice.count()).toBe(0);
    expect(alarms()).toHaveLength(1);
    expect(await state("txn_orphan")).toBe(1);
  });

  it("KONTROL: ödemesiz durumdaki bilinmeyen abonelik (iptal) alarm üretmez", async () => {
    await post({
      event_id: "evt_c",
      event_type: "subscription.canceled",
      occurred_at: new Date().toISOString(),
      data: { id: "sub_unknown", status: "canceled", items: [{ price: { id: "pri_pro" } }] },
    });
    expect(alarms()).toHaveLength(0);
  });

  it("KONTROL: taze onayla bağlanan ödemeli abonelik alarm üretmez", async () => {
    const consent = await prisma.checkoutConsent.create({
      data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "2026-06", ip: "1.2.3.4" },
      select: { id: true },
    });
    await post({
      event_id: "evt_ok",
      event_type: "subscription.activated",
      occurred_at: new Date().toISOString(),
      data: { id: "sub_ok", status: "active", custom_data: { consentId: consent.id }, items: [{ price: { id: "pri_pro" } }] },
    });
    expect(await prisma.subscription.count({ where: { organizationId: orgId } })).toBe(1);
    expect(alarms()).toHaveLength(0);
  });
});
