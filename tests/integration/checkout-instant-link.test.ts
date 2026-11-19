import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// ÖDEME DOĞRULANIR DOĞRULANMAZ PLAN AÇILIR (kurucu 11-18 akşam: "10 dakika bir bekleme kuralı olmamalı. Ödeme ekranı tamamlanınca Lixus işlem
// kimliğini alıp Paddle'dan hemen kontrol etmeli … plan bir kez etkinleşir"; Ö-2: "aynı işletme ve aynı satın alma doğrulanabiliyorsa Paddle'dan
// otomatik bağlansın; e-posta veya plan adı yetmez; belirsizse operatöre"). GERÇEK POSTGRESQL, gerçek bildirim işleyicisi + onay rotası +
// doğrulama ucu; Paddle istemcisi TAKLİT (işlem ve abonelik tabloları).
//
// Sabitlenen: (1) bildirim hiç gelmese de plan açılır, (2) kimlik üç bağla doğrulanır — biri tutmazsa HİÇBİR ŞEY yazılmaz, (3) bildirim ile
// okuma hangi sırayla / kaç kez gelirse gelsin plan bir kez yazılır, (4) anahtar kapalıyken uç yoktur ve süpürge bağlamaz.
// ---------------------------------------------------------------------------

type FakeSub = Record<string, unknown> & { id: string; status: string };
const { paddle } = vi.hoisted(() => ({
  paddle: {
    created: 0,
    /** `null` = Paddle okunamıyor (500); tabloda olmayan kimlik = bulunamadı (404). */
    txns: new Map<string, { status: string; subscription_id?: string | null; custom_data?: Record<string, unknown> | null; origin?: string } | null>(),
    subs: new Map<string, FakeSub | null>(),
    reads: [] as string[],
  },
}));
vi.mock("@/lib/payments/paddle", async (orig) => {
  const actual = await orig<typeof import("@/lib/payments/paddle")>();
  const request = vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
    if (path === "/transactions" && init?.method === "POST") {
      paddle.created += 1;
      const id = `txn_${paddle.created}`;
      const body = init.body as { custom_data?: Record<string, unknown> };
      paddle.txns.set(id, { status: "ready", subscription_id: null, custom_data: body.custom_data ?? null, origin: "api" });
      return { data: { id, status: "ready" } };
    }
    const t = path.match(/^\/transactions\/(txn_[A-Za-z0-9]+)$/);
    if (t) {
      const id = t[1]!;
      if (!paddle.txns.has(id)) throw new Error("Paddle HTTP 404 (entity_not_found) env=sandbox resource=transactions");
      const row = paddle.txns.get(id);
      if (row === null) throw new Error("Paddle HTTP 500 (internal) env=sandbox resource=transactions");
      paddle.reads.push(id);
      return { data: { id, ...row } };
    }
    const s = path.match(/^\/subscriptions\/(sub_[A-Za-z0-9]+)$/);
    if (s) {
      const id = s[1]!;
      if (!paddle.subs.has(id)) throw new Error("Paddle HTTP 404 (entity_not_found) env=sandbox resource=subscriptions");
      const row = paddle.subs.get(id);
      if (row === null) throw new Error("Paddle HTTP 500 (internal) env=sandbox resource=subscriptions");
      paddle.reads.push(id);
      return { data: { ...row } };
    }
    throw new Error(`beklenmeyen Paddle çağrısı ${path}`);
  });
  return {
    ...actual,
    paddleRequest: request,
    isPaddleConfigured: () => true,
    getSubscriptionStatus: vi.fn(async (id: string) => {
      try {
        const res = (await request(`/subscriptions/${id}`)) as { data?: { status?: string } };
        return { status: res.data?.status ?? null, customerId: null };
      } catch {
        return null;
      }
    }),
  };
});
let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn() }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: reportErrorMock };
});

import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { POST as webhook } from "@/app/api/webhooks/paddle/route";
import { POST as consentPost } from "@/app/api/billing/consent/route";
import { POST as verifyPost } from "@/app/api/billing/checkout-verify/route";
import { checkoutPendingLockName } from "@/lib/billing/checkout-pending";
import { sweepPaidCheckouts, PAID_CHECKOUT_ALERT_AFTER_MS } from "@/lib/billing/checkout-paid";
import { buildSubscriptionReadEvent, verifyAndLinkCheckout } from "@/lib/billing/checkout-verify";
import { CHECKOUT_CONSENT_FLAGS } from "../helpers/checkout-consent";

