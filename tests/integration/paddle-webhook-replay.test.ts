import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// S7 (kurucu kararı 11-11) — İŞLENEMEYEN PADDLE OLAYI YALNIZ PADDLE'IN TEKRARINA BIRAKILMAZ. Gerçek PostgreSQL + GERÇEK webhook işleyicisi.
//
// İmzası doğrulanan olay saklanır; işlenemezse "hata" kalır ve Paddle'a 500 döner. Paddle sınırlı süre yeniden gönderir, sonra bırakır.
// API anahtarımız reddedilirken gelen "yeni abonelik" olayı (kayıtlı aboneliğin yaşı okunamadığı için bilerek bekletilen olay) o süre
// içinde düzelmezse abonelik değişikliği kalıcı kaybolurdu. Artık saatlik iş saklı olayı AYNI işleyiciden yeniden geçirir; anahtar
// bozukken hiçbirini denemez (tek ortak alarm), düzelince hepsini geçirir.
// ---------------------------------------------------------------------------

const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn() }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: reportErrorMock };
});
// Kayıtlı aboneliğin Paddle'daki oluşturulma zamanı (abonelik başına tablo) + "şu an okunamıyor" kümesi + anahtar yoklamasının sonucu.
const { subCreated, subTransient, probe } = vi.hoisted(() => ({
  subCreated: new Map<string, string>(),
  subTransient: new Set<string>(),
  probe: { result: "ok" as "ok" | "unreadable" | "unconfigured", calls: 0 },
}));
vi.mock("@/lib/payments/paddle", async (orig) => {
  const actual = await orig<typeof import("@/lib/payments/paddle")>();
  return {
    ...actual,
    getSubscriptionCreatedAt: vi.fn(async (id: string) =>
      subTransient.has(id) ? actual.SUBSCRIPTION_READ_TRANSIENT : subCreated.has(id) ? new Date(subCreated.get(id)!) : null,
    ),
    probePaddleRead: vi.fn(async () => {
      probe.calls++;
      return probe.result;
    }),
  };
});

import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { POST as webhook } from "@/app/api/webhooks/paddle/route";
import { getSubscriptionCreatedAt } from "@/lib/payments/paddle";
import {
  replayPendingPaddleEvents,
  isPaddleUnreadableError,
  PADDLE_REPLAY_KEY_ALERT,
  type PaddleRedeliver,
} from "@/lib/payments/paddle-replay";
import { NEEDS_REVIEW_PREFIX, redactPaddlePayload } from "@/lib/data-retention";
import { alertStateActive } from "@/lib/alert-state";

const SECRET = "test-webhook-hmac-key-not-a-real-secret";
const KEY_ALARM = "paddle-api-read-unavailable";
const MIN = 60_000;
const HOUR = 60 * MIN;

function sign(body: string): string {
  const ts = Math.floor(Date.now() / 1000);
  return `ts=${ts};h1=${createHmac("sha256", SECRET).update(`${ts}:${body}`, "utf8").digest("hex")}`;
}
const postEvent = (event: Record<string, unknown>) => {
  const body = JSON.stringify(event);
  return webhook(new NextRequest("http://localhost/api/webhooks/paddle", { method: "POST", headers: { "content-type": "application/json", "paddle-signature": sign(body) }, body }));
};
const keyAlarms = () => reportErrorMock.mock.calls.filter(([context]) => context === KEY_ALARM);
const eventRow = (id: string) => prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: id } });
const sub = (orgId: string) => prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });
/** Olayın ilk alındığı anı geriye çeker (yaş eşikleri için). */
const ageEvent = (id: string, ms: number) => prisma.webhookEvent.update({ where: { providerEventId: id }, data: { createdAt: new Date(Date.now() - ms) } });

