import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// PADDLE API ANAHTARI UYARISI (kurucu 10-17: canlı anahtar "süresiz" oluşturulmuştu, "sakın unutmayalım"): `api_key.expiring` /
// `api_key.expired` / `api_key.revoked` olayı operatöre uyarı olur. Anahtarın KENDİSİ ne uyarıya ne veritabanına yazılır (her `api_key.*`
// olayının saklanan gövdesi anahtarsız); olay İŞLENDİ sayılır, ödeme incelemesine düşmez (Haiku 10-17 gece 2. tur); kalıcı iz Operasyon
// Teşhisi satırı (`latestPaddleApiKeyAlert`, 90 gün); abonelik / fatura yazılmaz.
// ---------------------------------------------------------------------------

const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn() }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: reportErrorMock };
});

import { POST } from "@/app/api/webhooks/paddle/route";
import { latestPaddleApiKeyAlert, paymentReviewSummary } from "@/lib/billing/payment-review";
import { prisma, resetDb } from "../helpers/db";

const SECRET = "test-webhook-hmac-key-not-a-real-secret";
const FAKE_KEY = "pdl_live_apikey_01test_fakefakefakefake";

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
const keyEvent = (id: string, type: string, data: Record<string, unknown> = {}) => ({
  event_id: id,
  event_type: type,
  occurred_at: new Date().toISOString(),
  data: { id: "apikey_01", name: "Lixus canlı", key: FAKE_KEY, status: "active", expires_at: "2027-10-17T00:00:00Z", ...data },
});
const alarms = () => reportErrorMock.mock.calls.filter(([context]) => context === "paddle-api-key");

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  reportErrorMock.mockResolvedValue({ notified: true, throttled: false, configured: true });
  vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
});
afterEach(() => vi.unstubAllEnvs());

describe("Paddle webhook — API anahtarı uyarısı", () => {
  it.each([
    ["api_key.expiring", "süresi yakında doluyor"],
    ["api_key.expired", "süresi DOLDU"],
    ["api_key.revoked", "iptal edildi"],
  ])("🚨 %s → operatöre TEK uyarı (ad + bitiş tarihi), anahtarın kendisi YOK; olay işlendi", async (type, phrase) => {
    expect((await post(keyEvent(`evt_${type}`, type))).status).toBe(200);
    expect(alarms()).toHaveLength(1);
    const message = String((alarms()[0][1] as Error).message);
    expect(message).toContain(phrase);
    expect(message).toContain('"Lixus canlı"');
    expect(message).toContain("2027-10-17");
    expect(message).not.toContain(FAKE_KEY);
    expect(message).not.toMatch(/pdl_live/u);
    // İşlendi; ödeme incelemesine DÜŞMEZ (ödeme olayı değil); saklanan gövdede anahtar YOK.
    const row = await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: `evt_${type}` } });
    expect(row.status).toBe("processed");
    expect(row.error).toBeNull();
    expect(row.payloadJson).not.toContain(FAKE_KEY);
    expect(row.payloadJson).not.toMatch(/pdl_live/u);
    expect(JSON.parse(row.payloadJson ?? "{}")).toMatchObject({ event_type: type, data: { name: "Lixus canlı", expires_at: "2027-10-17T00:00:00Z" } });
    expect((await paymentReviewSummary()).total).toBe(0);
    // Kalıcı iz (Opus O18): Operasyon Teşhisi satırı — e-posta kısılsa da kaybolmaz.
    expect(await latestPaddleApiKeyAlert()).toMatchObject({ eventType: type, name: "Lixus canlı", expiresOn: "2027-10-17" });
    expect(await prisma.subscription.count()).toBe(0);
    expect(await prisma.invoice.count()).toBe(0);
  });

  it("adsız / bozuk tarihli olay da uyarır (ad '(adsız)', bitiş 'bilinmiyor'); aynı olayın yeniden gönderimi KOPYA (ikinci e-posta yok)", async () => {
    const ev = keyEvent("evt_x", "api_key.expiring", { name: "", expires_at: "not-a-date" });
    expect((await post(ev)).status).toBe(200);
    expect(String((alarms()[0][1] as Error).message)).toContain('"(adsız)" (bitiş bilinmiyor)');
    expect(await post(ev).then((r) => r.json())).toMatchObject({ duplicate: true });
    expect(alarms()).toHaveLength(1);
    expect(await latestPaddleApiKeyAlert()).toMatchObject({ name: "(adsız)", expiresOn: "bilinmiyor" });
  });

  it("her api_key.* olayı (uyarı türü olmayan api_key.created da) anahtarsız saklanır", async () => {
    expect((await post(keyEvent("evt_created", "api_key.created"))).status).toBe(200);
    const row = await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: "evt_created" } });
    expect(row.payloadJson).not.toContain(FAKE_KEY);
    // Uyarı türü değil → Operasyon Teşhisi satırı yok.
    expect(await latestPaddleApiKeyAlert()).toBeNull();
  });

  it("Operasyon Teşhisi satırı: en yeni uyarı; 90 günden eski uyarı görünmez", async () => {
    expect((await post(keyEvent("evt_old", "api_key.expiring", { name: "eski" }))).status).toBe(200);
    expect((await post(keyEvent("evt_new", "api_key.expired", { name: "yeni" }))).status).toBe(200);
    await prisma.webhookEvent.update({ where: { providerEventId: "evt_old" }, data: { createdAt: new Date(Date.now() - 60_000) } });
    expect(await latestPaddleApiKeyAlert()).toMatchObject({ eventType: "api_key.expired", name: "yeni" });
    await prisma.webhookEvent.updateMany({ data: { createdAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) } });
    expect(await latestPaddleApiKeyAlert()).toBeNull();
  });

  it("KONTROL: başka olay türleri (api_key.created, subscription) bu uyarıyı TETİKLEMEZ", async () => {
    expect((await post(keyEvent("evt_c", "api_key.created"))).status).toBe(200);
    expect((await post({ event_id: "evt_s", event_type: "subscription.updated", occurred_at: new Date().toISOString(), data: { id: "sub_1", status: "active" } })).status).toBe(200);
    expect(alarms()).toHaveLength(0);
  });

  it("uyarı gönderilemese de (rapor fırlatır) 200 döner (Paddle sonsuz yeniden denemesin); Operasyon Teşhisi satırı kalır", async () => {
    reportErrorMock.mockRejectedValueOnce(new Error("smtp down"));
    expect((await post(keyEvent("evt_f", "api_key.expired"))).status).toBe(200);
    expect(await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: "evt_f" } })).toMatchObject({ status: "processed" });
    expect(await latestPaddleApiKeyAlert()).toMatchObject({ eventType: "api_key.expired" });
  });
});
