import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// ÖDEME S2 (kurucu 10-16; U42 ödeme tarafı) — gerçek PostgreSQL, BELİRLENİMCİ sıra.
// Nasıl yaşanır: müşteri dönem sonunda iptal olacak aboneliğini Paddle'da geri alıyor (aktif) ve aynı saniyelerde panelden hesabını
// siliyor. Webhook işletmeyi buldu, abonelik satırını okudu; tam o arada hesap silindi (abonelik kademeyle gitti) → güncelleme 0 satır.
// Eskiden olay "bayat" sayılıp ALARMSIZ ve "işlendi" olarak düşüyordu: hesap silinmiş, Paddle aboneliği canlı, bir sonraki dönem yine çekim.
// Doğru (kurucu): alarm HEMEN gelir · ödeme olayı kaybolmaz (incelenebilir, yeniden işlenebilir) · silinen hesap olay yüzünden geri AÇILMAZ.
// Prisma temsilcisine casus → AYRI dosya (CLAUDE.md: spy sonraki testlere sızar).
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

// Sıra kancası: webhook abonelik satırını OKUDUKTAN hemen sonra (yazmadan önce) çalışır — "silme tam o anda" penceresi.
let interleave: (() => Promise<void>) | null = null;
const realFindUnique = prisma.subscription.findUnique.bind(prisma.subscription);
vi.spyOn(prisma.subscription, "findUnique").mockImplementation((async (args: Parameters<typeof realFindUnique>[0]) => {
  const out = await realFindUnique(args);
  const hook = interleave;
  interleave = null;
  if (hook) await hook();
  return out;
}) as never);

function sign(body: string): string {
  const ts = Math.floor(Date.now() / 1000);
  return `ts=${ts};h1=${createHmac("sha256", SECRET).update(`${ts}:${body}`, "utf8").digest("hex")}`;
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
const renewal = (eventId: string, subId: string, status = "active") => ({
  event_id: eventId,
  event_type: "subscription.updated",
  occurred_at: new Date().toISOString(),
  data: { id: subId, status, customer_id: "ctm_1", items: [{ price: { id: "pri_pro" } }] },
});

describe("ödeme S2 — hesap silinirken ödeme olayı: alarm, olay kaybolmaz, hesap geri açılmaz", () => {
  let orgId = "";
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    interleave = null;
    reportErrorMock.mockResolvedValue({ notified: true, throttled: false, configured: true });
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
    orgId = (await prisma.organization.create({ data: { name: "Org" } })).id;
    await prisma.subscription.create({
      data: { organizationId: orgId, provider: "paddle", providerRef: "sub_live", status: "active", planCode: "pro", lastEventAt: new Date(Date.now() - 86_400_000) },
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 işletme bulundu → abonelik okundu → hesap SİLİNDİ → ödemeli olay: alarm + olay 'inceleme' + hesap geri açılmaz", async () => {
    interleave = async () => {
      await prisma.organization.delete({ where: { id: orgId } });
    };
    expect((await post(renewal("evt_race", "sub_live"))).status).toBe(200);
    expect(alarms()).toHaveLength(1); // ⬅️ ESKİDE 0 (0 satır güncelleme "bayat olay" sayılıyordu)
    const evt = await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: "evt_race" } });
    expect(evt.status).toBe("error"); // ⬅️ ESKİDE "processed" (yeniden işlenemezdi)
    expect(evt.error).toBe("needs_review: org_deleted");
    expect(evt.payloadJson).toContain("sub_live"); // ham olay saklı → incelenebilir
    expect(await prisma.organization.count({ where: { id: orgId } })).toBe(0); // geri açılmadı
    expect(await prisma.subscription.count()).toBe(0);
  });

  it("🚨 İLK ödeme olayı (abonelik satırı yok, işletme onaydan bulunur) + işletme arada silinir: yabancı anahtar yazmayı reddeder → 500 değil, alarm + inceleme, hesap açılmaz", async () => {
    await prisma.subscription.deleteMany({ where: { organizationId: orgId } });
    const consent = await prisma.checkoutConsent.create({
      data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "2026-06", ip: "1.2.3.4" },
      select: { id: true },
    });
    interleave = async () => {
      await prisma.organization.delete({ where: { id: orgId } });
    };
    const event = renewal("evt_first", "sub_first");
    (event.data as Record<string, unknown>).custom_data = { consentId: consent.id };
    const res = await post(event);
    expect(res.status).toBe(200); // ⬅️ ESKİDE yabancı anahtar hatası → 500 → Paddle'ın sonsuz yeniden denemesi
    expect(alarms()).toHaveLength(1);
    const evt = await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: "evt_first" } });
    expect(evt.status).toBe("error");
    expect(evt.error).toBe("needs_review: org_deleted");
    expect(await prisma.organization.count()).toBe(0);
    expect(await prisma.subscription.count()).toBe(0);
  });

  it("KONTROL: ödemesiz olay (iptal) arada silinmede alarm üretmez; olay işlendi sayılır (ödeme yok)", async () => {
    interleave = async () => {
      await prisma.organization.delete({ where: { id: orgId } });
    };
    expect((await post(renewal("evt_cancel", "sub_live", "canceled"))).status).toBe(200);
    expect(alarms()).toHaveLength(0);
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: "evt_cancel" } })).status).toBe("processed");
  });

  it("KONTROL: gerçekten BAYAT olay (işletme duruyor, daha taze olay yazılmış) bugünkü gibi sessiz düşer — alarm yok, işlendi", async () => {
    await prisma.subscription.update({ where: { organizationId: orgId }, data: { lastEventAt: new Date(Date.now() + 60_000) } });
    expect((await post(renewal("evt_stale", "sub_live"))).status).toBe(200);
    expect(alarms()).toHaveLength(0);
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: "evt_stale" } })).status).toBe("processed");
    expect(await prisma.organization.count({ where: { id: orgId } })).toBe(1);
  });

  it("işletme olay gelmeden ÖNCE silinmişse (kayıtlı abonelik de gitmiş): ödemeli olay alarm + inceleme, hiçbir şey yazılmaz", async () => {
    await prisma.organization.delete({ where: { id: orgId } });
    expect((await post(renewal("evt_after", "sub_live"))).status).toBe(200);
    expect(await prisma.subscription.count()).toBe(0);
    expect(await prisma.organization.count()).toBe(0);
    // İşletme (ve kayıtlı abonelik) yok → olay hiçbir işletmeye bağlanamaz: alarm + "inceleme" (yeniden işlenebilir) — ödeme kaybolmaz.
    const evt = await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: "evt_after" } });
    expect(evt.status).toBe("error");
    expect(evt.error).toBe("needs_review: unlinked");
    expect(alarms()).toHaveLength(1);
  });
});