describe("işlenemeyen Paddle olayının yeniden işlenmesi (S7)", () => {
  let orgId = "";
  let consentId = "";
  let n = 0;
  const subEvent = (subId: string, status: string, over: Record<string, unknown> = {}, at = new Date(Date.now() - 1_000 + ++n)) => ({
    event_id: `evt_${++n}`,
    event_type: "subscription.updated",
    occurred_at: at.toISOString(),
    data: { id: subId, status, customer_id: "ctm_1", custom_data: { consentId }, items: [{ price: { id: "pri_pro" } }], ...over },
  });
  const seedSub = (providerRef: string, status: string) =>
    prisma.subscription.create({ data: { organizationId: orgId, planCode: "pro", status, provider: "paddle", providerRef } });

  /** Anahtar reddedilirken gelen "yeni abonelik (B) aktifleşti" olayı: kayıtlı A'nın yaşı okunamaz → olay bilerek bekletilir (500). */
  async function heldNewSubscriptionEvent() {
    await seedSub("sub_A", "active");
    subTransient.add("sub_A");
    const ev = subEvent("sub_B", "active", { created_at: "2026-11-04T10:02:00Z" });
    expect((await postEvent(ev)).status).toBe(500);
    expect((await sub(orgId)).providerRef).toBe("sub_A"); // mevcut abonelik korunuyor
    return ev;
  }

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    subCreated.clear();
    subTransient.clear();
    probe.result = "ok";
    probe.calls = 0;
    reportErrorMock.mockResolvedValue({ notified: true, throttled: false, configured: true });
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
    orgId = (await prisma.organization.create({ data: { name: "Org" } })).id;
    const user = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" } });
    consentId = (
      await prisma.checkoutConsent.create({
        data: { organizationId: orgId, userId: user.id, planCode: "pro", priceId: "pri_pro", legalVersion: "2026-06", ip: "1.2.3.4" },
        select: { id: true },
      })
    ).id;
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("API anahtarı reddediliyor / Paddle okunamıyor", () => {
    it("işleyicinin 'okunamadı' hatası kayıtta TANINIR (işaret ile işleyicinin metni ayrışmasın)", async () => {
      const ev = await heldNewSubscriptionEvent();
      const row = await eventRow(ev.event_id);
      expect(row.status).toBe("error");
      expect(isPaddleUnreadableError(row.error)).toBe(true);
      expect(isPaddleUnreadableError("Error: connection reset")).toBe(false);
      expect(isPaddleUnreadableError(null)).toBe(false);
    });

    it("🚨 anahtar hâlâ reddedilirken olay DENENMEZ: sağlayıcıya tek yoklama, işleyici koşmaz, TEK ortak alarm (tur başına tekrar yok)", async () => {
      const ev = await heldNewSubscriptionEvent();
      vi.mocked(getSubscriptionCreatedAt).mockClear();
      reportErrorMock.mockClear();
      probe.result = "unreadable";

      const first = await replayPendingPaddleEvents();
      expect(first).toMatchObject({ pending: 1, replayed: 0, heldForKey: 1 });
      expect(probe.calls).toBe(1);
      expect(vi.mocked(getSubscriptionCreatedAt)).not.toHaveBeenCalled(); // işleyici hiç koşmadı
      expect((await eventRow(ev.event_id)).status).toBe("error");
      expect((await sub(orgId)).providerRef).toBe("sub_A");
      expect(keyAlarms()).toHaveLength(1);
      expect(String(keyAlarms()[0][1])).toContain("1 ödeme olayı bekliyor");
      expect(String(keyAlarms()[0][1])).not.toContain(orgId); // ortak arıza: işletme adı / kimliği taşımaz
      expect(await alertStateActive(PADDLE_REPLAY_KEY_ALERT)).toBe(true);

      await replayPendingPaddleEvents();
      await replayPendingPaddleEvents();
      expect(keyAlarms()).toHaveLength(1); // ⬅️ geçiş tabanlı: aynı arıza sürerken yeniden e-posta yok
      expect(reportErrorMock.mock.calls.filter(([c]) => c === "paddle-webhook")).toHaveLength(0); // olay başına alarm da yok
    });

    it("🚨 anahtar DÜZELİNCE bekleyen olay ilk turda (yaş eşiği beklenmeden) işlenir: yeni abonelik yazılır, alarm durumu kapanır", async () => {
      const ev = await heldNewSubscriptionEvent();
      probe.result = "unreadable";
      await replayPendingPaddleEvents();

      // Anahtar değiştirildi: okuma çalışıyor; A 10:00'da, B 10:02'de oluşturulmuş → B yenidir, yerine geçer.
      probe.result = "ok";
      subTransient.clear();
      subCreated.set("sub_A", "2026-11-04T10:00:00Z");
      const out = await replayPendingPaddleEvents();
      expect(out).toMatchObject({ replayed: 1, settled: 1, heldForKey: 0 });
      expect((await eventRow(ev.event_id)).status).toBe("processed"); // ⬅️ ESKİDE: Paddle yeniden göndermezse sonsuza dek "hata"
      expect((await sub(orgId)).providerRef).toBe("sub_B");
      expect(await alertStateActive(PADDLE_REPLAY_KEY_ALERT)).toBe(false);

      // İşlenmiş olay bir daha aday değildir.
      expect(await replayPendingPaddleEvents()).toMatchObject({ pending: 0, replayed: 0 });
    });

    it("🚨 anahtar SAĞLAMKEN bu sınıf da olağan sıklığa uyar: yaş eşiği geçmeden denenmez, her turda yeniden denenmez", async () => {
      // Olay geldiğinde okuma geçici olarak düşmüştü (anahtar bozuk değil): yoklama geçiyor, alarm durumu hiç açılmadı.
      const ev = await heldNewSubscriptionEvent();
      vi.mocked(getSubscriptionCreatedAt).mockClear();
      probe.result = "ok";

      expect(await replayPendingPaddleEvents()).toMatchObject({ pending: 1, replayed: 0, heldForKey: 0 }); // ⬅️ olay henüz 15 dakikalık değil
      expect(vi.mocked(getSubscriptionCreatedAt)).not.toHaveBeenCalled();

      // 20 dakika geçti: olay 20 dakikalık, önceki tur 19 dakika önceydi (olay o sırada 1 dakikalıktı).
      await ageEvent(ev.event_id, 20 * MIN);
      await prisma.systemLock.updateMany({ where: { name: "paddle-webhook-replay:last" }, data: { lockedUntil: new Date(Date.now() - 19 * MIN) } });
      expect(await replayPendingPaddleEvents()).toMatchObject({ replayed: 1, settled: 0 }); // denendi; abonelik okuması hâlâ düşüyor
      expect(await replayPendingPaddleEvents()).toMatchObject({ replayed: 0 }); // yeni eşik geçilmedi → bu turda yok
      expect((await eventRow(ev.event_id)).status).toBe("error");
      expect(await alertStateActive(PADDLE_REPLAY_KEY_ALERT)).toBe(false); // anahtar alarmı açılmadı (yoklama geçti)
    });

    it("🚨 sıra koruması aynen: bekleyen ESKİ olay, sonradan uygulanmış daha yeni olayı EZMEZ", async () => {
      // Bekleyen olay: B aktif (t1). Bu arada B için daha yeni bir olay (t2, "past_due") normal yoldan işlendi.
      // (Olay anları onay kaydına 5 dakikadan yakın: daha eski olay onay kaydıyla işletmeye bağlanmaz — o başka bir kuralın konusu.)
      const t1 = new Date(Date.now() - 3 * MIN);
      await seedSub("sub_A", "active");
      subTransient.add("sub_A");
      const held = subEvent("sub_B", "active", { created_at: "2026-11-04T10:02:00Z" }, t1);
      expect((await postEvent(held)).status).toBe(500);
      subTransient.clear();
      subCreated.set("sub_A", "2026-11-04T10:00:00Z");
      const newer = subEvent("sub_B", "active", { created_at: "2026-11-04T10:02:00Z" }, new Date(Date.now() - 2 * MIN));
      expect((await postEvent(newer)).status).toBe(200);
      expect((await sub(orgId)).providerRef).toBe("sub_B");
      const pastDue = subEvent("sub_B", "past_due", {}, new Date(Date.now() - 1 * MIN));
      expect((await postEvent(pastDue)).status).toBe(200);
      expect((await sub(orgId)).status).toBe("past_due");

      await ageEvent(held.event_id, 20 * MIN);
      const out = await replayPendingPaddleEvents();
      expect(out.replayed).toBe(1);
      expect((await eventRow(held.event_id)).status).toBe("processed"); // kapandı…
      expect((await sub(orgId)).status).toBe("past_due"); // …ama güncel durumu geri almadı
    });

    it("anahtar bozukken BAŞKA sebeple bekleyen olay yine yeniden işlenir (o sınıf yoklamaya bağlı değil)", async () => {
      await heldNewSubscriptionEvent();
      probe.result = "unreadable";
      const other = subEvent("sub_A", "active");
      await prisma.webhookEvent.create({
        data: { provider: "paddle", eventType: other.event_type, providerEventId: other.event_id, payloadJson: JSON.stringify(other), status: "error", error: "Error: connection reset", createdAt: new Date(Date.now() - 20 * MIN) },
      });
      const out = await replayPendingPaddleEvents();
      expect(out).toMatchObject({ pending: 2, replayed: 1, settled: 1, heldForKey: 1 });
      expect((await eventRow(other.event_id)).status).toBe("processed");
    });

    it("bekleyen kalmadıysa (Paddle'ın kendi tekrarı işledi) alarm durumu kapanır — sonraki arıza yeniden bildirilir", async () => {
      const ev = await heldNewSubscriptionEvent();
      probe.result = "unreadable";
      await replayPendingPaddleEvents();
      expect(await alertStateActive(PADDLE_REPLAY_KEY_ALERT)).toBe(true);
      // Paddle aynı olayı yeniden gönderdi ve bu kez işlendi.
      subTransient.clear();
      subCreated.set("sub_A", "2026-11-04T10:00:00Z");
      expect((await postEvent(ev)).status).toBe(200);
      probe.calls = 0;
      await replayPendingPaddleEvents();
      expect(probe.calls).toBe(0); // bekleyen yok → yoklama da yok
      expect(await alertStateActive(PADDLE_REPLAY_KEY_ALERT)).toBe(false);
    });
  });

  describe("aday seçimi ve sıklık", () => {
    /** İşleyiciyi taklit eden teslim: hangi olayların verildiğini kaydeder; `fail` kümesindekiler 500 döner. */
    function recordingDeliver(fail = new Set<string>()) {
      const seen: string[] = [];
      const deliver: PaddleRedeliver = async (req) => {
        const body = JSON.parse(await req.text()) as { event_id: string };
        seen.push(body.event_id);
        return new Response("{}", { status: fail.has(body.event_id) ? 500 : 200 });
      };
      return { seen, deliver };
    }
    const stored = (id: string, over: Partial<{ status: string; error: string | null; eventType: string; payloadJson: string; ageMs: number; occurredAt: Date }> = {}) => {
      const ev = { event_id: id, event_type: over.eventType ?? "subscription.updated", occurred_at: (over.occurredAt ?? new Date()).toISOString(), data: { id: "sub_X", status: "active" } };
      return prisma.webhookEvent.create({
        data: {
          provider: "paddle",
          eventType: ev.event_type,
          providerEventId: id,
          payloadJson: over.payloadJson ?? JSON.stringify(ev),
          status: over.status ?? "error",
          error: over.error === undefined ? "Error: connection reset" : over.error,
          createdAt: new Date(Date.now() - (over.ageMs ?? 20 * MIN)),
        },
      });
    };

    it("🚨 yalnız yeniden işlenebilir olaylar: inceleme bekleyen, küçültülmüş yük, API anahtarı olayı, işlenmiş, 14 günden eski ve taze 'alındı' DIŞARIDA", async () => {
      await stored("ok_error");
      await stored("ok_stuck", { status: "received", error: null, ageMs: 16 * MIN });
      await stored("ok_txn", { eventType: "transaction.completed" });
      await stored("no_review", { error: `${NEEDS_REVIEW_PREFIX} unlinked` });
      await stored("no_redacted", { payloadJson: redactPaddlePayload(JSON.stringify({ event_id: "no_redacted", data: {} }), "org-deleted") });
      await stored("no_apikey", { eventType: "api_key.expiring" });
      await stored("no_processed", { status: "processed", error: null });
      await stored("no_old", { ageMs: 15 * 24 * HOUR });
      await stored("no_fresh_received", { status: "received", error: null, ageMs: 5 * MIN });
      await stored("no_null_error_is_fine", { error: null }); // hata metni boş "hata" satırı da yeniden işlenir (boş alan süzgeçte kaybolmaz)

      const { seen, deliver } = recordingDeliver();
      const out = await replayPendingPaddleEvents({ deliver });
      expect(new Set(seen)).toEqual(new Set(["ok_error", "ok_stuck", "ok_txn", "no_null_error_is_fine"]));
      expect(out).toMatchObject({ pending: 4, replayed: 4, settled: 4 });
    });

    it("🚨 sıklık sınırlı: olay yaşı eşikleri (15 dk, 1 sa, 2 sa …) geçtikçe birer kez; arada kalan turlarda denenmez", async () => {
      await stored("e1", { ageMs: 5 * MIN });
      const { seen, deliver } = recordingDeliver(new Set(["e1"])); // hep hata veriyor
      const t0 = Date.now();
      const at = (ms: number) => new Date(t0 + ms);
      await replayPendingPaddleEvents({ deliver, now: at(0) }); // yaş 5 dk → erken
      expect(seen).toEqual([]);
      await replayPendingPaddleEvents({ deliver, now: at(15 * MIN) }); // yaş 20 dk → 15 dk eşiği geçildi
      expect(seen).toEqual(["e1"]);
      await replayPendingPaddleEvents({ deliver, now: at(35 * MIN) }); // yaş 40 dk → yeni eşik yok
      expect(seen).toEqual(["e1"]); // ⬅️ sınırsız yeniden deneme yok
      await replayPendingPaddleEvents({ deliver, now: at(60 * MIN) }); // yaş 65 dk → 1 sa eşiği
      expect(seen).toEqual(["e1", "e1"]);
      await replayPendingPaddleEvents({ deliver, now: at(10 * HOUR) }); // uzun ara: 2, 4, 8 sa eşikleri TEK işlemeye iner
      expect(seen).toEqual(["e1", "e1", "e1"]);
    });

    it("🚨 hep hata veren olay ötekileri BEKLETMEZ; olaylar olay zamanına göre sırayla verilir", async () => {
      const base = Date.now();
      await stored("late", { occurredAt: new Date(base - 1 * MIN), ageMs: 50 * MIN });
      await stored("broken", { occurredAt: new Date(base - 5 * MIN), ageMs: 40 * MIN });
      await stored("early", { occurredAt: new Date(base - 9 * MIN), ageMs: 30 * MIN });
      const { seen, deliver } = recordingDeliver(new Set(["broken"]));
      const out = await replayPendingPaddleEvents({ deliver });
      expect(seen).toEqual(["early", "broken", "late"]); // alınma sırası değil OLAY sırası
      expect(out).toMatchObject({ replayed: 3, settled: 2 });
    });

    it("teslim fırlatsa da tur sürer (tek olay ötekileri düşürmez)", async () => {
      await stored("a", { occurredAt: new Date(Date.now() - 2 * MIN) });
      await stored("b", { occurredAt: new Date(Date.now() - 1 * MIN) });
      const seen: string[] = [];
      const out = await replayPendingPaddleEvents({
        deliver: async (req) => {
          const id = (JSON.parse(await req.text()) as { event_id: string }).event_id;
          seen.push(id);
          if (id === "a") throw new Error("boom");
          return new Response("{}", { status: 200 });
        },
      });
      expect(seen).toEqual(["a", "b"]);
      expect(out).toMatchObject({ replayed: 2, settled: 1 });
    });

    it("webhook sırrı yoksa (ödeme kurulmamış) hiçbir şey yapmaz", async () => {
      await stored("e1");
      vi.stubEnv("PADDLE_WEBHOOK_SECRET", "");
      const { seen, deliver } = recordingDeliver();
      expect(await replayPendingPaddleEvents({ deliver })).toEqual({ pending: 0, replayed: 0, settled: 0, heldForKey: 0 });
      expect(seen).toEqual([]);
    });

    it("🚨 yeniden teslim GERÇEK işleyicinin imza kontrolünden geçer (saklı gövde kendi sırrımızla imzalanır) ve olayı işler", async () => {
      await seedSub("sub_A", "active");
      const ev = subEvent("sub_A", "past_due");
      await prisma.webhookEvent.create({
        data: { provider: "paddle", eventType: ev.event_type, providerEventId: ev.event_id, payloadJson: JSON.stringify(ev), status: "error", error: "Error: connection reset", createdAt: new Date(Date.now() - 20 * MIN) },
      });
      const out = await replayPendingPaddleEvents(); // varsayılan teslim: uç noktanın kendi işleyicisi
      expect(out).toMatchObject({ replayed: 1, settled: 1 });
      expect((await eventRow(ev.event_id)).status).toBe("processed");
      expect((await sub(orgId)).status).toBe("past_due");
    });
  });
});
