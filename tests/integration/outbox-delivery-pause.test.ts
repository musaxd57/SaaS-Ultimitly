import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// KUYRUK ANAHTARLARI AYRI (kurucu 10-16): "Yeni işleri kuyruğa almayı durdurmak ile bekleyen gönderimleri durdurmak ayrı işlemler olsun.
// Hangisinin ne yaptığını açık göster; başlamış dış gönderimin geri alınabileceğini varsayma."
//  · `OUTBOX_DELIVERY_PAUSED=1` → işçi `pending` satırı TALEP ETMEZ (sağlayıcıya yeni gönderim yok; satır bekler, deneme sayısı artmaz).
//  · Uzlaştırma (`ambiguous` — sağlayıcı geçmişini OKUR, göndermez) sürer.
//  · Kaldırınca kaldığı yerden TEK kez gider.
//  · Alarm: "ilerlemiyor" değil, bir kez "duraklatıldı" bildirimi; strict yoklama sayfalamaz.
// ---------------------------------------------------------------------------

const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn() }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: reportErrorMock };
});

import { drainOutboxOnce } from "@/lib/outbox/worker";
import { checkQueueStall, strictQueueState, __resetStrictQueueState, QUEUE_STALL_MS } from "@/lib/outbox/health";
import { alertTracker } from "@/lib/alert-state";

const contexts = () => reportErrorMock.mock.calls.map(([c]) => String(c));

describe("OUTBOX_DELIVERY_PAUSED — bekleyen gönderimleri duraklat", () => {
  let orgId = "";
  let conversationId = "";
  beforeEach(async () => {
    await resetDb();
    reportErrorMock.mockReset();
    reportErrorMock.mockResolvedValue({ notified: true, throttled: false, configured: true });
    __resetStrictQueueState();
    const s = await makeOrgWithProperty();
    orgId = s.orgId;
    const conv = await prisma.conversation.create({
      data: { propertyId: s.propertyId, guestIdentifier: "Misafir", channel: "airbnb", externalReservationId: "res-p" },
    });
    conversationId = conv.id;
  });
  afterEach(() => vi.unstubAllEnvs());

  const pending = (key: string, ageMs = 60_000) =>
    prisma.messageOutbox.create({
      data: {
        organizationId: orgId,
        conversationId,
        channel: "airbnb",
        externalReservationId: "res-p",
        body: "Anahtar kutusu kapının sağında",
        idempotencyKey: key,
        status: "pending",
        messageType: "manual",
        availableAt: new Date(Date.now() - ageMs),
      },
    });

  it("🚨 duraklatıldı → bekleyen mesaj gönderilmez (deneme sayısı artmaz); kaldırınca TEK kez gider", async () => {
    const row = await pending("k1");
    const deliver = vi.fn().mockResolvedValue({ ok: true, providerMessageId: "p-1" });
    vi.stubEnv("OUTBOX_DELIVERY_PAUSED", "1");
    const out = await drainOutboxOnce({ send: deliver, tokenFor: async () => "tok" });
    expect(out.claimed).toBe(0);
    expect(deliver).not.toHaveBeenCalled();
    expect(await prisma.messageOutbox.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "pending", attemptCount: 0 });
    vi.stubEnv("OUTBOX_DELIVERY_PAUSED", "");
    await drainOutboxOnce({ send: deliver, tokenFor: async () => "tok" });
    await drainOutboxOnce({ send: deliver, tokenFor: async () => "tok" });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("sent");
  });

  it("duraklatmada UZLAŞTIRMA sürer (sonucu belirsiz satır sağlayıcı geçmişinden okunur, POST yok)", async () => {
    const amb = await prisma.messageOutbox.create({
      data: {
        organizationId: orgId,
        conversationId,
        channel: "airbnb",
        externalReservationId: "res-p",
        body: "Belirsiz",
        idempotencyKey: "amb",
        status: "ambiguous",
        availableAt: new Date(Date.now() - 60_000),
        attemptCount: 1,
      },
    });
    const deliver = vi.fn();
    const reconcile = vi.fn().mockResolvedValue({ found: true, providerMessageId: "p-found" });
    vi.stubEnv("OUTBOX_DELIVERY_PAUSED", "1");
    const out = await drainOutboxOnce({ send: deliver, reconcile, tokenFor: async () => "tok" });
    expect(out.claimed).toBe(1);
    expect(deliver).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: amb.id } })).status).not.toBe("ambiguous");
  });

  it("alarm: duraklatmada 'ilerlemiyor' YOK, bir kez 'duraklatıldı' bildirimi; strict yoklama sayfalamaz; kaldırınca bildirim temizlenir", async () => {
    await pending("k-old", QUEUE_STALL_MS + 60_000);
    vi.stubEnv("OUTBOX_DELIVERY_PAUSED", "1");
    await checkQueueStall(await alertTracker("scheduled-sync:"));
    await checkQueueStall(await alertTracker("scheduled-sync:"));
    expect(contexts()).toEqual(["Misafir mesajı gönderimi DURAKLATILDI"]);
    expect(await strictQueueState()).toBe("ok");
    vi.stubEnv("OUTBOX_DELIVERY_PAUSED", "");
    __resetStrictQueueState();
    // Kaldırıldı ama satır hâlâ 15 dk'dan eski ve ilerleme yok → artık gerçek "ilerlemiyor" (işçi alabilir ama almıyor).
    await checkQueueStall(await alertTracker("scheduled-sync:"));
    expect(await prisma.systemLock.count({ where: { name: "alert-state:scheduled-sync:queue-paused:message" } })).toBe(0);
    expect(contexts()).toContain("Kuyruk ilerlemiyor (misafir mesajı)");
    expect(await strictQueueState()).toBe("stalled");
  });
});
