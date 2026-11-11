import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// S7 — BAĞLANTI: işlenememiş Paddle olayının yeniden işlenmesi ZAMANLANMIŞ İŞE bağlı mı ("yüklem var, argüman yok" sınıfı: yeniden işleme
// fonksiyonu doğru çalışsa da saatlik iş onu çağırmıyorsa hiçbir olay kurtarılmaz). Gerçek zamanlanmış iş + gerçek webhook işleyicisi.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable", () => ({
  isHospitableConfigured: () => true,
  listProperties: vi.fn().mockResolvedValue([]),
  listReservations: vi.fn().mockResolvedValue([]),
  listMessages: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })),
}));

import { runScheduledSync } from "@/lib/scheduled-sync";

const SECRET = "test-webhook-hmac-key-not-a-real-secret";
const MIN = 60_000;

describe("runScheduledSync × bekleyen Paddle olayı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("🚨 saatlik iş, 'hata'da kalmış abonelik olayını aynı işleyiciden yeniden geçirir: abonelik güncellenir, olay 'işlendi' olur", async () => {
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await prisma.subscription.create({ data: { organizationId: org.id, planCode: "pro", status: "active", provider: "paddle", providerRef: "sub_A" } });
    // İşleme sırasında geçici bir veritabanı hatası olmuş; Paddle da yeniden göndermeyi bırakmış.
    const event = {
      event_id: "evt_stuck_1",
      event_type: "subscription.updated",
      occurred_at: new Date(Date.now() - 20 * MIN).toISOString(),
      data: { id: "sub_A", status: "past_due", customer_id: "ctm_1", items: [{ price: { id: "pri_pro" } }] },
    };
    await prisma.webhookEvent.create({
      data: { provider: "paddle", eventType: event.event_type, providerEventId: event.event_id, payloadJson: JSON.stringify(event), status: "error", error: "Error: connection reset", createdAt: new Date(Date.now() - 20 * MIN) },
    });

    expect((await runScheduledSync()).ok).toBe(true);

    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: "evt_stuck_1" } })).status).toBe("processed"); // ⬅️ ESKİDE sonsuza dek "hata"
    expect((await prisma.subscription.findUniqueOrThrow({ where: { organizationId: org.id } })).status).toBe("past_due");
  });

  it("KONTROL: webhook sırrı yoksa (ödeme kurulmamış) olaylara dokunulmaz", async () => {
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", "");
    await prisma.webhookEvent.create({
      data: { provider: "paddle", eventType: "subscription.updated", providerEventId: "evt_x", payloadJson: JSON.stringify({ event_id: "evt_x", event_type: "subscription.updated", data: {} }), status: "error", error: "Error: x", createdAt: new Date(Date.now() - 20 * MIN) },
    });
    expect((await runScheduledSync()).ok).toBe(true);
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: "evt_x" } })).status).toBe("error");
  });
});
