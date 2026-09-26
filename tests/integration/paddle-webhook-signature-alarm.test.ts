import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// GEÇERSİZ WEBHOOK İMZASI ARTIK SESSİZ DEĞİL (08-09 (2))
//
// 🚨 ASİMETRİ TERSTİ: EKSİK anahtar dalı (`paddle-webhook-dormant`) alarm
// veriyordu, YANLIŞ anahtar dalı vermiyordu — oysa ikincisi daha sinsi.
// `PADDLE_WEBHOOK_SECRET` bir rotasyon/yazım hatasıyla yanlışsa her olay 401
// alır, Paddle SONLU sayıda yeniden dener ve pes eder → olay KALICI kaybolur.
// İki yönde de sessiz sonuç: iptal olmuş bir org sonsuza kadar premium kalır,
// ödeyen müşterinin yükseltmesi `planCode`'a hiç ulaşmaz.
//
// ⚠️ KABUL/RET KARARI DEĞİŞMEDİ. `verifyPaddleSignature`e dokunulmadı; eklenen
// tek şey GÖRÜNÜRLÜK. 401 hâlâ 401.
// ---------------------------------------------------------------------------

const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn() }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: reportErrorMock };
});

import { POST } from "@/app/api/webhooks/paddle/route";
import { prisma, resetDb } from "../helpers/db";

const SECRET = "test-webhook-hmac-key-not-a-real-secret";
const BODY = JSON.stringify({ event_id: "evt_x", event_type: "subscription.activated", data: {} });

const req = (header: string | null, body = BODY) =>
  new NextRequest("http://localhost/api/webhooks/paddle", {
    method: "POST",
    headers: header
      ? { "content-type": "application/json", "paddle-signature": header }
      : { "content-type": "application/json" },
    body,
  });

/** Şekli GERÇEK bir teslimat gibi ama BAŞKA anahtarla imzalanmış başlık. */
function signWith(secret: string, body = BODY): string {
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac("sha256", secret).update(`${ts}:${body}`, "utf8").digest("hex");
  return `ts=${ts};h1=${h1}`;
}

describe("Paddle webhook — imza uyuşmazlığı alarmı", () => {
  beforeEach(async () => {
    // Alarm durumu artık DB'de (`alert-state`, 09-23) → testler arası sızmasın.
    await resetDb();
    vi.clearAllMocks();
    reportErrorMock.mockResolvedValue({ notified: true, throttled: false, configured: true });
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 ŞEKLİ DOĞRU ama BAŞKA anahtarla imzalı teslimat → 401 + ALARM", async () => {
    // Canlıdaki tam senaryo: Paddle doğru gönderiyor, bizim env'deki anahtar yanlış.
    const res = await POST(req(signWith("bambaska-anahtar")));

    expect(res.status).toBe(401); // kabul/ret kararı DEĞİŞMEDİ
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(reportErrorMock.mock.calls[0][0]).toBe("paddle-webhook-signature-mismatch");
  });

  it("🚨 ALARMA HAM GÖVDE GİRMEZ — payload müşteri adı/e-postası/adresi taşır", async () => {
    const pii = JSON.stringify({
      event_id: "evt_pii",
      event_type: "subscription.activated",
      data: { customer: { email: "musteri@example.com", name: "Zeynep Kara" } },
    });
    await POST(req(signWith("bambaska-anahtar", pii), pii));

    const [ctx, err] = reportErrorMock.mock.calls[0];
    const wire = `${ctx} ${(err as Error).message}`;
    expect(wire).not.toContain("musteri@example.com");
    expect(wire).not.toContain("Zeynep Kara");
  });

  it("sıradan internet taraması alarm ÜRETMEZ (kanal çöpe dönmesin)", async () => {
    // Kimliksiz, halka açık uç nokta. Her 404 tarayıcısına alarm yazmak, alarmın
    // sinyal değerini yok ederdi — bu deponun tekrar tekrar ödediği ders.
    for (const header of [null, "", "garbage", "ts=123;h1=deadbeef", "h1=" + "a".repeat(64)]) {
      await POST(req(header));
    }
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it("KONTROL: GEÇERLİ imza ne 401 verir ne alarm yazar", async () => {
    // Bu olmadan "her istekte alarm" ve "her isteği 401'le" mutasyonları da
    // yeşil geçerdi.
    const res = await POST(req(signWith(SECRET)));
    expect(res.status).not.toBe(401);
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it("🚨 GEÇİŞ TABANLI (09-23): aynı uyuşmazlık 25 kez gelse de TEK alarm (saldırgan kutuyu dolduramaz)", async () => {
    for (let i = 0; i < 25; i++) {
      const res = await POST(req(signWith("bambaska-anahtar")));
      expect(res.status).toBe(401); // kabul/ret kararı her istekte AYNI
    }
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
  });

  it("DOĞRULANMIŞ bir olay durumu temizler → sonraki bozulma YENİDEN ve hemen bildirilir", async () => {
    await POST(req(signWith("bambaska-anahtar")));
    await POST(req(signWith("bambaska-anahtar")));
    expect(reportErrorMock).toHaveBeenCalledTimes(1);

    const ok = await POST(req(signWith(SECRET)));
    expect(ok.status).not.toBe(401);
    expect(await prisma.systemLock.count({ where: { name: { startsWith: "alert-state:paddle-webhook:" } } })).toBe(0);

    await POST(req(signWith("bambaska-anahtar")));
    expect(reportErrorMock).toHaveBeenCalledTimes(2);
  });

  it("EKSİK anahtar (dormant) da geçiş tabanlı: 10 olayda TEK alarm, 200 davranışı aynı", async () => {
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", "");
    for (let i = 0; i < 10; i++) {
      const res = await POST(req(null));
      expect(res.status).toBe(200);
    }
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(reportErrorMock.mock.calls[0][0]).toBe("paddle-webhook-dormant");
  });
});
