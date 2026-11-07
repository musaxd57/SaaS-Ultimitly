import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// AYNI event_id'NİN EŞZAMANLI İKİ TESLİMİ (tasarım belgesi 2026-10-10 §1.3 test eksiği 1) — GERÇEK POSTGRESQL.
// Paddle aynı olayı yeniden dener; iki teslim aynı anda gelebilir (yanıtımız gecikti → Paddle zaman aşımıyla yeniden yolladı, ya da iki
// bildirim hedefi). Rotanın "işlendi mi" okuması (`route.ts` webhookEvent.findUnique) yalnız HIZLI YOLDUR; yarışta iki teslim de onu
// geçebilir. O zaman tekliği veritabanı hakemleri sağlamalı: olay satırı `upsert` (providerEventId tekil), abonelik `create` → P2002 →
// korumalı güncelleme yedeği, fatura `create` → P2002 → ilk yazan kazanır.
// Yarış BULUŞMA NOKTASIYLA birebir üretilir: iki teslim de gerçek okumayı yapar, ikisi de gelmeden hiçbiri ilerlemez → ikisi de "satır
// yok" görür (rastgele zamanlamaya bırakılmaz). Prisma temsilcisi elle değiştirilir ve `finally`de geri konur (paddle-webhook.test.ts
// deseni; vi.spyOn geri alınsa da sızıyordu — CLAUDE.md). Bu yüzden AYRI dosya.
// ---------------------------------------------------------------------------

const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn() }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: reportErrorMock };
});

import { POST } from "@/app/api/webhooks/paddle/route";
import { prisma, resetDb } from "../helpers/db";

const SECRET = "test-webhook-hmac-key-not-a-real-secret";

function sign(body: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac("sha256", SECRET).update(`${ts}:${body}`, "utf8").digest("hex");
  return `ts=${ts};h1=${h1}`;
}
const deliver = (body: string) =>
  POST(
    new NextRequest("http://localhost/api/webhooks/paddle", {
      method: "POST",
      headers: { "content-type": "application/json", "paddle-signature": sign(body) },
      body,
    }),
  );
const routeFailures = () => reportErrorMock.mock.calls.filter(([context]) => context === "paddle-webhook");

/**
 * İki teslimi aynı noktada buluşturur: ikisi de gelene kadar bekler. Biri hiç gelmezse `timeoutMs` sonra yine açılır (test takılmaz;
 * `arrivals()` iddiası kırmızı olur — yarışın gerçekten yaşandığının kanıtı).
 */
function meetingPoint(timeoutMs = 2_000) {
  let arrived = 0;
  let openGate: () => void = () => {};
  const bothArrived = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  return {
    arrivals: () => arrived,
    async wait(): Promise<void> {
      arrived += 1;
      if (arrived === 2) openGate();
      await Promise.race([bothArrived, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref?.())]);
    },
  };
}

