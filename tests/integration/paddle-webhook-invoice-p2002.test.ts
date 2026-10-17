import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// FATURA P2002 DALI (tasarım belgesi 2026-10-10 §1.3 test eksiği 3) — GERÇEK POSTGRESQL.
// `applyTransactionEvent` önce hızlı yola bakar (`invoice.findFirst` — fatura varsa çık), sonra yazar; asıl hakem
// `Invoice @@unique([provider, providerRef])`. Başka bir teslim faturayı OKUMAMIZLA YAZMAMIZ ARASINDA yazarsa bizim `create`
// veritabanından P2002 alır ve `route.ts` catch'i onu yutar ("ilk yazan kazanır"). Bu dal hiç sınanmıyordu (P2002 testleri yalnız
// abonelik yolunda ve yapay hatayla). Burada hata YAPAY DEĞİL: rakip fatura gerçekten yazılı, hızlı yol "yok" der, Postgres'in kendi
// tekil dizini P2002 üretir. KONTROL: P2002 DIŞINDAKİ hata yutulmaz (500 → Paddle yeniden dener → fatura yazılır).
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
const deliver = (body: string) =>
  POST(
    new NextRequest("http://localhost/api/webhooks/paddle", {
      method: "POST",
      headers: { "content-type": "application/json", "paddle-signature": sign(body) },
      body,
    }),
  );
const routeFailures = () => reportErrorMock.mock.calls.filter(([context]) => context === "paddle-webhook");

describe("Paddle webhook — fatura yazımında P2002 (rakip teslim faturayı arada yazdı)", () => {
  let orgId = "";
  let consentId = "";
  const txnBody = (eventId: string, txnId: string, grandTotal: string) =>
    JSON.stringify({
      event_id: eventId,
      event_type: "transaction.completed",
      occurred_at: new Date().toISOString(),
      data: {
        id: txnId,
        status: "completed",
        custom_data: { consentId },
        currency_code: "TRY",
        details: { totals: { grand_total: grandTotal } },
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

  it("🚨 hızlı yol 'fatura yok' der ama rakip yazmış → GERÇEK P2002 yutulur: 200, olay işlendi, tek fatura, ilk yazanın tutarı kalır", async () => {
    // Rakip teslim (ör. aynı işlemin `transaction.paid` olayı, başka bir süreçte) faturayı az önce yazdı.
    const rival = await prisma.invoice.create({
      data: { organizationId: orgId, amountMinor: 89900, currency: "TRY", status: "paid", provider: "paddle", providerRef: "txn_race", paidAt: new Date() },
    });

    // Bizim okumamız rakipten ÖNCE yapılmış gibi: hızlı yol "yok" der. `create` gerçek veritabanına gider; hata kodu kaydedilir.
    let fastPathReads = 0;
    const createErrors: string[] = [];
    const realFind = prisma.invoice.findFirst;
    const realCreate = prisma.invoice.create;
    prisma.invoice.findFirst = (async () => {
      fastPathReads += 1;
      return null;
    }) as unknown as typeof realFind;
    prisma.invoice.create = (async (args: never) => {
      try {
        return await realCreate.call(prisma.invoice, args);
      } catch (err) {
        createErrors.push(err instanceof Prisma.PrismaClientKnownRequestError ? err.code : "other");
        throw err;
      }
    }) as unknown as typeof realCreate;

    // Gelen olay AYNI tutarı taşır (Opus 10-15 B13): bu test yalnız P2002 hakemini sınar. Aynı işlemde FARKLI tutar gerçek bir para
    // tutarsızlığıdır ve bekleyen kurucu sorusu Ödeme S1'e (U39) bağlıdır — bugünkü sessizliği "doğru" diye burada pinlemeyiz.
    const res = await deliver(txnBody("evt_race", "txn_race", "89900")).finally(() => {
      prisma.invoice.findFirst = realFind;
      prisma.invoice.create = realCreate;
    });

    expect(fastPathReads).toBe(1);
    expect(createErrors).toEqual(["P2002"]); // tekil dizin GERÇEKTEN devreye girdi (yapay hata yok)
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: "evt_race" } })).status).toBe("processed");
    const invoices = await prisma.invoice.findMany({ where: { provider: "paddle", providerRef: "txn_race" } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].id).toBe(rival.id);
    expect(invoices[0]).toEqual(rival); // kaybeden teslim satıra HİÇ yazmadı (ezme yok)
    expect(routeFailures()).toHaveLength(0); // P2002 bir arıza sayılmadı (500 / alarm yok)
  });

  it("KONTROL: P2002 DIŞINDAKİ yazım hatası YUTULMAZ → 500, olay 'error', fatura yok; Paddle'ın yeniden denemesi faturayı yazar", async () => {
    const body = txnBody("evt_dbdown", "txn_dbdown", "89900");
    const realCreate = prisma.invoice.create;
    prisma.invoice.create = (() => Promise.reject(new Error("db down"))) as unknown as typeof realCreate;
    const first = await deliver(body).finally(() => {
      prisma.invoice.create = realCreate;
    });

    expect(first.status).toBe(500); // geçici arıza → Paddle yeniden dener
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: "evt_dbdown" } })).status).toBe("error");
    expect(await prisma.invoice.count({ where: { providerRef: "txn_dbdown" } })).toBe(0);
    expect(routeFailures()).toHaveLength(1);

    const retry = await deliver(body);
    expect(retry.status).toBe(200);
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: "evt_dbdown" } })).status).toBe("processed");
    const invoices = await prisma.invoice.findMany({ where: { provider: "paddle", providerRef: "txn_dbdown" } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ organizationId: orgId, amountMinor: 89900, currency: "TRY", status: "paid" });
  });
});
