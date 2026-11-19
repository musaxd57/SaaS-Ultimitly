import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { signPaddleWebhook } from "@/lib/payments/paddle";

// ---------------------------------------------------------------------------
// ÖDEME BİLDİRİMİNDE SAKLANAMAYAN KARAKTER (G2 tur 1 E1, 11-19; A-1 / G2 B4 sınıfının ödeme kolu). `custom_data` ödeme ekranını açan
// tarayıcıda kurulur (sunucu işlemi yokken) — `consentId` dizesine NUL ya da EŞSİZ vekil konabilir; Paddle bunu JSON kaçışıyla imzalı
// gövdeye koyar. Gövde çözümlendikten sonra bu dize onay kaydı sorgusuna gidiyordu → PostgreSQL / Prisma sorgu hatası → olay HER
// teslimatta 500 + ortak "paddle-webhook" uyarı kovası (imzalı, yeniden denenen olay — alarm seli ve ödeme hiç işlenmez).
// Kural (A-1 ile AYNI, `lib/storable-text.ts`): imza HAM gövdede doğrulanır; doğrulamadan SONRA çözümlemede dize DEĞERİNDEN bu karakterler
// sessizce silinir. Saklanan ham gövde değişmez.
// ---------------------------------------------------------------------------

const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn() }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: reportErrorMock };
});

import { POST } from "@/app/api/webhooks/paddle/route";
import { prisma, resetDb } from "../helpers/db";

const SECRET = "test-webhook-hmac-key-not-a-real-secret";
const NUL = String.fromCharCode(0);
const LONE_HIGH = String.fromCharCode(0xd800);

/** İmzalı teslimat (imza `signedBody` üzerinde; verilmezse gönderilen gövdenin kendisi). */
const deliver = (body: string, signedBody: string = body) =>
  POST(
    new NextRequest("http://localhost/api/webhooks/paddle", {
      method: "POST",
      headers: { "content-type": "application/json", "paddle-signature": signPaddleWebhook(signedBody, SECRET, Math.floor(Date.now() / 1000)) },
      body,
    }),
  );
const activated = (eventId: string, customData: Record<string, unknown>) =>
  JSON.stringify({
    event_id: eventId,
    event_type: "subscription.activated",
    occurred_at: new Date(Date.now() - 60_000).toISOString(),
    data: { id: `sub_${eventId}`, status: "active", customer_id: "ctm_01", custom_data: customData, items: [{ price: { id: "pri_pro" } }] },
  });
const webhookAlarms = () => reportErrorMock.mock.calls.filter(([context]) => context === "paddle-webhook");

describe("Paddle bildirimi — saklanamayan karakter (G2 E1)", () => {
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

  for (const [label, bad] of [
    ["NUL", NUL],
    ["eşsiz vekil", LONE_HIGH],
  ] as const) {
    it(`🚨 consentId içinde ${label} → 500 / uyarı kovası YOK; karakter silinir, ödeme işletmeye bağlanır, ham gövde aynen saklanır`, async () => {
      const body = activated("evt_bad", { consentId: `${consentId}${bad}` });
      const res = await deliver(body);
      expect(res.status).toBe(200);
      expect(webhookAlarms()).toEqual([]);
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });
      expect(sub).toMatchObject({ status: "active", providerRef: "sub_evt_bad", planCode: "pro" });
      const row = await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: "evt_bad" } });
      expect(row.status).toBe("processed");
      expect(row.payloadJson).toBe(body);
    });
  }

  it("🚨 imza HAM gövdede doğrulanır: imza temizlenmiş gövdeye atılmışsa NUL'lu teslimat 401, hiçbir şey yazılmaz", async () => {
    const raw = activated("evt_sig", { consentId: `${consentId}${NUL}` });
    const cleaned = activated("evt_sig", { consentId });
    expect(raw).not.toBe(cleaned);
    const res = await deliver(raw, cleaned);
    expect(res.status).toBe(401);
    expect(await prisma.webhookEvent.count()).toBe(0);
    expect(await prisma.subscription.count()).toBe(0);
  });

  it("KONTROL: custom_data ANAHTARINDA NUL olayı düşürmez (anahtar hiçbir sorguya gitmez) — olay işlenir, ödeme bağlanır", async () => {
    const res = await deliver(activated("evt_key", { consentId, [`x${NUL}y`]: "1" }));
    expect(res.status).toBe(200);
    expect(webhookAlarms()).toEqual([]);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } })).providerRef).toBe("sub_evt_key");
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: "evt_key" } })).status).toBe("processed");
  });

  it("KONTROL: temiz olay bugünkü gibi işlenir (emoji gibi geçerli vekil çifti korunur)", async () => {
    const res = await deliver(activated("evt_ok", { consentId, note: "teşekkürler 🙂" }));
    expect(res.status).toBe(200);
    expect(webhookAlarms()).toEqual([]);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } })).providerRef).toBe("sub_evt_ok");
  });
});