describe("Paddle webhook — aynı event_id eşzamanlı iki kez gelir", () => {
  let orgId = "";
  let consentId = "";

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    reportErrorMock.mockResolvedValue({ notified: true, throttled: false, configured: true });
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
    orgId = (await prisma.organization.create({ data: { name: "Org" } })).id;
    consentId = (
      await prisma.checkoutConsent.create({
        data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "2026-06", ip: "1.2.3.4" },
        select: { id: true },
      })
    ).id;
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 abonelik olayı: iki teslim de 'işlendi mi' okumasını ve abonelik okumasını geçer → tek olay satırı, tek abonelik, iki 200, rota hatası yok", async () => {
    const body = JSON.stringify({
      event_id: "evt_cc_sub",
      event_type: "subscription.activated",
      occurred_at: new Date().toISOString(),
      data: {
        id: "sub_cc",
        status: "active",
        customer_id: "ctm_cc",
        custom_data: { consentId },
        items: [{ price: { id: "pri_pro" } }],
      },
    });

    const eventGate = meetingPoint();
    const subGate = meetingPoint();
    const realEventFind = prisma.webhookEvent.findUnique;
    const realSubFind = prisma.subscription.findUnique;
    prisma.webhookEvent.findUnique = (async (args: never) => {
      const row = await realEventFind.call(prisma.webhookEvent, args);
      await eventGate.wait();
      return row;
    }) as unknown as typeof realEventFind;
    prisma.subscription.findUnique = (async (args: never) => {
      const row = await realSubFind.call(prisma.subscription, args);
      await subGate.wait();
      return row;
    }) as unknown as typeof realSubFind;

    const responses = await Promise.all([deliver(body), deliver(body)]).finally(() => {
      prisma.webhookEvent.findUnique = realEventFind;
      prisma.subscription.findUnique = realSubFind;
    });

    // Yarış GERÇEKTEN yaşandı: iki teslim de iki okumayı yaptı ve hiçbiri "zaten işlendi" erken dönüşüne düşmedi.
    expect(eventGate.arrivals()).toBe(2);
    expect(subGate.arrivals()).toBe(2);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(await Promise.all(responses.map((r) => r.json()))).toEqual([{ ok: true }, { ok: true }]);

    // Veritabanı hakemleri: tek olay satırı (işlendi), tek abonelik (ikinci create P2002 → korumalı güncelleme yedeği).
    const events = await prisma.webhookEvent.findMany({ where: { providerEventId: "evt_cc_sub" } });
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("processed");
    const subs = await prisma.subscription.findMany({ where: { organizationId: orgId } });
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ status: "active", planCode: "pro", provider: "paddle", providerRef: "sub_cc", customerId: "ctm_cc" });
    expect(routeFailures()).toHaveLength(0); // 500 / "error" dalına hiç düşülmedi

    // Paddle'ın SONRAKİ (sıralı) yeniden denemesi artık hızlı yoldan döner.
    expect(await (await deliver(body)).json()).toEqual({ ok: true, duplicate: true });
    expect(await prisma.webhookEvent.count({ where: { providerEventId: "evt_cc_sub" } })).toBe(1);
  }, 15_000);

  it("🚨 işlem olayı: iki teslim de 'işlendi mi' ve 'fatura var mı' okumalarını geçer → tek fatura (ikinci create P2002 yutulur), iki 200", async () => {
    const body = JSON.stringify({
      event_id: "evt_cc_txn",
      event_type: "transaction.completed",
      occurred_at: new Date().toISOString(),
      data: {
        id: "txn_cc",
        status: "completed",
        custom_data: { consentId },
        currency_code: "TRY",
        details: { totals: { grand_total: "89900" } },
      },
    });

    const eventGate = meetingPoint();
    const invoiceGate = meetingPoint();
    const realEventFind = prisma.webhookEvent.findUnique;
    const realInvoiceFind = prisma.invoice.findFirst;
    prisma.webhookEvent.findUnique = (async (args: never) => {
      const row = await realEventFind.call(prisma.webhookEvent, args);
      await eventGate.wait();
      return row;
    }) as unknown as typeof realEventFind;
    prisma.invoice.findFirst = (async (args: never) => {
      const row = await realInvoiceFind.call(prisma.invoice, args);
      await invoiceGate.wait();
      return row;
    }) as unknown as typeof realInvoiceFind;

    const responses = await Promise.all([deliver(body), deliver(body)]).finally(() => {
      prisma.webhookEvent.findUnique = realEventFind;
      prisma.invoice.findFirst = realInvoiceFind;
    });

    expect(eventGate.arrivals()).toBe(2);
    expect(invoiceGate.arrivals()).toBe(2); // ikisi de "fatura yok" gördü → ikisi de create denedi
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(await Promise.all(responses.map((r) => r.json()))).toEqual([{ ok: true }, { ok: true }]);

    const invoices = await prisma.invoice.findMany({ where: { provider: "paddle", providerRef: "txn_cc" } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ organizationId: orgId, amountMinor: 89900, currency: "TRY", status: "paid" });
    const events = await prisma.webhookEvent.findMany({ where: { providerEventId: "evt_cc_txn" } });
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("processed");
    expect(routeFailures()).toHaveLength(0);
  }, 15_000);
});
