import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// Paddle olayı yeniden işleme vadesi OLAYIN KENDİ SATIRINDA (kurucu 11-18 akşam: "ilk öncelik olay başına nextAttemptAt"; migration 98).
// Gerçek PostgreSQL + gerçek webhook işleyicisi. Eskiden vade `createdAt` + ortak "son tur" işaretinden türetiliyordu; satırda kaç kez
// denendiği bilinmiyordu, tavan aşımı için ayrı "mantıksal tur" makinesi vardı. Sözleşme aynı: olay başına yaş eşikleri, 14 günde en çok
// 10 deneme, hep hata veren olay ötekileri bekletmez, anahtar okunamazken o sınıf denenmez ve vadesi harcanmaz. 🚨 Ödeme zinciri: hâlâ
// aday olup vadesi boş kalan satır (kalıcı sessiz kayıp) olmamalı — en sondaki değişmez testi bunu ölçer.
// ---------------------------------------------------------------------------

const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn() }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: reportErrorMock };
});
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
import { replayPendingPaddleEvents, PADDLE_REPLAY_KEY_ALERT, PADDLE_REPLAY_WINDOW_MS, PADDLE_UNREADABLE_MARKER, type PaddleRedeliver } from "@/lib/payments/paddle-replay";
import { nextPaddleReplayAt, PADDLE_REPLAY_THRESHOLDS_MS } from "@/lib/payments/paddle-replay-schedule";
import { NEEDS_REVIEW_PREFIX, redactPaddlePayload } from "@/lib/data-retention";
import { alertOnTransition, alertStateActive } from "@/lib/alert-state";
import { paddleReplayDue, seeded } from "../helpers/paddle-replay-oracle";

const SECRET = "test-webhook-hmac-key-not-a-real-secret";
const MIN = 60_000;
const HOUR = 60 * MIN;
const LAST_PASS = "paddle-webhook-replay:last";
const KEY_ERROR = `Error: kayıtlı aboneliğin oluşturulma zamanı ${PADDLE_UNREADABLE_MARKER}`;

function sign(body: string): string {
  const ts = Math.floor(Date.now() / 1000);
  return `ts=${ts};h1=${createHmac("sha256", SECRET).update(`${ts}:${body}`, "utf8").digest("hex")}`;
}
const postEvent = (event: Record<string, unknown>) => {
  const body = JSON.stringify(event);
  return webhook(new NextRequest("http://localhost/api/webhooks/paddle", { method: "POST", headers: { "content-type": "application/json", "paddle-signature": sign(body) }, body }));
};
const row = (id: string) => prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: id } });

/** İşleyiciyi taklit eden teslim: verilen olayları kaydeder; `fail` kümesindekiler 500 döner. Veritabanına yazmaz. */
function recordingDeliver(fail: Set<string> | "all" = new Set()) {
  const seen: string[] = [];
  const deliver: PaddleRedeliver = async (req) => {
    const id = (JSON.parse(await req.text()) as { event_id: string }).event_id;
    seen.push(id);
    return new Response("{}", { status: fail === "all" || fail.has(id) ? 500 : 200 });
  };
  return { seen, deliver };
}

/** Vadesi BOŞ (eski sürümden kalan / testte elle yazılmış) aday satırları; `${prefix}_${i}`, alınma anı satır başına. */
const seedLegacy = (n: number, prefix: string, createdAt: (i: number) => Date, over: { error?: string | null; redacted?: boolean } = {}) =>
  prisma.webhookEvent.createMany({
    data: Array.from({ length: n }, (_, i) => {
      const id = `${prefix}_${i}`;
      const ev = { event_id: id, event_type: "subscription.updated", occurred_at: createdAt(i).toISOString(), data: { id: "sub_X", status: "active" } };
      return {
        provider: "paddle",
        eventType: ev.event_type,
        providerEventId: id,
        payloadJson: over.redacted ? redactPaddlePayload(JSON.stringify(ev), "kvkk-erasure") : JSON.stringify(ev),
        status: "error",
        error: over.error === undefined ? "Error: x" : over.error,
        createdAt: createdAt(i),
      };
    }),
  });