const SECRET = "test-webhook-hmac-key-not-a-real-secret";
const ctx = { params: Promise.resolve({} as Record<string, never>) };

function sign(body: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac("sha256", SECRET).update(`${ts}:${body}`, "utf8").digest("hex");
  return `ts=${ts};h1=${h1}`;
}
let evt = 0;
/** Paddle'ın GERÇEK bildirimi (imzalı) — olay zamanı verilebilir. */
async function postEvent(eventType: string, data: Record<string, unknown>, occurredAt = new Date()): Promise<number> {
  const body = JSON.stringify({ event_id: `evt_real_${++evt}`, event_type: eventType, occurred_at: occurredAt.toISOString(), data });
  const res = await webhook(
    new NextRequest("http://localhost/api/webhooks/paddle", { method: "POST", headers: { "content-type": "application/json", "paddle-signature": sign(body) }, body }),
  );
  return res.status;
}
type ConsentBody = { consentId?: string; transactionId?: string };
async function openCheckout(priceId = "pri_pro", planCode = "pro"): Promise<{ consentId: string; transactionId: string }> {
  const res = await consentPost(
    new NextRequest("http://localhost/api/billing/consent", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "TestBrowser/1.0" },
      body: JSON.stringify({ planCode, priceId, ...CHECKOUT_CONSENT_FLAGS }),
    }),
    ctx,
  );
  const body = (await res.json()) as ConsentBody;
  expect(res.status).toBe(201);
  return { consentId: body.consentId!, transactionId: body.transactionId! };
}
async function verify(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await verifyPost(
    new NextRequest("http://localhost/api/billing/checkout-verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    ctx,
  );
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
/** Paddle'daki abonelik nesnesi. */
const sub = (id: string, consentId: string | null, over: Record<string, unknown> = {}): FakeSub => ({
  id,
  status: "active",
  customer_id: "ctm_1",
  created_at: new Date(Date.now() - 5_000).toISOString(),
  updated_at: new Date(Date.now() - 4_000).toISOString(),
  custom_data: consentId ? { consentId } : null,
  items: [{ price: { id: "pri_pro" } }],
  ...over,
});
/** Paddle parayı aldı ve aboneliği kurdu. */
function paid(transactionId: string, subscriptionId: string | null, subObject?: FakeSub | null) {
  const t = paddle.txns.get(transactionId)!;
  t.status = "completed";
  t.subscription_id = subscriptionId;
  if (subscriptionId && subObject !== undefined) paddle.subs.set(subscriptionId, subObject);
}
const localSub = (org: string) => prisma.subscription.findUnique({ where: { organizationId: org } });
const intentOf = (org: string) => prisma.checkoutIntent.findFirst({ where: { organizationId: org }, orderBy: { createdAt: "asc" } });
const lockOf = (org: string) => prisma.systemLock.findUnique({ where: { name: checkoutPendingLockName(org) } });

describe("ödeme anında doğrulama + kendiliğinden bağlama", () => {
  let orgId = "";
  let ownerSession: SessionPayload;

  async function owner(name: string) {
    const org = (await prisma.organization.create({ data: { name } })).id;
    const user = (await prisma.user.create({ data: { organizationId: org, name, email: `${name}@x.com`, passwordHash: "x", role: "owner" } })).id;
    return { org, s: { userId: user, organizationId: org, role: "owner", email: `${name}@x.com`, name, sessionEpoch: 0 } as SessionPayload };
  }

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    reportErrorMock.mockResolvedValue({ notified: true, throttled: false, configured: true });
    paddle.created = 0;
    paddle.txns.clear();
    paddle.subs.clear();
    paddle.reads.length = 0;
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
    vi.stubEnv("PADDLE_PRICE_ISLETME", "pri_isletme");
    vi.stubEnv("PADDLE_CHECKOUT_INTENT_ENABLED", "1");
    vi.stubEnv("BILLING_INSTANT_LINK_ENABLED", "1");
    const o = await owner("a");
    orgId = o.org;
    ownerSession = o.s;
    session = o.s;
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 bildirim HİÇ gelmedi: ödeme ekranı tamamlanınca işlem + abonelik Paddle'dan okunur ve plan HEMEN açılır", async () => {
    const c = await openCheckout();
    paid(c.transactionId, "sub_1", sub("sub_1", c.consentId));
    const res = await verify({ consentId: c.consentId, transactionId: c.transactionId });
    expect(res).toEqual({ status: 200, json: { state: "active" } }); // yanıtta yalnız durum (teşhis kodu müşteriye gitmez)
    expect(await localSub(orgId)).toMatchObject({ provider: "paddle", providerRef: "sub_1", status: "active", planCode: "pro" });
    // Bekleyen ödeme kaydı kapandı; ödeme ↔ abonelik bağı satırda; kısa kilit kalktı.
    expect(await intentOf(orgId)).toMatchObject({ status: "fulfilled", subscriptionRef: "sub_1", providerRef: c.transactionId });
    expect(await lockOf(orgId)).toBeNull();
    // Planı açan bildirim işleyicisidir: okuma, olay günlüğünde kendi kimliğiyle "işlendi".
    const events = await prisma.webhookEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: "processed", eventType: "subscription.updated" });
    expect(events[0]!.providerEventId).toMatch(/^evt_lixusread_sub_1_\d+$/);
  });

  it("🚨 abonelik kimliği GEÇ geliyor (Paddle parayı aldı, aboneliği henüz kurmadı): 'bekliyor' + kalıcı 'ödeme alındı' kaydı; yeniden sorulunca açılır", async () => {
    const c = await openCheckout();
    paid(c.transactionId, null);
    expect((await verify({ consentId: c.consentId, transactionId: c.transactionId })).json).toEqual({ state: "awaiting" });
    expect(await localSub(orgId)).toBeNull();
    expect((await intentOf(orgId))!.status).toBe("completed"); // ödeme alındı, abonelik bekleniyor → ikinci ödeme ekranı açılmaz
    paid(c.transactionId, "sub_1", sub("sub_1", c.consentId));
    expect((await verify({ consentId: c.consentId, transactionId: c.transactionId })).json).toEqual({ state: "active" });
    expect((await localSub(orgId))!.providerRef).toBe("sub_1");
  });

  it("ödeme henüz alınmamış (işlem 'ready') → 'bekliyor'; kalıcı kayıt da abonelik de YAZILMAZ", async () => {
    const c = await openCheckout();
    expect((await verify({ consentId: c.consentId, transactionId: c.transactionId })).json).toEqual({ state: "awaiting" });
    expect(await localSub(orgId)).toBeNull();
    expect((await intentOf(orgId))!.status).toBe("open");
  });

  it("🚨 kimlik (b): işlem BAŞKA işletmenin onay kaydını taşıyor → hiçbir şey yazılmaz (iki işletmede de)", async () => {
    const mine = await openCheckout();
    const other = await owner("b");
    session = other.s;
    const theirs = await openCheckout();
    paid(theirs.transactionId, "sub_9", sub("sub_9", theirs.consentId));
    // A işletmesi KENDİ onayıyla B'nin ödenmiş işlemini gösteriyor.
    session = ownerSession;
    expect((await verify({ consentId: mine.consentId, transactionId: theirs.transactionId })).json).toEqual({ state: "awaiting" });
    expect(await localSub(orgId)).toBeNull();
    expect(await localSub(other.org)).toBeNull();
    expect((await intentOf(orgId))!.status).toBe("open");
    expect((await intentOf(other.org))!.status).toBe("open"); // B'nin kaydına da dokunulmadı
    expect(paddle.reads).not.toContain("sub_9"); // abonelik hiç okunmadı
  });

  it("🚨 kimlik (c): okunan abonelik BAŞKA bir onay kaydı taşıyor ya da kimliği işlemin aboneliği değil → bağlanmaz", async () => {
    const c = await openCheckout();
    paid(c.transactionId, "sub_1", sub("sub_1", "baska-onay-kaydi"));
    expect((await verify({ consentId: c.consentId, transactionId: c.transactionId })).json).toEqual({ state: "awaiting" });
    expect(await localSub(orgId)).toBeNull();
    paddle.subs.set("sub_1", sub("sub_2", c.consentId)); // nesnenin kimliği farklı
    expect((await verify({ consentId: c.consentId, transactionId: c.transactionId })).json).toEqual({ state: "awaiting" });
    expect(await localSub(orgId)).toBeNull();
    expect(await prisma.webhookEvent.count()).toBe(0); // işleyiciye hiçbir şey verilmedi
    expect((await intentOf(orgId))!.status).toBe("completed"); // ödeme görüldü: ikinci ödeme ekranı yine açılmaz, belirsizlik operatöre
  });

  it("abonelik nesnesi onay kimliğini hiç TAŞIMIYORSA da bağlanır: onay doğrulanmış işlemden gelir (işlem ↔ abonelik bağı Paddle'dan okundu)", async () => {
    const c = await openCheckout();
    paid(c.transactionId, "sub_1", sub("sub_1", null));
    expect((await verify({ consentId: c.consentId, transactionId: c.transactionId })).json).toEqual({ state: "active" });
    expect((await localSub(orgId))!.providerRef).toBe("sub_1");
  });

  it("🚨 Paddle okunamıyor (işlem ya da abonelik) → 'doğrulanamadı', hiçbir şey açılmaz; bulunamayan işlem de aynı", async () => {
    const c = await openCheckout();
    const saved = paddle.txns.get(c.transactionId)!;
    paddle.txns.set(c.transactionId, null);
    expect((await verify({ consentId: c.consentId, transactionId: c.transactionId })).json).toEqual({ state: "unverified" });
    expect((await verify({ consentId: c.consentId, transactionId: "txn_yok" })).json).toEqual({ state: "unverified" });
    paddle.txns.set(c.transactionId, saved);
    paid(c.transactionId, "sub_1", null); // abonelik okunamıyor
    expect((await verify({ consentId: c.consentId, transactionId: c.transactionId })).json).toEqual({ state: "unverified" });
    expect(await localSub(orgId)).toBeNull();
  });

  it("🚨 işleyicinin kuralı geçerli: aboneliğin fiyatı onaylanan fiyat değilse BAĞLANMAZ ('bekliyor'), operatöre alarm", async () => {
    const c = await openCheckout(); // pri_pro onaylandı
    paid(c.transactionId, "sub_1", sub("sub_1", c.consentId, { items: [{ price: { id: "pri_isletme" } }] }));
    expect((await verify({ consentId: c.consentId, transactionId: c.transactionId })).json).toEqual({ state: "awaiting" });
    expect(await localSub(orgId)).toBeNull();
    expect((await intentOf(orgId))!.status).toBe("completed");
    expect((await prisma.webhookEvent.findFirstOrThrow()).status).toBe("error"); // inceleme: "bağlanamadı"
  });

  it("hak tanımayan abonelik durumu (duraklatılmış) → işleyici yazar ama plan 'açık' denmez", async () => {
    const c = await openCheckout();
    paid(c.transactionId, "sub_1", sub("sub_1", c.consentId, { status: "paused" }));
    expect((await verify({ consentId: c.consentId, transactionId: c.transactionId })).json).toEqual({ state: "awaiting" });
  });

  it("🚨 bildirim ÖNCE geldiyse okuma hiçbir şeyi yeniden yazmaz: abonelik nesnesi okunmaz, 'açık' döner", async () => {
    const c = await openCheckout();
    paid(c.transactionId, "sub_1", sub("sub_1", c.consentId));
    expect(await postEvent("subscription.created", sub("sub_1", c.consentId))).toBe(200);
    paddle.reads.length = 0;
    expect((await verify({ consentId: c.consentId, transactionId: c.transactionId })).json).toEqual({ state: "active" });
    expect(paddle.reads).toEqual([c.transactionId]); // yalnız işlem okundu
    expect(await prisma.subscription.count()).toBe(1);
    expect(await prisma.webhookEvent.count()).toBe(1); // yalnız gerçek bildirim
  });

  it("🚨 plan BİR KEZ etkinleşir: okuma iki kez + aynı anda iki okuma + ardından Paddle'ın (daha eski zamanlı) gerçek bildirimi → tek abonelik, durum aynı", async () => {
    const c = await openCheckout();
    paid(c.transactionId, "sub_1", sub("sub_1", c.consentId));
    const [a, b] = await Promise.all([
      verifyAndLinkCheckout({ organizationId: orgId, consentId: c.consentId, transactionId: c.transactionId }),
      verifyAndLinkCheckout({ organizationId: orgId, consentId: c.consentId, transactionId: c.transactionId }),
    ]);
    expect([a.state, b.state].sort()).toEqual(["active", "active"]);
    expect((await verify({ consentId: c.consentId, transactionId: c.transactionId })).json).toEqual({ state: "active" });
    const before = await localSub(orgId);
    // Paddle'ın gecikmiş "oluşturuldu" bildirimi (olay zamanı okunan güncellemeden ESKİ) sonradan geliyor.
    expect(await postEvent("subscription.created", sub("sub_1", c.consentId), new Date(Date.now() - 60_000))).toBe(200);
    expect(await prisma.subscription.count()).toBe(1);
    expect(await localSub(orgId)).toMatchObject({ providerRef: "sub_1", status: "active", planCode: "pro", lastEventAt: before!.lastEventAt });
    expect(await prisma.checkoutIntent.count({ where: { organizationId: orgId, status: "fulfilled" } })).toBe(1);
  });

  it("Paddle'ın DAHA YENİ bildirimi okumadan sonra gelirse uygulanır (sıra koruması gerçek olayı düşürmez)", async () => {
    const c = await openCheckout();
    paid(c.transactionId, "sub_1", sub("sub_1", c.consentId));
    expect((await verify({ consentId: c.consentId, transactionId: c.transactionId })).json).toEqual({ state: "active" });
    expect(await postEvent("subscription.updated", sub("sub_1", c.consentId, { status: "past_due" }), new Date(Date.now() + 1_000))).toBe(200);
    expect((await localSub(orgId))!.status).toBe("past_due");
  });

  it("olay gövdesi: kimlik abonelik + son güncelleme anından; onay doğrulanmış işlemden; nesnenin öteki alanları aynen", () => {
    const at = new Date("2026-11-19T10:00:00.000Z");
    const object = sub("sub_7", null, { updated_at: "2026-11-19T09:59:58.500Z", custom_data: { kampanya: "x" } });
    const { eventId, body } = buildSubscriptionReadEvent(object, "onay-1", at);
    expect(eventId).toBe(`evt_lixusread_sub_7_${Date.parse("2026-11-19T09:59:58.500Z")}`);
    const parsed = JSON.parse(body) as { event_id: string; event_type: string; occurred_at: string; data: Record<string, unknown> };
    expect(parsed).toMatchObject({ event_id: eventId, event_type: "subscription.updated", occurred_at: "2026-11-19T09:59:58.500Z" });
    expect(parsed.data).toMatchObject({ id: "sub_7", status: "active", custom_data: { kampanya: "x", consentId: "onay-1" }, items: [{ price: { id: "pri_pro" } }] });
    // Güncelleme anı yoksa / bozuksa okuma anı kullanılır.
    expect(buildSubscriptionReadEvent(sub("sub_7", null, { updated_at: "bozuk" }), "onay-1", at).eventId).toBe(`evt_lixusread_sub_7_${at.getTime()}`);
  });

  describe("uç — kapılar", () => {
    it("🚨 anahtar KAPALI → uç yok (404), Paddle okunmaz, hiçbir şey yazılmaz", async () => {
      vi.stubEnv("BILLING_INSTANT_LINK_ENABLED", "");
      const c = await openCheckout();
      paid(c.transactionId, "sub_1", sub("sub_1", c.consentId));
      paddle.reads.length = 0;
      expect((await verify({ consentId: c.consentId, transactionId: c.transactionId })).status).toBe(404);
      expect(paddle.reads).toEqual([]);
      expect(await localSub(orgId)).toBeNull();
    });

    it("başka işletmenin onay kaydı → 404; eski onay (3 saatten eski) → 400; biçimsiz işlem kimliği → 400 — Paddle okunmaz", async () => {
      const c = await openCheckout();
      paid(c.transactionId, "sub_1", sub("sub_1", c.consentId));
      const other = await owner("b");
      session = other.s;
      paddle.reads.length = 0;
      expect((await verify({ consentId: c.consentId, transactionId: c.transactionId })).status).toBe(404);
      session = ownerSession;
      expect((await verify({ consentId: c.consentId, transactionId: "../transactions/txn_1" })).status).toBe(400);
      expect((await verify({ consentId: c.consentId })).status).toBe(400);
      await prisma.checkoutConsent.update({ where: { id: c.consentId }, data: { createdAt: new Date(Date.now() - 3 * 60 * 60_000 - 1_000) } });
      expect((await verify({ consentId: c.consentId, transactionId: c.transactionId })).status).toBe(400);
      expect(paddle.reads).toEqual([]);
      expect(await localSub(orgId)).toBeNull();
    });

    it("uç kısa kilidi de yazar (sunucu ödemeyi görene kadar ikinci sekme ödeme ekranı açmasın)", async () => {
      const c = await openCheckout();
      expect((await verify({ consentId: c.consentId, transactionId: c.transactionId })).json).toEqual({ state: "awaiting" });
      expect((await lockOf(orgId))?.holder).toBe(c.consentId);
    });
  });

  describe("saatlik süpürge — bildirimi hiç gelmeyen ödeme kendiliğinden bağlanır (Ö-2)", () => {
    /** Ödeme sunucuca görülmüş (işlem bildirimi geldi), abonelik bildirimi kayıp; kayıt 15 dakikadan eski. */
    async function awaitingPayment() {
      const c = await openCheckout();
      paid(c.transactionId, "sub_1", sub("sub_1", c.consentId));
      expect(
        await postEvent("transaction.completed", {
          id: c.transactionId,
          status: "completed",
          origin: "api",
          subscription_id: "sub_1",
          customer_id: "ctm_1",
          currency_code: "TRY",
          details: { totals: { grand_total: "44900" } },
          custom_data: { consentId: c.consentId },
        }),
      ).toBe(200);
      await prisma.checkoutIntent.updateMany({ where: { organizationId: orgId }, data: { closedAt: new Date(Date.now() - PAID_CHECKOUT_ALERT_AFTER_MS - 60_000) } });
      expect((await intentOf(orgId))!.status).toBe("completed");
      return c;
    }
    const alarms = () => reportErrorMock.mock.calls.filter(([context]) => context === "paddle-paid-not-linked");

    it("🚨 anahtar AÇIK: süpürge aboneliği Paddle'dan okuyup bağlar; operatör alarmı YOK", async () => {
      await awaitingPayment();
      expect(await sweepPaidCheckouts()).toMatchObject({ checked: 1, closed: 1, alerted: 0 });
      expect(await localSub(orgId)).toMatchObject({ providerRef: "sub_1", status: "active", planCode: "pro" });
      expect((await intentOf(orgId))!.status).toBe("fulfilled");
      expect(alarms()).toHaveLength(0);
    });

    it("KONTROL: anahtar KAPALI → süpürge bağlamaz, bugünkü gibi operatöre alarm verir", async () => {
      await awaitingPayment();
      vi.stubEnv("BILLING_INSTANT_LINK_ENABLED", "");
      expect(await sweepPaidCheckouts()).toMatchObject({ checked: 1, closed: 0, alerted: 1 });
      expect(await localSub(orgId)).toBeNull();
      expect(alarms()).toHaveLength(1);
    });

    it("🚨 belirsizse operatöre: abonelik başka bir onay kaydı taşıyorsa süpürge bağlamaz, alarm verir", async () => {
      await awaitingPayment();
      paddle.subs.set("sub_1", sub("sub_1", "baska-onay-kaydi"));
      expect(await sweepPaidCheckouts()).toMatchObject({ checked: 1, closed: 0, alerted: 1 });
      expect(await localSub(orgId)).toBeNull();
    });
  });
});
