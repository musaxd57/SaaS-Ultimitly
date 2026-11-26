import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// AYNI İŞLEMİN İKİ FARKLI event_id'Sİ (tasarım belgesi 2026-10-10 §1.3 test eksiği 2) — GERÇEK POSTGRESQL.
// Paddle bir ödeme için İKİ ayrı olay yollar: `transaction.paid` (tahsil edildi) ve `transaction.completed` (işlendi). İkisi de aynı
// işlem kimliğini (txn_…) taşır ama event_id'leri FARKLIDIR → olay tekilleştirmesi (WebhookEvent.providerEventId) onları ayırmaz. Rota
// ikisini de fatura yoluna sokar (`route.ts` "transaction.completed" || "transaction.paid"); tek fatura kalmasının tek sebebi işlem
// kimliğiyle tekilleştirmedir: hızlı yol `invoice.findFirst` + gerçek hakem `Invoice @@unique([provider, providerRef])` → P2002 yutulur.
// Sıralı vaka hızlı yolu, eşzamanlı vaka (buluşma noktası) hakemi sınar; KONTROL: farklı işlemler (yenileme) birleştirilmez.
// Prisma temsilcisi elle değiştirilir ve `finally`de geri konur → AYRI dosya.
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
const routeFailures = () => reportErrorMock.mock.calls.filter(([context]) => context === "paddle-webhook");

/** İki teslimi aynı noktada buluşturur (biri gelmezse `timeoutMs` sonra açılır; `arrivals()` iddiası kırmızı olur). */
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

describe("Paddle webhook — aynı işlem iki farklı olayla gelir (transaction.paid + transaction.completed)", () => {
  let orgId = "";
  let consentId = "";

  /** Aynı Paddle işleminin bir olayı: `eventType` ve `eventId` değişir, işlem kimliği ve tutar aynı. */
  const txnEvent = (eventId: string, eventType: "transaction.paid" | "transaction.completed", txnId: string) => ({
    event_id: eventId,
    event_type: eventType,
    occurred_at: new Date().toISOString(),
    data: {
      id: txnId,
      status: eventType === "transaction.paid" ? "paid" : "completed",
      custom_data: { consentId },
      currency_code: "TRY",
      details: { totals: { grand_total: "89900" } },
    },
  });

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

  it("🚨 sıralı: transaction.paid faturayı yazar; aynı işlemin transaction.completed olayı İKİNCİ fatura yazmaz (iki olay satırı, tek fatura)", async () => {
    expect((await post(txnEvent("evt_paid", "transaction.paid", "txn_two"))).status).toBe(200);
    // `transaction.paid` TEK BAŞINA fatura yazar (yalnız "completed"ı dinleyen bir değişiklik bunu kırar).
    const first = await prisma.invoice.findMany({ where: { provider: "paddle", providerRef: "txn_two" } });
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ organizationId: orgId, amountMinor: 89900, currency: "TRY", status: "paid" });

    const res = await post(txnEvent("evt_completed", "transaction.completed", "txn_two"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true }); // farklı event_id → "duplicate" DEĞİL; işlendi ama fatura eklemedi

    const after = await prisma.invoice.findMany({ where: { provider: "paddle", providerRef: "txn_two" } });
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(first[0].id); // ilk yazılan fatura aynen duruyor
    const events = await prisma.webhookEvent.findMany({
      where: { providerEventId: { in: ["evt_paid", "evt_completed"] } },
      select: { status: true },
    });
    expect(events.map((e) => e.status)).toEqual(["processed", "processed"]);
    expect(routeFailures()).toHaveLength(0);
  });

  it("🚨 eşzamanlı: iki olay da 'fatura var mı' okumasını geçer → tek fatura (P2002 yutulur), iki 200, iki olay da işlendi", async () => {
    const gate = meetingPoint();
    const realInvoiceFind = prisma.invoice.findFirst;
    prisma.invoice.findFirst = (async (args: never) => {
      const row = await realInvoiceFind.call(prisma.invoice, args);
      await gate.wait();
      return row;
    }) as unknown as typeof realInvoiceFind;

    const responses = await Promise.all([
      post(txnEvent("evt_paid_cc", "transaction.paid", "txn_two_cc")),
      post(txnEvent("evt_completed_cc", "transaction.completed", "txn_two_cc")),
    ]).finally(() => {
      prisma.invoice.findFirst = realInvoiceFind;
    });

    expect(gate.arrivals()).toBe(2); // ikisi de "fatura yok" gördü → ikisi de create denedi
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(await prisma.invoice.count({ where: { provider: "paddle", providerRef: "txn_two_cc" } })).toBe(1);
    const events = await prisma.webhookEvent.findMany({
      where: { providerEventId: { in: ["evt_paid_cc", "evt_completed_cc"] } },
      select: { status: true },
    });
    expect(events.map((e) => e.status)).toEqual(["processed", "processed"]);
    expect(routeFailures()).toHaveLength(0);
  }, 15_000);

  it("KONTROL: FARKLI işlemler (aynı aboneliğin iki yenilemesi, onaysız — abonelik kimliğiyle bağlanır) birleştirilmez → iki fatura", async () => {
    const sub = await prisma.subscription.create({
      data: { organizationId: orgId, planCode: "pro", status: "active", provider: "paddle", providerRef: "sub_ren" },
    });
    const renewal = (eventId: string, txnId: string) => ({
      event_id: eventId,
      event_type: "transaction.completed",
      occurred_at: new Date().toISOString(),
      // Yenileme işleminde taze onay YOK: işletme `subscription_id` → kayıtlı abonelik (`orgFromProviderRef`) ile bulunur.
      data: { id: txnId, status: "completed", subscription_id: "sub_ren", currency_code: "TRY", details: { totals: { grand_total: "89900" } } },
    });
    expect((await post(renewal("evt_ren_1", "txn_ren_1"))).status).toBe(200);
    expect((await post(renewal("evt_ren_2", "txn_ren_2"))).status).toBe(200);

    const invoices = await prisma.invoice.findMany({ where: { organizationId: orgId }, orderBy: { providerRef: "asc" } });
    expect(invoices.map((i) => i.providerRef)).toEqual(["txn_ren_1", "txn_ren_2"]);
    for (const inv of invoices) expect(inv).toMatchObject({ subscriptionId: sub.id, amountMinor: 89900, status: "paid" });
    expect(routeFailures()).toHaveLength(0);
  });
});