describe("Paddle yeniden işleme — vade satırda (WebhookEvent.nextAttemptAt)", () => {
  let orgId = "";
  let consentId = "";
  let n = 0;
  const subEvent = (subId: string, status: string, over: Record<string, unknown> = {}) => ({
    event_id: `evt_${++n}`,
    event_type: "subscription.updated",
    occurred_at: new Date(Date.now() - 1_000 + ++n).toISOString(),
    data: { id: subId, status, customer_id: "ctm_1", custom_data: { consentId }, items: [{ price: { id: "pri_pro" } }], ...over },
  });
  const seedSub = (providerRef: string, status: string) =>
    prisma.subscription.create({ data: { organizationId: orgId, planCode: "pro", status, provider: "paddle", providerRef } });

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

  describe("yazım: webhook işleyicisi ilk vadeyi yazar, işlenince siler", () => {
    it("🚨 (e) işlenemeyen olay: vade = alınıştan 15 dk sonra, sayaç 0; işlenen olay: vade BOŞ", async () => {
      await seedSub("sub_A", "active");
      subTransient.add("sub_A"); // kayıtlı aboneliğin yaşı okunamıyor → yeni abonelik olayı bilerek bekletilir (500)
      const held = subEvent("sub_B", "active", { created_at: "2026-11-04T10:02:00Z" });
      expect((await postEvent(held)).status).toBe(500);
      const r = await row(held.event_id);
      expect(r.status).toBe("error");
      expect(r.nextAttemptAt?.getTime()).toBe(r.createdAt.getTime() + PADDLE_REPLAY_THRESHOLDS_MS[0]); // ⬅️ ESKİDE null (sütun yazılmıyordu)
      expect(r.attemptCount).toBe(0);
      expect(r.lastAttemptAt).toBeNull();

      const ok = subEvent("sub_A", "past_due");
      subTransient.clear();
      expect((await postEvent(ok)).status).toBe(200);
      const p = await row(ok.event_id);
      expect(p.status).toBe("processed");
      expect(p.nextAttemptAt).toBeNull();
    });

    it("🚨 (e) yeniden işlemede işlenen olayın vadesi silinir ve bir daha seçilmez; sayaç ve son deneme anı yazılır", async () => {
      await seedSub("sub_A", "active");
      const ev = subEvent("sub_A", "past_due");
      const createdAt = new Date(Date.now() - 20 * MIN);
      await prisma.webhookEvent.create({
        data: { provider: "paddle", eventType: ev.event_type, providerEventId: ev.event_id, payloadJson: JSON.stringify(ev), status: "error", error: "Error: connection reset", createdAt, nextAttemptAt: new Date(createdAt.getTime() + 15 * MIN) },
      });
      const now = new Date();
      expect(await replayPendingPaddleEvents({ now })).toMatchObject({ replayed: 1, settled: 1 }); // gerçek işleyici
      const r = await row(ev.event_id);
      expect(r.status).toBe("processed");
      expect(r.nextAttemptAt).toBeNull(); // ⬅️ ESKİDE 15 dk vadesi yerinde kalırdı (sütun yazılmıyordu)
      expect(r.attemptCount).toBe(1);
      expect(r.lastAttemptAt?.getTime()).toBe(now.getTime());
      expect(await replayPendingPaddleEvents({ now: new Date(now.getTime() + 300 * HOUR) })).toMatchObject({ pending: 0, replayed: 0 });
    });

    it("inceleme bekleyen satır planlanmaz (vade boş) ve aday değildir", async () => {
      // Bağlanamayan ödemeli olay "inceleme" kalır (işletmeye bağlanamadı) — işleyicinin kendi yolu.
      const ev = { event_id: "evt_unlinked", event_type: "subscription.updated", occurred_at: new Date().toISOString(), data: { id: "sub_Z", status: "active", customer_id: "ctm_z", items: [{ price: { id: "pri_pro" } }] } };
      expect((await postEvent(ev)).status).toBe(200);
      const r = await row(ev.event_id);
      expect(r.status).toBe("error");
      expect(r.error?.startsWith(NEEDS_REVIEW_PREFIX)).toBe(true);
      expect(r.nextAttemptAt).toBeNull();
      const { seen, deliver } = recordingDeliver();
      await replayPendingPaddleEvents({ deliver, now: new Date(Date.now() + HOUR) });
      expect(seen).toEqual([]);
    });
  });

  describe("deneme sonrası: sayaç, son deneme anı, sıradaki eşik", () => {
    it("🚨 (f) her denemede sayaç +1, son deneme = turun anı, vade = şimdiki yaştan büyük ilk eşik; eşik kalmayınca BOŞ", async () => {
      const t0 = new Date();
      const createdAt = new Date(t0.getTime() - 20 * MIN);
      await seedLegacy(1, "e", () => createdAt);
      const { seen, deliver } = recordingDeliver("all");
      await replayPendingPaddleEvents({ deliver, now: t0 });
      let r = await row("e_0");
      expect(r.attemptCount).toBe(1); // ⬅️ ESKİDE 0
      expect(r.lastAttemptAt?.getTime()).toBe(t0.getTime());
      expect(r.nextAttemptAt?.getTime()).toBe(createdAt.getTime() + HOUR);

      const t1 = new Date(createdAt.getTime() + 10 * HOUR); // uzun ara: 1, 2, 4, 8 sa geçildi → TEK deneme
      await replayPendingPaddleEvents({ deliver, now: t1 });
      r = await row("e_0");
      expect(r.attemptCount).toBe(2);
      expect(r.lastAttemptAt?.getTime()).toBe(t1.getTime());
      expect(r.nextAttemptAt?.getTime()).toBe(createdAt.getTime() + 16 * HOUR);

      const t2 = new Date(createdAt.getTime() + 300 * HOUR); // son eşik (256 sa) geçildi
      await replayPendingPaddleEvents({ deliver, now: t2 });
      r = await row("e_0");
      expect(r.attemptCount).toBe(3);
      expect(r.nextAttemptAt).toBeNull(); // eşik kalmadı
      await replayPendingPaddleEvents({ deliver, now: new Date(createdAt.getTime() + 330 * HOUR) });
      expect(seen).toEqual(["e_0", "e_0", "e_0"]); // bir daha denenmez
      expect((await row("e_0")).attemptCount).toBe(3);
    });

    it("başka bir yazıcı satırı deneme sırasında 'işlendi' yaptıysa (vadesini silmeden) deneme kaydı vadeyi BOŞALTIR", async () => {
      const t0 = new Date();
      await seedLegacy(1, "w", () => new Date(t0.getTime() - 20 * MIN));
      const deliver: PaddleRedeliver = async () => {
        await prisma.webhookEvent.updateMany({ where: { providerEventId: "w_0" }, data: { status: "processed", processedAt: new Date() } }); // ör. KVKK silme
        return new Response("{}", { status: 200 });
      };
      await replayPendingPaddleEvents({ deliver, now: t0 });
      const r = await row("w_0");
      expect(r.status).toBe("processed");
      expect(r.attemptCount).toBe(1);
      expect(r.nextAttemptAt).toBeNull();
    });

    it("teslim fırlatsa da sayaç ve vade ilerler (hep fırlatan olay her turda yeniden denenmez)", async () => {
      const t0 = new Date();
      await seedLegacy(1, "boom", () => new Date(t0.getTime() - 20 * MIN));
      let calls = 0;
      const deliver: PaddleRedeliver = async () => {
        calls++;
        throw new Error("boom");
      };
      await replayPendingPaddleEvents({ deliver, now: t0 });
      await replayPendingPaddleEvents({ deliver, now: new Date(t0.getTime() + 5 * MIN) });
      expect(calls).toBe(1);
      expect((await row("boom_0")).attemptCount).toBe(1);
    });
  });

  describe("açlık yok", () => {
    const CAP = 5;
    it("🚨 (b) önde hep hata veren N satır (N = tavan) varken arkadaki satır BİR SONRAKİ koşuda denenir — baştakilerin yeni eşiği geçse bile", async () => {
      const t1 = new Date();
      await seedLegacy(CAP, "head", (i) => new Date(t1.getTime() - 3 * HOUR + i * 1_000));
      await seedLegacy(1, "fresh", () => new Date(t1.getTime() - 20 * MIN));
      const r1 = recordingDeliver("all");
      expect(await replayPendingPaddleEvents({ deliver: r1.deliver, now: t1, maxPerPass: CAP })).toMatchObject({ replayed: CAP });
      expect(r1.seen.sort()).toEqual(Array.from({ length: CAP }, (_, i) => `head_${i}`).sort());
      for (let i = 0; i < CAP; i++) expect((await row(`head_${i}`)).nextAttemptAt!.getTime()).toBeGreaterThan(t1.getTime()); // ⬅️ ESKİDE null
      // Bir saat sonra baştakilerin HEPSİ 4 sa eşiğini de geçti: vadesi gelen CAP + 1 satır var. Alınma sırasıyla okunsaydı baştakiler
      // tavanı yine doldurur, arkadaki hiç gelmezdi — en uzun bekleyen (vadesi en eski) önce okunur.
      const r2 = recordingDeliver("all");
      await replayPendingPaddleEvents({ deliver: r2.deliver, now: new Date(t1.getTime() + HOUR + 10_000), maxPerPass: CAP });
      expect(r2.seen).toHaveLength(CAP);
      expect(r2.seen).toContain("fresh_0");
    });

    it("🚨 (b) küçültülmüş (yeniden işlenmeyen) yükler de öndeki yeri kalıcı tutmaz: arkadaki gerçek olay bir sonraki koşuda", async () => {
      const t1 = new Date();
      await seedLegacy(CAP + 1, "red", (i) => new Date(t1.getTime() - 3 * HOUR + i * 1_000), { redacted: true });
      await seedLegacy(1, "fresh", () => new Date(t1.getTime() - 20 * MIN));
      const r1 = recordingDeliver();
      await replayPendingPaddleEvents({ deliver: r1.deliver, now: t1, maxPerPass: CAP });
      expect(r1.seen).toEqual([]);
      const r2 = recordingDeliver();
      await replayPendingPaddleEvents({ deliver: r2.deliver, now: new Date(t1.getTime() + 10 * MIN), maxPerPass: CAP });
      expect(r2.seen).toEqual(["fresh_0"]);
      expect((await row("red_0")).attemptCount).toBe(0); // küçültülmüş yük denenmedi, sayılmadı
    });
  });

  describe("geçiş: vadesi boş eski satırlar", () => {
    it("🚨 (c) son tur işareti varsa vade = işaretten SONRA geçilecek ilk eşik; yoksa ilk eşik; iki kez koşunca aynı", async () => {
      const now = new Date();
      const marker = new Date(now.getTime() - 10 * MIN);
      await prisma.systemLock.create({ data: { name: LAST_PASS, lockedUntil: marker } });
      const ages = [5 * MIN, 20 * MIN, 50 * MIN, 3 * HOUR, 30 * HOUR, 200 * HOUR, 260 * HOUR, 300 * HOUR];
      await seedLegacy(ages.length, "L", (i) => new Date(now.getTime() - ages[i]));
      const r1 = recordingDeliver("all");
      await replayPendingPaddleEvents({ deliver: r1.deliver, now });
      const expectedSeen = ages.map((a, i) => (paddleReplayDue(new Date(now.getTime() - a), marker, now) ? `L_${i}` : null)).filter(Boolean);
      expect(r1.seen.sort()).toEqual(expectedSeen.sort()); // eski kuralın bu turda seçeceği küme (işaret = son tur)
      expect(expectedSeen.length).toBeGreaterThan(0);
      expect(expectedSeen.length).toBeLessThan(ages.length);
      const snapshot = async () => (await prisma.webhookEvent.findMany({ orderBy: { providerEventId: "asc" } })).map((r) => [r.providerEventId, r.nextAttemptAt?.getTime() ?? null, r.attemptCount]);
      const first = await snapshot();
      for (let i = 0; i < ages.length; i++) {
        const created = new Date(now.getTime() - ages[i]);
        const r = await row(`L_${i}`);
        if (!expectedSeen.includes(`L_${i}`)) expect(r.nextAttemptAt?.getTime() ?? null, `L_${i}`).toBe(nextPaddleReplayAt(created, marker)?.getTime() ?? null);
      }
      // Yaşı işarette son eşiği çoktan geçmiş satır (300 sa) eski kuralda da bir daha denenmezdi: vade boş kalır, okunmaz.
      expect((await row("L_7")).nextAttemptAt).toBeNull();
      const r2 = recordingDeliver("all");
      await replayPendingPaddleEvents({ deliver: r2.deliver, now });
      expect(r2.seen).toEqual([]);
      expect(await snapshot()).toEqual(first);
    });

    it("son tur işareti yoksa (hiç koşmamış) ilk eşiği geçmiş her eski satır hemen vadeli", async () => {
      const now = new Date();
      await seedLegacy(3, "N", (i) => new Date(now.getTime() - [5 * MIN, 20 * MIN, 300 * HOUR][i]));
      const r = recordingDeliver("all");
      await replayPendingPaddleEvents({ deliver: r.deliver, now });
      expect(r.seen.sort()).toEqual(["N_1", "N_2"]);
      expect((await row("N_0")).nextAttemptAt?.getTime()).toBe(now.getTime() - 5 * MIN + 15 * MIN);
    });

    it("🚨 (c) eski satır tavandan çoksa koşulara yayılır — her satır tam BİR kez denenir, tavan alarmı bir kez açılıp kapanır (sessiz tavan yok)", async () => {
      const CAP = 5;
      const t1 = new Date();
      const N = CAP * 2 + 2;
      await seedLegacy(N, "m", (i) => new Date(t1.getTime() - 3 * HOUR + i * 1_000));
      reportErrorMock.mockClear();
      const seen: string[] = [];
      for (let k = 0; k < 4; k++) {
        const r = recordingDeliver("all");
        await replayPendingPaddleEvents({ deliver: r.deliver, now: new Date(t1.getTime() + k * 10 * MIN), maxPerPass: CAP });
        seen.push(...r.seen);
      }
      expect(seen.sort()).toEqual(Array.from({ length: N }, (_, i) => `m_${i}`).sort());
      const alarms = reportErrorMock.mock.calls.filter(([c]) => c === "paddle-webhook-replay-backlog");
      expect(alarms).toHaveLength(1);
      expect(await alertStateActive("paddle-webhook-replay:backlog")).toBe(false);
      expect(await prisma.webhookEvent.count({ where: { nextAttemptAt: null } })).toBe(0);
    });
    it("🚨 (c) eşikleri eski işarette tükenmiş eski satırlar geçiş adımının tavanını kalıcı doldurmaz: arkadaki eski satır planlanır", async () => {
      const CAP = 5;
      const now = new Date();
      await prisma.systemLock.create({ data: { name: LAST_PASS, lockedUntil: new Date(now.getTime() - 10 * MIN) } });
      await seedLegacy(CAP + 1, "spent", (i) => new Date(now.getTime() - 300 * HOUR + i * 1_000)); // işarette yaşı > 256 sa: eski kuralda bitti
      await seedLegacy(1, "live", () => new Date(now.getTime() - 20 * MIN));
      const seen: string[] = [];
      for (let k = 0; k < 2; k++) {
        const r = recordingDeliver("all");
        await replayPendingPaddleEvents({ deliver: r.deliver, now: new Date(now.getTime() + k * MIN), maxPerPass: CAP });
        seen.push(...r.seen);
      }
      expect(seen).toEqual(["live_0"]); // eşiği tükenmiş satırlar denenmez; canlı satır ilk koşuda
      expect(await alertStateActive("paddle-webhook-replay:backlog")).toBe(false); // tükenmiş satırlar "bekleyen iş" sayılmaz
    });
  });

  describe("anahtar okunamadı sınıfı", () => {
    it("🚨 (d) anahtar okunamazken vade İLERLEMEZ, sayaç artmaz; düzelince hepsi (vadesi gelmemiş olan dahil) ilk turda", async () => {
      const t0 = new Date();
      await seedLegacy(2, "k", (i) => new Date(t0.getTime() - [20 * MIN, 5 * MIN][i]), { error: KEY_ERROR });
      probe.result = "unreadable";
      const held = recordingDeliver();
      await replayPendingPaddleEvents({ deliver: held.deliver, now: t0 });
      const before = (await row("k_0")).nextAttemptAt;
      for (const h of [1, 5, 30]) {
        expect(await replayPendingPaddleEvents({ deliver: held.deliver, now: new Date(t0.getTime() + h * HOUR) })).toMatchObject({ heldForKey: 2, replayed: 0 });
      }
      expect(held.seen).toEqual([]);
      const k0 = await row("k_0");
      expect(k0.nextAttemptAt).toEqual(before);
      expect(k0.attemptCount).toBe(0);
      expect(await alertStateActive(PADDLE_REPLAY_KEY_ALERT)).toBe(true);

      probe.result = "ok";
      const healNow = new Date(t0.getTime() + 30 * HOUR + 1_000);
      const healed = recordingDeliver("all");
      expect(await replayPendingPaddleEvents({ deliver: healed.deliver, now: healNow })).toMatchObject({ replayed: 2, heldForKey: 0 });
      expect(healed.seen.sort()).toEqual(["k_0", "k_1"]);
      const after = await row("k_0");
      expect(after.attemptCount).toBe(1);
      expect(after.nextAttemptAt?.getTime()).toBe(nextPaddleReplayAt(after.createdAt, healNow)?.getTime());
    });

    it("anahtar okunamazken ÖTEKİ sınıfın satırı olağan çizelgede ilerler", async () => {
      const t0 = new Date();
      await seedLegacy(1, "k", () => new Date(t0.getTime() - 20 * MIN), { error: KEY_ERROR });
      await seedLegacy(1, "o", () => new Date(t0.getTime() - 20 * MIN));
      probe.result = "unreadable";
      const r = recordingDeliver("all");
      await replayPendingPaddleEvents({ deliver: r.deliver, now: t0 });
      expect(r.seen).toEqual(["o_0"]);
      expect((await row("o_0")).attemptCount).toBe(1);
      expect((await row("k_0")).attemptCount).toBe(0);
    });
  });

  describe("🚨 (a) kâhin: rastgele zaman çizelgelerinde eski kuralla AYNI küme; hiçbir aday vadesiz kalmaz", () => {
    it("tohumlu çizelgeler: her turda denenen küme = eski kuralın (son tur = önceki tur) kümesi", async () => {
      for (const seed of [11, 1118, 20261118]) {
        await prisma.webhookEvent.deleteMany({});
        await prisma.systemLock.deleteMany({ where: { name: { startsWith: "paddle-webhook-replay" } } });
        const rnd = seeded(seed);
        const start = Date.now() - 20 * 24 * HOUR; // geçmişte: işleyici gerçek saati kullanmıyor, tur anı parametre
        const created = new Map<string, Date>();
        let prev: Date | null = null;
        let t = start;
        let k = 0;
        let compared = 0;
        let nonEmpty = 0;
        for (let run = 0; run < 12; run++) {
          t += Math.floor(rnd() * (rnd() < 0.6 ? 2 * HOUR : 40 * HOUR)) + 1;
          const now = new Date(t);
          // Bu turdan önce alınmış yeni olaylar (önceki turla bu tur arasında; ilk turda daha eskiler de).
          const fresh = Math.floor(rnd() * 6);
          const rows = Array.from({ length: fresh }, () => {
            const lo = prev ? prev.getTime() : t - 300 * HOUR;
            const at = new Date(lo + Math.floor(rnd() * (t - lo)));
            const id = `r_${k++}`;
            created.set(id, at);
            return { provider: "paddle", eventType: "subscription.updated", providerEventId: id, payloadJson: JSON.stringify({ event_id: id, event_type: "subscription.updated", occurred_at: at.toISOString(), data: {} }), status: "error", error: "Error: x", createdAt: at };
          });
          if (rows.length) await prisma.webhookEvent.createMany({ data: rows });
          const { seen, deliver } = recordingDeliver("all");
          await replayPendingPaddleEvents({ deliver, now });
          const expected = [...created]
            .filter(([, c]) => c.getTime() >= now.getTime() - PADDLE_REPLAY_WINDOW_MS && paddleReplayDue(c, prev, now))
            .map(([id]) => id)
            .sort();
          expect(seen.sort(), `seed=${seed} run=${run}`).toEqual(expected);
          compared++;
          if (expected.length) nonEmpty++;
          // DEĞİŞMEZ: pencere içinde aday olup vadesi boş satır yalnız eşikleri TÜKENMİŞ satırdır.
          for (const r of await prisma.webhookEvent.findMany({ where: { createdAt: { gte: new Date(now.getTime() - PADDLE_REPLAY_WINDOW_MS) } } })) {
            if (r.nextAttemptAt === null) expect(nextPaddleReplayAt(r.createdAt, r.lastAttemptAt), `${r.providerEventId}`).toBeNull();
          }
          prev = now;
        }
        expect(compared).toBe(12);
        expect(nonEmpty).toBeGreaterThan(3);
      }
    });

    it("🚨 Paddle'ın kendi tekrarı vadesi boş satırı yeniden 'hata'ya düşürürse vade yeniden yazılır (inceleme → hata yolu)", async () => {
      // İnceleme bekleyen satır (vade boş) Paddle'dan yeniden gelir ve bu kez işlenirken fırlatır → olağan "hata" adayıdır, vadesi olmalı.
      await seedSub("sub_A", "active");
      subTransient.add("sub_A");
      const ev = subEvent("sub_B", "active", { created_at: "2026-11-04T10:02:00Z" });
      await prisma.webhookEvent.create({
        data: { provider: "paddle", eventType: ev.event_type, providerEventId: ev.event_id, payloadJson: JSON.stringify(ev), status: "error", error: `${NEEDS_REVIEW_PREFIX} unlinked`, createdAt: new Date(Date.now() - 3 * HOUR), attemptCount: 2, lastAttemptAt: new Date(Date.now() - 2 * HOUR) },
      });
      expect((await postEvent(ev)).status).toBe(500);
      const r = await row(ev.event_id);
      expect(r.status).toBe("error");
      expect(r.error?.startsWith(NEEDS_REVIEW_PREFIX)).toBe(false);
      expect(r.nextAttemptAt).not.toBeNull(); // ⬅️ boş kalsaydı (sayaç > 0, geçiş adımı da almaz) kalıcı kayıp
      expect(r.nextAttemptAt!.getTime()).toBe(r.createdAt.getTime() + 4 * HOUR); // şimdiki yaştan (3 sa) büyük ilk eşik
    });

    it("işlenmiş satırı başka bir yazıcı tekrar aday yapmaz: anahtar düzelme turunda eşikleri tükenmiş anahtar satırı da denenir", async () => {
      const now = new Date();
      const createdAt = new Date(now.getTime() - 300 * HOUR);
      await prisma.webhookEvent.create({
        data: { provider: "paddle", eventType: "subscription.updated", providerEventId: "kx", payloadJson: JSON.stringify({ event_id: "kx", data: {} }), status: "error", error: KEY_ERROR, createdAt, attemptCount: 10, lastAttemptAt: new Date(now.getTime() - 40 * HOUR) },
      });
      await alertOnTransition(PADDLE_REPLAY_KEY_ALERT, "paddle-api-read-unavailable", new Error("x"));
      probe.result = "ok";
      const r = recordingDeliver("all");
      await replayPendingPaddleEvents({ deliver: r.deliver, now });
      expect(r.seen).toEqual(["kx"]); // eski kuralda da düzelme turu o sınıfın HEPSİNİ geçirirdi
      expect((await row("kx")).nextAttemptAt).toBeNull();
    });
  });
});
