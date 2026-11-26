import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// "ÖDEME ALINDI, ABONELİK BEKLENİYOR" KALICI DURUMU (Codex 11-17, 1. bulgu; tasarım
// `docs/TASARIM-2026-11-18-odeme-alindi-abonelik-bekleniyor.md`) — GERÇEK POSTGRESQL, gerçek web kancası + onay rotası, Paddle istemcisi TAKLİT.
//
// Açık (ölçüldü): Paddle ödemeyi almış ama abonelik hesaba henüz bağlanmamışsa "ödeme alındı" bilgisi yalnız 10 dakikalık kilitte
// yaşıyordu → kilit düşünce aynı işletmeye YENİ ödeme işlemi açılıyordu. Niyet kapalı kipte (açılış varsayılanı) işlem olayı hiçbir şey
// yazmıyordu (kilidi yalnız istemci yazıyordu).
// ---------------------------------------------------------------------------

/** Taklit Paddle: işlem ve abonelik tabloları (GET), işlem açma (POST), iptal (PATCH). */
const { paddle } = vi.hoisted(() => ({
  paddle: {
    created: 0,
    /** `null` değerli kayıt = Paddle okunamıyor (500); tabloda olmayan kimlik = bulunamadı (404). */
    txns: new Map<string, { status: string; subscription_id?: string | null; custom_data?: Record<string, unknown> | null; origin?: string } | null>(),
    subs: new Map<string, { status: string } | null>(),
    /** İşlem başına Paddle iade kayıtları (adjustment). `null` = iade listesi okunamıyor (500). */
    adjustments: new Map<string, Array<Record<string, unknown>> | null>(),
    /** İşlem başına HAM iade yanıtı (200 ama biçimi bozuk) — varsa `adjustments`ın önüne geçer. */
    adjustmentsRaw: new Map<string, unknown>(),
    reads: [] as string[],
    /** Paddle'a giden HER çağrının yolu (biçimsiz kimlikle çağrı yapılmadığını göstermek için). */
    calls: [] as string[],
    /** "İşlem aç" çağrısı dönmeden hemen önce bir kez çalışır (dış çağrı sürerken olan olayı kurmak için). */
    onCreate: null as null | (() => Promise<void>),
    /** İşlem OKUMASI (GET) dönmeden hemen önce bir kez çalışır (uzlaştırma Paddle'ı okurken başka işlemin kaydı değiştirmesi — K9). */
    onTxnRead: null as null | (() => Promise<void>),
    onTxnReadRan: 0,
  },
}));
// Onay kapısının "bekleyen ödeme var mı" bakışından hemen SONRA bir kez çalışır (yarış penceresi: kapı geçildi, ödeme o arada tamamlandı).
const { gate } = vi.hoisted(() => ({
  gate: {
    afterBlockCheck: null as null | (() => Promise<void>),
    /** Bir kez: abonelik olayının kaydı kapatma adımı düşer (veritabanı arızası taklidi). */
    failFulfilOnce: false,
    /** Bir kez: işlem olayının kayıt yazımı düşer. */
    failRecordOnce: false,
  },
}));
vi.mock("@/lib/billing/checkout-paid", async (orig) => {
  const actual = await orig<typeof import("@/lib/billing/checkout-paid")>();
  return {
    ...actual,
    paidCheckoutBlock: vi.fn(async (...args: Parameters<typeof actual.paidCheckoutBlock>) => {
      const out = await actual.paidCheckoutBlock(...args);
      const hook = gate.afterBlockCheck;
      gate.afterBlockCheck = null;
      if (hook) await hook();
      return out;
    }),
    // Kapanış artık abonelik yazımının İŞLEMİ içinde (Codex 11-25): arıza işlem içinden verilir.
    fulfilPaidCheckoutsInTx: vi.fn(async (...args: Parameters<typeof actual.fulfilPaidCheckoutsInTx>) => {
      if (gate.failFulfilOnce) {
        gate.failFulfilOnce = false;
        throw new Error("kayıt kapatılamadı (test)");
      }
      return actual.fulfilPaidCheckoutsInTx(...args);
    }),
    recordPaidCheckout: vi.fn(async (...args: Parameters<typeof actual.recordPaidCheckout>) => {
      if (gate.failRecordOnce) {
        gate.failRecordOnce = false;
        throw new Error("kayıt yazılamadı (test)");
      }
      return actual.recordPaidCheckout(...args);
    }),
  };
});
vi.mock("@/lib/payments/paddle", async (orig) => {
  const actual = await orig<typeof import("@/lib/payments/paddle")>();
  const request = vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
    paddle.calls.push(path);
    if (path === "/transactions" && init?.method === "POST") {
      paddle.created += 1;
      const id = `txn_${paddle.created}`;
      const body = init.body as { custom_data?: Record<string, unknown> };
      paddle.txns.set(id, { status: "ready", subscription_id: null, custom_data: body.custom_data ?? null, origin: "api" });
      const hook = paddle.onCreate;
      paddle.onCreate = null;
      if (hook) await hook();
      return { data: { id, status: "ready" } };
    }
    const t = path.match(/^\/transactions\/(txn_[A-Za-z0-9]+)$/);
    if (t) {
      const id = t[1]!;
      if (!paddle.txns.has(id)) throw new Error("Paddle HTTP 404 (entity_not_found) env=sandbox resource=transactions");
      const row = paddle.txns.get(id);
      if (row === null) throw new Error("Paddle HTTP 500 (internal) env=sandbox resource=transactions");
      if (init?.method === "PATCH") {
        if (row!.status !== "ready") throw new Error("Paddle HTTP 400 (transaction_immutable) env=sandbox resource=transactions");
        row!.status = "canceled";
        return { data: { id, status: "canceled" } };
      }
      paddle.reads.push(id);
      const readHook = paddle.onTxnRead;
      paddle.onTxnRead = null;
      if (readHook) {
        paddle.onTxnReadRan++;
        await readHook();
      }
      return { data: { id, ...row } };
    }
    const adj = path.match(/^\/adjustments\?(.*)$/);
    if (adj) {
      const q = new URLSearchParams(adj[1]);
      const txnId = q.get("transaction_id") ?? "";
      if (paddle.adjustmentsRaw.has(txnId)) return paddle.adjustmentsRaw.get(txnId);
      const list = paddle.adjustments.get(txnId);
      if (list === null) throw new Error("Paddle HTTP 500 (internal) env=sandbox resource=adjustments");
      // Gerçek Paddle gibi: süzgeç sunucuda (işlem + eylem); taklit süzgeci uygulamaz → kod kendi kontrolünü yapmalı (yabancı satır da döner).
      return { data: list ?? [] };
    }
    const s = path.match(/^\/subscriptions\/(sub_[A-Za-z0-9]+)$/);
    if (s) {
      const id = s[1]!;
      if (!paddle.subs.has(id)) throw new Error("Paddle HTTP 404 (entity_not_found) env=sandbox resource=subscriptions");
      const row = paddle.subs.get(id);
      if (row === null) throw new Error("Paddle HTTP 500 (internal) env=sandbox resource=subscriptions");
      paddle.reads.push(id);
      return { data: { id, ...row } };
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
import { checkoutPendingLockName } from "@/lib/billing/checkout-pending";
import { POST as pendingPost } from "@/app/api/billing/checkout-pending/route";
import { completeCheckoutIntent, sweepCheckoutIntents } from "@/lib/billing/checkout-intent";
import {
  paidCheckoutAlertKey,
  paidCheckoutAwaiting,
  paidCheckoutsAwaitingSummary,
  reconcilePaidCheckout,
  recordPaidCheckout,
  releasePaidCheckoutByOperator,
  sweepPaidCheckouts, __checkoutPaidHooks } from "@/lib/billing/checkout-paid";
import { CHECKOUT_PAID_AWAITING_MESSAGE, CHECKOUT_PENDING_MESSAGE } from "@/lib/billing/checkout-pending-shared";
import { CHECKOUT_CONSENT_FLAGS } from "../helpers/checkout-consent";

const SECRET = "test-webhook-hmac-key-not-a-real-secret";
const ctx = { params: Promise.resolve({} as Record<string, never>) };
const MIN = 60_000;

function sign(body: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac("sha256", SECRET).update(`${ts}:${body}`, "utf8").digest("hex");
  return `ts=${ts};h1=${h1}`;
}
let evt = 0;
async function postEvent(eventType: string, data: Record<string, unknown>, ageMs = 1_000): Promise<number> {
  const body = JSON.stringify({ event_id: `evt_${++evt}`, event_type: eventType, occurred_at: new Date(Date.now() - ageMs + evt).toISOString(), data });
  const res = await webhook(
    new NextRequest("http://localhost/api/webhooks/paddle", {
      method: "POST",
      headers: { "content-type": "application/json", "paddle-signature": sign(body) },
      body,
    }),
  );
  return res.status;
}
const consentReq = (priceId = "pri_pro", planCode = "pro") =>
  new NextRequest("http://localhost/api/billing/consent", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "TestBrowser/1.0" },
    body: JSON.stringify({ planCode, priceId, ...CHECKOUT_CONSENT_FLAGS }),
  });
type ConsentBody = { consentId?: string; transactionId?: string; error?: string; fields?: Record<string, string> };
async function openCheckout(): Promise<{ status: number; body: ConsentBody; text: string }> {
  const res = await consentPost(consentReq(), ctx);
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as ConsentBody, text };
}

/** İşlem olayının gövdesi (Paddle `transaction.*`). */
const txnData = (id: string, consentId: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  status: "completed",
  origin: "web",
  subscription_id: null,
  customer_id: "ctm_1",
  currency_code: "TRY",
  details: { totals: { grand_total: "44900" } },
  custom_data: consentId ? { consentId } : null,
  ...extra,
});
/** Abonelik olayının gövdesi (Paddle `subscription.*`). */
const subData = (id: string, status: string, consentId: string | null) => ({
  id,
  status,
  customer_id: "ctm_1",
  custom_data: consentId ? { consentId } : null,
  items: [{ price: { id: "pri_pro" } }],
});

/** "10 dakikalık kilit düştü" — kilit satırının süresi geçmişe çekilir (kilit hiç yazılmadıysa hiçbir şey yapmaz). */
async function expireLock(org: string): Promise<void> {
  await prisma.systemLock.updateMany({ where: { name: checkoutPendingLockName(org) }, data: { lockedUntil: new Date(Date.now() - 1_000) } });
}

const pendingReq = (body: unknown) =>
  new NextRequest("http://localhost/api/billing/checkout-pending", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ALARM = "paddle-paid-not-linked";
const alarms = () => reportErrorMock.mock.calls.filter(([context]) => context === ALARM);
const intentOf = (org: string) => prisma.checkoutIntent.findFirst({ where: { organizationId: org }, orderBy: { createdAt: "asc" } });
const alertRow = (intentId: string) => prisma.systemLock.findUnique({ where: { name: `alert-state:${paidCheckoutAlertKey(intentId)}` } });

describe("ödeme alındı, abonelik bekleniyor — süreyle kapanmayan durum", () => {
  let orgId = "";

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
    paddle.adjustments.clear();
    paddle.adjustmentsRaw.clear();
    paddle.reads.length = 0;
    paddle.calls.length = 0;
    paddle.onCreate = null;
    paddle.onTxnRead = null;
    paddle.onTxnReadRan = 0;
    Object.assign(gate, { afterBlockCheck: null, failFulfilOnce: false, failRecordOnce: false });
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
    vi.stubEnv("PADDLE_PRICE_ISLETME", "pri_isletme");
    const o = await owner("a");
    orgId = o.org;
    session = o.s;
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("niyet anahtarı AÇIK (işlemi sunucu açar)", () => {
    beforeEach(() => vi.stubEnv("PADDLE_CHECKOUT_INTENT_ENABLED", "1"));

    it("🚨 Codex senaryosu: işlem ödendi, abonelik olayı gelmedi, 10 dk kilit düştü → yeni ödeme işlemi AÇILMAZ", async () => {
      const first = await openCheckout();
      expect(first.status).toBe(201);
      expect(first.body.transactionId).toBe("txn_1");
      paddle.txns.get("txn_1")!.status = "completed";
      expect(await postEvent("transaction.completed", txnData("txn_1", first.body.consentId!, { origin: "api" }))).toBe(200);
      // Abonelik olayı hiç gelmiyor; kilit süresi doluyor.
      await expireLock(orgId);

      const again = await openCheckout();
      expect(again.status).toBe(400);
      expect(again.text).toMatch(/Ödemeniz/);
      expect(paddle.created).toBe(1); // Paddle'da ikinci işlem yok
      // Bir gün sonra da aynı (süreyle kapanmaz).
      await prisma.checkoutIntent.updateMany({ where: { organizationId: orgId }, data: { closedAt: new Date(Date.now() - 26 * 60 * MIN) } });
      expect((await openCheckout()).status).toBe(400);
      expect(paddle.created).toBe(1);
    });

    it("metin: ilk 10 dakika 'işleniyor', sonrası 'alındı, henüz tanımlanmadı' (yeniden ödeme yapmayın)", async () => {
      const first = await openCheckout();
      paddle.txns.get("txn_1")!.status = "completed";
      await postEvent("transaction.completed", txnData("txn_1", first.body.consentId!, { origin: "api" }));
      await expireLock(orgId);
      expect((await openCheckout()).text).toContain(CHECKOUT_PENDING_MESSAGE);
      await prisma.checkoutIntent.updateMany({ where: { organizationId: orgId }, data: { closedAt: new Date(Date.now() - 11 * MIN) } });
      const late = await openCheckout();
      expect(late.text).toContain(CHECKOUT_PAID_AWAITING_MESSAGE);
      expect(late.text).not.toContain(CHECKOUT_PENDING_MESSAGE);
    });

    it("abonelik olayı (aynı onay) hesaba yazılınca kayıt 'bağlandı' olur; abonelik sonra iptal edilirse yeni ödeme YENİ işlemle açılır", async () => {
      const first = await openCheckout();
      paddle.txns.get("txn_1")!.status = "completed";
      await postEvent("transaction.completed", txnData("txn_1", first.body.consentId!, { origin: "api" }));
      expect((await intentOf(orgId))!.status).toBe("completed");
      expect(await postEvent("subscription.created", subData("sub_1", "active", first.body.consentId!))).toBe(200);
      expect((await intentOf(orgId))!.status).toBe("fulfilled");
      // Canlı abonelik varken engel "zaten aktif abonelik" (ödeme bekleme metni değil).
      const live = await openCheckout();
      expect(live.status).toBe(400);
      expect(live.text).toMatch(/zaten aktif/);
      await postEvent("subscription.canceled", subData("sub_1", "canceled", first.body.consentId!));
      const again = await openCheckout();
      expect(again.status).toBe(201);
      expect(again.body.transactionId).toBe("txn_2");
    });

    it("abonelik olayı işlem olayından ÖNCE gelirse açık niyet doğrudan 'bağlandı' olur; geç gelen işlem olayı bekleyen kayıt AÇMAZ", async () => {
      const first = await openCheckout();
      await postEvent("subscription.created", subData("sub_1", "active", first.body.consentId!));
      const row = (await intentOf(orgId))!;
      expect(row.status).toBe("fulfilled");
      expect(row.openKey).toBeNull();
      paddle.txns.get("txn_1")!.status = "completed";
      await postEvent("transaction.completed", txnData("txn_1", first.body.consentId!, { origin: "api", subscription_id: "sub_1" }));
      expect(await prisma.checkoutIntent.count({ where: { organizationId: orgId, status: "completed" } })).toBe(0);
      await postEvent("subscription.canceled", subData("sub_1", "canceled", first.body.consentId!));
      expect((await openCheckout()).body.transactionId).toBe("txn_2");
    });

    it("🚨 süresi dolup iptali doğrulanamadan KAPANMIŞ niyetin işlemi sonradan ödenirse de kayıt 'ödeme alındı' olur → yeni işlem açılmaz", async () => {
      const first = await openCheckout();
      // Niyet "süresi doldu" diye kapanmış (iptal doğrulanamadı — işlem Paddle'da hâlâ ödenebilir durumda kaldı).
      await prisma.checkoutIntent.updateMany({ where: { organizationId: orgId }, data: { status: "expired", openKey: null, closedAt: new Date() } });
      paddle.txns.get("txn_1")!.status = "completed";
      await postEvent("transaction.completed", txnData("txn_1", first.body.consentId!, { origin: "api" }));
      expect((await intentOf(orgId))!.status).toBe("completed");
      await expireLock(orgId);
      expect((await openCheckout()).status).toBe(400);
      expect(paddle.created).toBe(1);
    });

    // Mutasyon 11-18 (I2): web kancasında kaydı İKİ adım yazar (niyet adımı + defter adımı). Defter adımı onay kimliği ister; olay onu
    // taşımıyorsa (ya da o adım düşerse) kapanmış niyeti "ödeme alındı"ya çeviren TEK yer niyet adımıdır — tek başına sınanır.
    it.each(["expired", "canceled"])("🚨 niyet adımı TEK BAŞINA: '%s' diye kapanmış niyetin işlemi ödenince kayıt 'ödeme alındı' olur", async (closedAs) => {
      await openCheckout();
      await prisma.checkoutIntent.updateMany({ where: { organizationId: orgId }, data: { status: closedAs, openKey: null, closedAt: new Date() } });
      await completeCheckoutIntent("txn_1");
      expect((await intentOf(orgId))!.status).toBe("completed");
      expect(await paidCheckoutAwaiting(orgId)).not.toBeNull();
      await expireLock(orgId);
      expect((await openCheckout()).status).toBe(400);
      expect(paddle.created).toBe(1);
    });

    it("🚨 kapanmış niyetin işlemi ödenirken müşteri YENİ bir ödeme ekranı açmışsa: o açık işlem Paddle'da iptal edilir ve niyeti kapanır", async () => {
      const first = await openCheckout();
      await prisma.checkoutIntent.updateMany({ where: { organizationId: orgId }, data: { status: "expired", openKey: null, closedAt: new Date() } });
      const second = await openCheckout();
      expect(second.body.transactionId).toBe("txn_2"); // yeni ekran açıldı (eski işlem kapanmış sayılıyordu)
      paddle.txns.get("txn_1")!.status = "completed";
      await postEvent("transaction.completed", txnData("txn_1", first.body.consentId!, { origin: "api" }));
      expect(paddle.txns.get("txn_2")!.status).toBe("canceled");
      const rows = await prisma.checkoutIntent.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" } });
      expect(rows.map((r) => [r.providerRef, r.status, r.openKey])).toEqual([
        ["txn_1", "completed", null],
        ["txn_2", "canceled", null],
      ]);
    });

    it("🚨 YARIŞ: onay kapısı 'bekleyen ödeme yok' gördükten SONRA ödeme tamamlanırsa (kilit de yoksa) yer boşalsa da yeni Paddle işlemi AÇILMAZ", async () => {
      const first = await openCheckout(); // ilk sekme ödeme ekranında (txn_1)
      gate.afterBlockCheck = async () => {
        // İkinci sekmenin isteği kapıdan geçti; tam o anda ilk sekmenin ödemesi tamamlanıyor ve kilit yok (yazılamadı / düştü).
        paddle.txns.get("txn_1")!.status = "completed";
        await postEvent("transaction.completed", txnData("txn_1", first.body.consentId!, { origin: "api" }));
        await prisma.systemLock.deleteMany({ where: { name: checkoutPendingLockName(orgId) } });
      };
      const second = await openCheckout();
      expect(second.status).toBe(400);
      expect(paddle.created).toBe(1);
      expect(await prisma.checkoutIntent.count({ where: { organizationId: orgId, status: { in: ["open", "opening"] } } })).toBe(0);
    });

    it("Paddle işlemi açılırken (dış çağrı sürerken) işletmenin eski işlemi ödenirse yeni işlem istemciye VERİLMEZ ve iptal edilir", async () => {
      const first = await openCheckout();
      await prisma.checkoutIntent.updateMany({ where: { organizationId: orgId }, data: { status: "expired", openKey: null, closedAt: new Date() } });
      // İkinci sekme yeni işlem açıyor; Paddle'ın "işlem aç" çağrısı dönerken eski işlemin ödeme olayı işleniyor.
      paddle.onCreate = async () => {
        paddle.txns.get("txn_1")!.status = "completed";
        await postEvent("transaction.completed", txnData("txn_1", first.body.consentId!, { origin: "api" }));
      };
      const second = await openCheckout();
      expect(second.status).toBe(400);
      expect(second.body.transactionId).toBeUndefined();
      expect(paddle.txns.get("txn_2")!.status).toBe("canceled");
      expect(await prisma.checkoutIntent.count({ where: { organizationId: orgId, status: { in: ["open", "opening"] } } })).toBe(0);
    });

    it("niyet yolundan dönen 'ödendi' de ödemenin yaşına göre metin seçer (eski ödemede 'birkaç dakika' denmez)", async () => {
      const first = await openCheckout();
      // Açık niyetin işlemi Paddle'da çoktan ödenmiş; sunucu bunu onay isteği sırasında görüyor.
      paddle.txns.get("txn_1")!.status = "completed";
      const now = await openCheckout();
      expect(now.status).toBe(400);
      expect(now.text).toContain(CHECKOUT_PENDING_MESSAGE);
      expect(first.body.transactionId).toBe("txn_1");
    });

    it("yarışta görülen ödeme ESKİ bir ödemeyse (geç gelen kayıt) metin 'alındı, henüz tanımlanmadı' olur", async () => {
      const consent = await prisma.checkoutConsent.create({ data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "v" } });
      gate.afterBlockCheck = async () => {
        // Kapı geçildikten sonra, 20 dakika önce alınmış bir ödemenin kaydı beliriyor (olay geç işlendi).
        await prisma.checkoutIntent.create({
          data: { organizationId: orgId, consentId: consent.id, planCode: "pro", priceId: "pri_pro", providerRef: "txn_gec", status: "completed", expiresAt: new Date(), closedAt: new Date(Date.now() - 20 * MIN) },
        });
      };
      const res = await openCheckout();
      expect(res.status).toBe(400);
      expect(res.text).toContain(CHECKOUT_PAID_AWAITING_MESSAGE);
      expect(paddle.created).toBe(0);
    });

    it("istemci 'tamamlandı' sinyali: sunucu KENDİ açtığı işlemi Paddle'dan okur (kimlik istemciden gelmez) → ödenmişse kayıt hemen 'ödeme alındı'", async () => {
      const first = await openCheckout();
      paddle.txns.get("txn_1")!.status = "completed";
      expect((await pendingPost(pendingReq({ consentId: first.body.consentId }), ctx)).status).toBe(200);
      expect((await intentOf(orgId))!.status).toBe("completed");
      await expireLock(orgId);
      expect((await openCheckout()).status).toBe(400);
      expect(paddle.created).toBe(1);
    });

    it("KONTROL: istemci sinyali geldi ama işlem Paddle'da ödenmemiş → niyet açık kalır (kalıcı kayıt yok)", async () => {
      const first = await openCheckout();
      await pendingPost(pendingReq({ consentId: first.body.consentId }), ctx);
      expect((await intentOf(orgId))!.status).toBe("open");
    });

    it("açık işlem iptal EDİLEMİYORSA (ödemesi başlamış olabilir) niyeti açık kalır — yer yanlışlıkla boşaltılmaz", async () => {
      const first = await openCheckout();
      await prisma.checkoutIntent.updateMany({ where: { organizationId: orgId }, data: { status: "expired", openKey: null, closedAt: new Date() } });
      await openCheckout(); // txn_2 açık
      paddle.txns.get("txn_2")!.status = "billed"; // iptal edilemez, ödenmiş de değil
      paddle.txns.get("txn_1")!.status = "completed";
      await postEvent("transaction.completed", txnData("txn_1", first.body.consentId!, { origin: "api" }));
      const open = await prisma.checkoutIntent.findFirstOrThrow({ where: { providerRef: "txn_2" } });
      expect(open).toMatchObject({ status: "open", openKey: orgId });
    });
  });

  describe("niyet anahtarı KAPALI (açılış varsayılanı — işlemi istemci açar)", () => {
    it("🚨 işlem olayı geldi (onay kimliğiyle), abonelik olayı gelmedi, kilit yok → yeni ödeme ekranı AÇILMAZ", async () => {
      const first = await openCheckout();
      expect(first.status).toBe(201);
      expect(first.body.transactionId).toBeUndefined(); // bu kipte işlemi istemci açar
      expect(await postEvent("transaction.completed", txnData("txn_c1", first.body.consentId!))).toBe(200);
      await expireLock(orgId);

      const again = await openCheckout();
      expect(again.status).toBe(400);
      expect(again.text).toMatch(/Ödemeniz/);
    });

    it("KONTROL: ödeme yokken (ekran açıldı, ödenmedi) yeni ödeme ekranı bugünkü gibi açılır", async () => {
      expect((await openCheckout()).status).toBe(201);
      expect((await openCheckout()).status).toBe(201);
    });

    it("yenileme / plan değişikliği işlemi (onay kimliği taşısa da) kayıt AÇMAZ; köken alanı yoksa aboneliği bağlı işlem de açmaz", async () => {
      const first = await openCheckout();
      const consentId = first.body.consentId!;
      await postEvent("subscription.created", subData("sub_1", "active", consentId));
      await postEvent("transaction.completed", txnData("txn_r1", consentId, { origin: "subscription_recurring", subscription_id: "sub_1" }));
      await postEvent("transaction.completed", txnData("txn_u1", consentId, { origin: "subscription_update", subscription_id: "sub_1" }));
      await postEvent("transaction.completed", txnData("txn_n1", consentId, { origin: undefined, subscription_id: "sub_1" }));
      // Aboneliği bu hesaba bağlı OLMAYAN yenileme işlemi de (köken yenileme) kayıt açmaz.
      await postEvent("transaction.completed", txnData("txn_r2", consentId, { origin: "subscription_recurring", subscription_id: "sub_other" }));
      expect(await prisma.checkoutIntent.count()).toBe(0);
      // Abonelik iptal edilince müşteri yeniden satın alabilir (eski yenilemeler engel bırakmadı).
      await postEvent("subscription.canceled", subData("sub_1", "canceled", consentId));
      expect((await openCheckout()).status).toBe(201);
    });

    it("abonelik ÖNCE, işlem olayı (abonelik kimliği dolu) SONRA → kayıt doğrudan 'bağlandı' yazılır, engel bırakmaz", async () => {
      const first = await openCheckout();
      const consentId = first.body.consentId!;
      await postEvent("subscription.created", subData("sub_1", "active", consentId));
      await postEvent("transaction.completed", txnData("txn_c1", consentId, { subscription_id: "sub_1" }));
      expect((await intentOf(orgId))!.status).toBe("fulfilled");
      await postEvent("subscription.canceled", subData("sub_1", "canceled", consentId));
      expect((await openCheckout()).status).toBe(201);
    });

    it("aynı işlemin iki olayı (ödendi → tamamlandı) TEK kayıt yazar; ikinci olaydaki abonelik kimliği yerelde bağlıysa bekleyen kayıt kapanır", async () => {
      const first = await openCheckout();
      const consentId = first.body.consentId!;
      await postEvent("transaction.paid", txnData("txn_c1", consentId, { status: "paid" }));
      expect((await intentOf(orgId))!.status).toBe("completed");
      await postEvent("subscription.created", subData("sub_1", "active", consentId));
      expect((await intentOf(orgId))!.status).toBe("fulfilled");
      await postEvent("transaction.completed", txnData("txn_c1", consentId, { subscription_id: "sub_1" }));
      expect(await prisma.checkoutIntent.count({ where: { organizationId: orgId } })).toBe(1);
      expect((await intentOf(orgId))!.status).toBe("fulfilled");
    });

    it("abonelik önce → 'ödendi' (abonelik kimliği boş) → 'tamamlandı' (abonelik kimliği dolu): bekleyen kayıt ikinci işlem olayıyla kapanır", async () => {
      const first = await openCheckout();
      const consentId = first.body.consentId!;
      await postEvent("subscription.created", subData("sub_1", "active", consentId));
      await postEvent("transaction.paid", txnData("txn_c1", consentId, { status: "paid" }));
      expect((await intentOf(orgId))!.status).toBe("completed");
      await postEvent("transaction.completed", txnData("txn_c1", consentId, { subscription_id: "sub_1" }));
      expect((await intentOf(orgId))!.status).toBe("fulfilled");
      expect(paddle.calls).toEqual([]); // Paddle'a hiç gidilmedi — olaydaki abonelik kimliği yetti
    });

    it("abonelik önce, ardından YALNIZ 'ödendi' olayı (abonelik kimliği boş): kayıt bekler; abonelik iptalinden sonra uzlaştırma kaydı kapatır → yeniden satın alınabilir", async () => {
      const first = await openCheckout();
      const consentId = first.body.consentId!;
      await postEvent("subscription.created", subData("sub_1", "active", consentId));
      await postEvent("transaction.paid", txnData("txn_c1", consentId, { status: "paid" }));
      expect((await intentOf(orgId))!.status).toBe("completed");
      await postEvent("subscription.canceled", subData("sub_1", "canceled", consentId));
      // Paddle'da işlem artık aboneliğini gösteriyor; yereldeki (iptal edilmiş) abonelik aynı → bu ödeme çoktan bağlanmıştı.
      paddle.txns.set("txn_c1", { status: "completed", subscription_id: "sub_1", custom_data: { consentId }, origin: "web" });
      expect((await openCheckout()).status).toBe(201);
      expect((await intentOf(orgId))!.status).toBe("fulfilled");
    });

    describe("istemcinin 'tamamlandı' sinyali sunucuda doğrulanır (web kancası hiç gelmese de)", () => {
      it("🚨 Paddle'da ödenmiş + onay bu işletmenin → kalıcı kayıt; kilit düşünce de yeni ödeme ekranı açılmaz", async () => {
        const first = await openCheckout();
        const consentId = first.body.consentId!;
        paddle.txns.set("txn_c9", { status: "completed", subscription_id: null, custom_data: { consentId }, origin: "web" });
        expect((await pendingPost(pendingReq({ consentId, transactionId: "txn_c9" }), ctx)).status).toBe(200);
        const row = (await intentOf(orgId))!;
        expect(row).toMatchObject({ status: "completed", providerRef: "txn_c9", consentId, openKey: null });
        await expireLock(orgId);
        expect((await openCheckout()).status).toBe(400);
      });

      it.each([
        ["ödenmemiş işlem (kendi onayını taşısa da)", (c: string) => paddle.txns.set("txn_c9", { status: "ready", custom_data: { consentId: c }, origin: "web" }), "txn_c9"],
        ["Paddle okunamıyor", (_c: string) => paddle.txns.set("txn_c9", null), "txn_c9"],
        ["Paddle işlemi bulamıyor", (_c: string) => undefined, "txn_c9"],
        ["işlem onay kimliği taşımıyor", (_c: string) => paddle.txns.set("txn_c9", { status: "completed", custom_data: null, origin: "web" }), "txn_c9"],
        ["işlem kimliği gönderilmedi", (_c: string) => undefined, undefined],
      ])("%s → kalıcı kayıt YAZILMAZ (yalnız 10 dk kilit); kilit düşünce ekran açılır", async (_label, arrange, transactionId) => {
        const first = await openCheckout();
        arrange(first.body.consentId!);
        expect((await pendingPost(pendingReq({ consentId: first.body.consentId, transactionId }), ctx)).status).toBe(200);
        expect(await prisma.checkoutIntent.count()).toBe(0);
        expect((await openCheckout()).status).toBe(400); // kilit geçerli
        await expireLock(orgId);
        expect((await openCheckout()).status).toBe(201);
      });

      it("biçimi tutmayan işlem kimliği Paddle'a HİÇ sorulmaz (yalnız kilit yazılır)", async () => {
        const first = await openCheckout();
        expect((await pendingPost(pendingReq({ consentId: first.body.consentId, transactionId: "txn_c9; drop" }), ctx)).status).toBe(200);
        expect((await pendingPost(pendingReq({ consentId: first.body.consentId, transactionId: "../subscriptions/sub_1" }), ctx)).status).toBe(200);
        expect(paddle.calls).toEqual([]);
        expect(await prisma.checkoutIntent.count()).toBe(0);
      });

      it("🚨 BAŞKA işletmenin ödenmiş işlemi bildirilirse bu işletmeye kayıt yazılmaz (işletme, işlemin onay satırından gelir)", async () => {
        const mine = await openCheckout();
        const other = await owner("b");
        const otherConsent = await prisma.checkoutConsent.create({
          data: { organizationId: other.org, planCode: "pro", priceId: "pri_pro", legalVersion: "v" },
        });
        paddle.txns.set("txn_b1", { status: "completed", custom_data: { consentId: otherConsent.id }, origin: "web" });
        await pendingPost(pendingReq({ consentId: mine.body.consentId, transactionId: "txn_b1" }), ctx);
        expect(await prisma.checkoutIntent.count()).toBe(0);
      });
    });
  });

  describe("uzlaştırma — kayıt yalnız kanıtla kapanır", () => {
    /** Bekleyen ödeme (niyet kapalı kip): işlem olayı geldi, abonelik bağlanmadı, kilit yok. */
    async function awaiting(txn = "txn_c1"): Promise<string> {
      const first = await openCheckout();
      await postEvent("transaction.completed", txnData(txn, first.body.consentId!));
      await expireLock(orgId);
      return first.body.consentId!;
    }

    /** Paddle iade kaydı (adjustment). */
    const refund = (txn: string, over: Record<string, unknown> = {}) => ({
      id: `adj_${txn}`,
      transaction_id: txn,
      action: "refund",
      type: "full",
      status: "approved",
      ...over,
    });

    it("🚨 işlemin TAM iadesi Paddle'da ONAYLI ve aboneliği İPTAL → kayıt 'geçersiz', yeni ödeme açılır", async () => {
      const consentId = await awaiting();
      paddle.txns.set("txn_c1", { status: "completed", subscription_id: "sub_x", custom_data: { consentId }, origin: "web" });
      paddle.subs.set("sub_x", { status: "canceled" });
      paddle.adjustments.set("txn_c1", [refund("txn_c1")]);
      expect((await openCheckout()).status).toBe(201);
      expect((await intentOf(orgId))!.status).toBe("released");
    });

    it("abonelik hiç kurulmadan TAM iade edilmiş (onaylı) ödeme → kayıt 'geçersiz' (etkin abonelik yok)", async () => {
      const consentId = await awaiting();
      paddle.txns.set("txn_c1", { status: "completed", subscription_id: null, custom_data: { consentId }, origin: "web" });
      paddle.adjustments.set("txn_c1", [refund("txn_c1")]);
      expect((await openCheckout()).status).toBe(201);
      expect((await intentOf(orgId))!.status).toBe("released");
    });

    it.each([
      ["abonelik iptal ama İADE YOK (iptal ≠ iade)", [] as Array<Record<string, unknown>>],
      ["iade ONAY BEKLİYOR", [refund("txn_c1", { status: "pending_approval" })]],
      ["iade REDDEDİLDİ", [refund("txn_c1", { status: "rejected" })]],
      ["iade GERİ ÇEVRİLDİ", [refund("txn_c1", { status: "reversed" })]],
      ["yalnız KISMİ iade (onaylı)", [refund("txn_c1", { type: "partial" })]],
      ["onaylı tam kayıt ama eylemi iade değil (alacak)", [refund("txn_c1", { action: "credit" })]],
      ["onaylı tam iade BAŞKA bir işlemin", [refund("txn_baska")]],
    ])("🚨 %s → kayıt BEKLER, yeni ödeme açılmaz", async (_label, adjustments) => {
      const consentId = await awaiting();
      paddle.txns.set("txn_c1", { status: "completed", subscription_id: "sub_x", custom_data: { consentId }, origin: "web" });
      paddle.subs.set("sub_x", { status: "canceled" });
      paddle.adjustments.set("txn_c1", adjustments);
      expect((await openCheckout()).status).toBe(400);
      expect((await intentOf(orgId))!.status).toBe("completed");
    });

    it("önce reddedilmiş, sonra onaylanmış TAM iade (aynı işlem) → serbest; abonelik okunamıyorsa (tam iade onaylı olsa da) BEKLER", async () => {
      const consentId = await awaiting();
      paddle.txns.set("txn_c1", { status: "completed", subscription_id: "sub_x", custom_data: { consentId }, origin: "web" });
      paddle.subs.set("sub_x", null);
      paddle.adjustments.set("txn_c1", [refund("txn_c1", { id: "adj_1", status: "rejected" }), refund("txn_c1", { id: "adj_2" })]);
      expect((await openCheckout()).status).toBe(400);
      expect((await intentOf(orgId))!.status).toBe("completed");
      paddle.subs.set("sub_x", { status: "canceled" });
      expect((await openCheckout()).status).toBe(201);
      expect((await intentOf(orgId))!.status).toBe("released");
    });

    it("🚨 abonelik kimliği yokken: iade listesi okunamıyor → BEKLER; iade onaylı ama ikinci okumada abonelik kurulmuş → BEKLER (Haiku 11-19)", async () => {
      const consentId = await awaiting();
      paddle.txns.set("txn_c1", { status: "completed", subscription_id: null, custom_data: { consentId }, origin: "web" });
      paddle.adjustments.set("txn_c1", null);
      expect((await openCheckout()).status).toBe(400);
      expect((await intentOf(orgId))!.status).toBe("completed");
      // İade okunurken abonelik kuruldu: ilk işlem okuması kimliksiz, iade okumasından sonraki okumada kimlik var.
      paddle.adjustments.set("txn_c1", [refund("txn_c1")]);
      const reads = paddle.reads.length;
      const realGet = paddle.txns.get.bind(paddle.txns);
      let calls = 0;
      paddle.txns.get = ((id: string) => {
        const row = realGet(id);
        if (id !== "txn_c1" || !row) return row;
        calls++;
        return calls === 1 ? row : { ...row, subscription_id: "sub_late" };
      }) as typeof paddle.txns.get;
      try {
        expect((await openCheckout()).status).toBe(400);
      } finally {
        paddle.txns.get = realGet;
      }
      expect(paddle.reads.length).toBeGreaterThan(reads);
      expect((await intentOf(orgId))!.status).toBe("completed");
    });

    it.each([
      ["boş gövde", null],
      ["data alanı yok", {}],
      ["data dizi değil", { data: { transaction_id: "txn_c1", action: "refund", type: "full", status: "approved" } }],
    ])("🚨 iade yanıtı 200 ama biçimi bozuk (%s) → okunamadı sayılır, kayıt BEKLER (mutasyon 11-19)", async (_label, body) => {
      const consentId = await awaiting();
      paddle.txns.set("txn_c1", { status: "completed", subscription_id: "sub_x", custom_data: { consentId }, origin: "web" });
      paddle.subs.set("sub_x", { status: "canceled" });
      paddle.adjustmentsRaw.set("txn_c1", body);
      expect((await openCheckout()).status).toBe(400);
      expect((await intentOf(orgId))!.status).toBe("completed");
      // KONTROL: aynı kurulum, yanıt biçimi doğru ve TAM iade onaylı → serbest (testin kendisi bırakmayı engellemiyor).
      paddle.adjustmentsRaw.delete("txn_c1");
      paddle.adjustments.set("txn_c1", [refund("txn_c1")]);
      expect((await openCheckout()).status).toBe(201);
      expect((await intentOf(orgId))!.status).toBe("released");
    });

    it("🚨 iade listesi okunamıyor → kayıt BEKLER; TAM iade onaylı ama abonelik hâlâ ETKİN → kayıt BEKLER (ikinci abonelik açılmasın)", async () => {
      const consentId = await awaiting();
      paddle.txns.set("txn_c1", { status: "completed", subscription_id: "sub_x", custom_data: { consentId }, origin: "web" });
      paddle.subs.set("sub_x", { status: "canceled" });
      paddle.adjustments.set("txn_c1", null);
      expect((await openCheckout()).status).toBe(400);
      expect((await intentOf(orgId))!.status).toBe("completed");
      paddle.subs.set("sub_x", { status: "active" });
      paddle.adjustments.set("txn_c1", [refund("txn_c1")]);
      expect((await openCheckout()).status).toBe(400);
      expect((await intentOf(orgId))!.status).toBe("completed");
      // KONTROL: abonelik hiç yokken onaylı olmayan iade de yetmez.
      paddle.txns.set("txn_c1", { status: "completed", subscription_id: null, custom_data: { consentId }, origin: "web" });
      paddle.adjustments.set("txn_c1", [refund("txn_c1", { status: "pending_approval" })]);
      expect((await openCheckout()).status).toBe(400);
      expect((await intentOf(orgId))!.status).toBe("completed");
    });

    it.each([
      ["Paddle okunamıyor", (_c: string) => paddle.txns.set("txn_c1", null)],
      ["Paddle işlemi bulamıyor", (_c: string) => void paddle.txns.delete("txn_c1")],
      ["işlemin abonelik kimliği yok", (c: string) => paddle.txns.set("txn_c1", { status: "completed", subscription_id: null, custom_data: { consentId: c }, origin: "web" })],
      [
        "abonelik Paddle'da etkin ama hesaba bağlı değil",
        (c: string) => {
          paddle.txns.set("txn_c1", { status: "completed", subscription_id: "sub_x", custom_data: { consentId: c }, origin: "web" });
          paddle.subs.set("sub_x", { status: "active" });
        },
      ],
      [
        "abonelik okunamıyor",
        (c: string) => {
          paddle.txns.set("txn_c1", { status: "completed", subscription_id: "sub_x", custom_data: { consentId: c }, origin: "web" });
          paddle.subs.set("sub_x", null);
        },
      ],
      [
        "işlem başka bir onayı taşıyor (aboneliği iptal olsa da karar verilmez)",
        (_c: string) => {
          paddle.txns.set("txn_c1", { status: "completed", subscription_id: "sub_x", custom_data: { consentId: "cbaskaonaykaydi0000000001" }, origin: "web" });
          paddle.subs.set("sub_x", { status: "canceled" });
        },
      ],
    ])("🚨 %s → kayıt BEKLER, yeni ödeme açılmaz", async (_label, arrange) => {
      const consentId = await awaiting();
      arrange(consentId);
      expect((await openCheckout()).status).toBe(400);
      expect((await intentOf(orgId))!.status).toBe("completed");
    });

    // Mutasyon 11-18 (P14): "işlemin abonelik kimliği yok" kapısı kalkarsa yerel satırın BOŞ kimliği işlemin boş kimliğiyle "eşleşir"
    // (boş = boş) ve kayıt kanıtsız kapanır → ikinci ödeme açılır. Paddle sağlayıcılı ama kimliği boş satır = elle düzeltilmiş / yarım kayıt.
    it("🚨 işlemin abonelik kimliği YOK, hesabın abonelik satırında da kimlik yok → 'boş = boş' eşleşmesi kaydı KAPATMAZ; Paddle'a abonelik sorulmaz", async () => {
      const consentId = await awaiting();
      await prisma.subscription.create({ data: { organizationId: orgId, planCode: "pro", status: "canceled", provider: "paddle", providerRef: null } });
      paddle.txns.set("txn_c1", { status: "completed", subscription_id: null, custom_data: { consentId }, origin: "web" });
      paddle.calls.length = 0;
      expect((await openCheckout()).status).toBe(400);
      expect((await intentOf(orgId))!.status).toBe("completed");
      expect(paddle.calls.filter((c) => c.startsWith("/subscriptions"))).toEqual([]);
    });

    it("🚨 abonelik hesaba BAĞLI ama kayıt kapanmamış (kapatma adımı kaçmış): uzlaştırma Paddle'daki işlemin aboneliğini yereldekiyle eşleştirip kapatır", async () => {
      const consentId = await awaiting();
      // Abonelik satırı bu ödemenin aboneliğini taşıyor (sonradan iptal edilmiş); kayıt "bekliyor" kalmış.
      await prisma.subscription.create({ data: { organizationId: orgId, planCode: "pro", status: "canceled", provider: "paddle", providerRef: "sub_1" } });
      paddle.txns.set("txn_c1", { status: "completed", subscription_id: "sub_1", custom_data: { consentId }, origin: "web" });
      expect((await openCheckout()).status).toBe(201);
      expect((await intentOf(orgId))!.status).toBe("fulfilled");
      expect(paddle.reads).toEqual(["txn_c1"]); // abonelik Paddle'a sorulmadı — yerel eşleşme yetti
    });

    it("🚨 K9: uzlaştırma Paddle'ı okurken kaydı operatör serbest bırakırsa koşullu kapanış 0 satır yazar → karar SON durumdan ('bırakıldı'), 'bağlandı' DEĞİL", async () => {
      const consentId = await awaiting();
      await prisma.subscription.upsert({
        where: { organizationId: orgId },
        create: { organizationId: orgId, provider: "paddle", providerRef: "sub_k9", status: "active", planCode: "pro" },
        update: { provider: "paddle", providerRef: "sub_k9", status: "active" },
      });
      paddle.txns.set("txn_c1", { status: "completed", subscription_id: "sub_k9", custom_data: { consentId }, origin: "web" });
      const row = (await paidCheckoutAwaiting(orgId))!;
      paddle.onTxnRead = async () => {
        expect((await releasePaidCheckoutByOperator(row.id)).ok).toBe(true);
      };
      const verdict = await reconcilePaidCheckout(row);
      expect(paddle.onTxnReadRan).toBe(1);
      expect(verdict.outcome).toBe("released");
      expect((await prisma.checkoutIntent.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("released");
    });

    it("K9 KONTROL: araya kimse girmezse aynı uzlaştırma kaydı 'bağlandı' yapar", async () => {
      const consentId = await awaiting();
      await prisma.subscription.upsert({
        where: { organizationId: orgId },
        create: { organizationId: orgId, provider: "paddle", providerRef: "sub_k9", status: "active", planCode: "pro" },
        update: { provider: "paddle", providerRef: "sub_k9", status: "active" },
      });
      paddle.txns.set("txn_c1", { status: "completed", subscription_id: "sub_k9", custom_data: { consentId }, origin: "web" });
      const row = (await paidCheckoutAwaiting(orgId))!;
      expect((await reconcilePaidCheckout(row)).outcome).toBe("fulfilled");
      expect((await prisma.checkoutIntent.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("fulfilled");
    });

    it("kapanış anı kaydın KAPANDIĞI andır (ödeme anı değil): eski ödemenin bırakılan kaydı saklama süpürgesinde hemen silinmez", async () => {
      await awaiting();
      const row = (await intentOf(orgId))!;
      await prisma.checkoutIntent.update({ where: { id: row.id }, data: { closedAt: new Date(Date.now() - 100 * 24 * 60 * MIN) } });
      await releasePaidCheckoutByOperator(row.id);
      const closed = await prisma.checkoutIntent.findUniqueOrThrow({ where: { id: row.id } });
      expect(Date.now() - closed.closedAt!.getTime()).toBeLessThan(60_000);
      await sweepCheckoutIntents();
      expect(await prisma.checkoutIntent.findUnique({ where: { id: row.id } })).not.toBeNull();
    });

    it("KİRACI: A'nın bekleyen ödemesi B'nin ödeme ekranını engellemez", async () => {
      await awaiting();
      const other = await owner("b");
      session = other.s;
      expect((await openCheckout()).status).toBe(201);
    });

    it("operatör elle serbest bırakır → yeni ödeme açılır; bekleyen olmayan / bilinmeyen kayıt bırakılamaz", async () => {
      await awaiting();
      const row = (await intentOf(orgId))!;
      expect((await paidCheckoutsAwaitingSummary()).rows).toEqual([expect.objectContaining({ id: row.id, organizationId: orgId, transactionId: "txn_c1" })]);
      expect(await releasePaidCheckoutByOperator(row.id)).toEqual({ ok: true, organizationId: orgId, transactionId: "txn_c1" });
      expect((await intentOf(orgId))!.status).toBe("released");
      expect((await paidCheckoutsAwaitingSummary()).total).toBe(0);
      expect(await releasePaidCheckoutByOperator(row.id)).toEqual({ ok: false, reason: "not_awaiting" });
      expect(await releasePaidCheckoutByOperator("yok")).toEqual({ ok: false, reason: "not_found" });
      expect((await openCheckout()).status).toBe(201);
    });
  });

  describe("web kancası sağlamlığı — kayıt adımı düşerse olay işlenmiş SAYILMAZ, yeniden gelince tamamlanır", () => {
    const invoices = () => prisma.invoice.count({ where: { organizationId: orgId } });

    it("işlem olayında kayıt yazımı düşer → 500 (fatura da yazılmadı); olay yeniden gelince kayıt + fatura yazılır", async () => {
      const first = await openCheckout();
      gate.failRecordOnce = true;
      expect(await postEvent("transaction.completed", txnData("txn_c1", first.body.consentId!))).toBe(500);
      expect(await prisma.checkoutIntent.count()).toBe(0);
      expect(await invoices()).toBe(0);
      expect(await postEvent("transaction.completed", txnData("txn_c1", first.body.consentId!))).toBe(200);
      expect((await intentOf(orgId))!.status).toBe("completed");
      expect(await invoices()).toBe(1);
    });

    it("🚨 abonelik yazımı + kaydın kapanışı TEK İŞLEM (Codex 11-25): kapanış düşerse abonelik de YAZILMAZ (500); yeniden gelen olay ikisini birlikte yazar, 'ikinci abonelik' alarmı bir kez gider", async () => {
      // Kayıtlı canlı abonelik A; ikinci ödemenin (B) işlemi geldi, kaydı bekliyor.
      const a = await openCheckout();
      await postEvent("subscription.created", subData("sub_a", "active", a.body.consentId!));
      const consentB = await prisma.checkoutConsent.create({ data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "v" } });
      await postEvent("transaction.completed", txnData("txn_b", consentB.id));
      const rowB = () => prisma.checkoutIntent.findFirstOrThrow({ where: { providerRef: "txn_b" } });
      const subRef = async () => (await prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } })).providerRef;
      expect((await rowB()).status).toBe("completed");

      gate.failFulfilOnce = true;
      expect(await postEvent("subscription.created", subData("sub_b", "active", consentB.id))).toBe(500);
      const second = () => reportErrorMock.mock.calls.filter(([context]) => context === "paddle-webhook-second-subscription");
      // Eskiden (iki ayrı yazım): abonelik B yazılmış, kayıt "bekliyor" kalmıştı. Artık ikisi birlikte geri alınır.
      expect(await subRef()).toBe("sub_a");
      expect((await rowB()).status).toBe("completed");
      expect(second()).toHaveLength(0);
      // Olay yeniden gelir: aynı karar baştan verilir — abonelik B + kayıt kapanır + alarm (koşulu hâlâ görünür: satır A'ydı) bir kez.
      expect(await postEvent("subscription.created", subData("sub_b", "active", consentB.id))).toBe(200);
      expect(await subRef()).toBe("sub_b");
      expect((await rowB()).status).toBe("fulfilled");
      expect(second()).toHaveLength(1);
    });

    it("🚨 İLK abonelik satırı da aynı işlemde: kapanış düşerse abonelik satırı OLUŞMAZ; yeniden gelen olay ikisini yazar", async () => {
      const first = await openCheckout();
      await postEvent("transaction.completed", txnData("txn_c1", first.body.consentId!));
      expect((await intentOf(orgId))!.status).toBe("completed");
      gate.failFulfilOnce = true;
      expect(await postEvent("subscription.created", subData("sub_1", "active", first.body.consentId!))).toBe(500);
      expect(await prisma.subscription.findUnique({ where: { organizationId: orgId } })).toBeNull(); // satır oluşmadı (işlem geri alındı)
      expect((await intentOf(orgId))!.status).toBe("completed");
      expect(await postEvent("subscription.created", subData("sub_1", "active", first.body.consentId!))).toBe(200);
      expect(await prisma.subscription.findUnique({ where: { organizationId: orgId } })).toMatchObject({ providerRef: "sub_1", status: "active" });
      expect((await intentOf(orgId))!.status).toBe("fulfilled");
    });

    it("🚨 abonelik satırına YAZILMAYAN (sıra korumasının düşürdüğü bayat) olay kaydı KAPATMAZ — kapanış yalnız abonelik yazıldıysa", async () => {
      // Canlı abonelik sub_1 (başka bir onayla, taze olay). Sonra A onayının ödemesi bekliyor.
      const consentB = await prisma.checkoutConsent.create({ data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "v" } });
      expect(await postEvent("subscription.created", subData("sub_1", "active", consentB.id))).toBe(200);
      // (Canlı abonelik varken onay rotası yeni ödeme açmaz — A onayı doğrudan yazılır; senaryo: ikinci ödeme başka yoldan tamamlandı.)
      const consentA = await prisma.checkoutConsent.create({ data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "v" } });
      await postEvent("transaction.completed", txnData("txn_a", consentA.id));
      const rowA = () => prisma.checkoutIntent.findFirstOrThrow({ where: { providerRef: "txn_a" } });
      expect((await rowA()).status).toBe("completed");
      // A onayını taşıyan ama kayıtlı olaydan ESKİ olay: abonelik satırına yazılmaz (0 satır) → kayıt beklemeye devam eder.
      expect(await postEvent("subscription.updated", subData("sub_1", "active", consentA.id), 10 * MIN)).toBe(200);
      expect((await rowA()).status).toBe("completed");
    });

    it("🚨 kimliksiz abonelik olayı (abonelik kimliği yok) onay taşısa da kaydı KAPATMAZ (bağ, satırdaki abonelik kimliğidir)", async () => {
      const a = await openCheckout();
      await postEvent("transaction.completed", txnData("txn_a", a.body.consentId!));
      const { id: _omit, ...noId } = subData("sub_x", "active", a.body.consentId!);
      void _omit;
      await postEvent("subscription.created", noId);
      expect((await prisma.checkoutIntent.findFirstOrThrow({ where: { providerRef: "txn_a" } })).status).toBe("completed");
    });

    it("🚨 kapanış KOŞULLU: okuma ile yazma arasında operatör kaydı serbest bıraktıysa abonelik olayı onu 'bağlandı'ya ÇEVİRMEZ", async () => {
      const a = await openCheckout();
      await postEvent("transaction.completed", txnData("txn_a", a.body.consentId!));
      const row = await prisma.checkoutIntent.findFirstOrThrow({ where: { providerRef: "txn_a" } });
      let ran = 0;
      __checkoutPaidHooks.beforeFulfilWrite = async () => {
        ran++;
        // Ayrı bağlantıda, işlemin dışında: operatör bıraktı.
        await prisma.checkoutIntent.update({ where: { id: row.id }, data: { status: "released" } });
      };
      try {
        expect(await postEvent("subscription.created", subData("sub_1", "active", a.body.consentId!))).toBe(200);
      } finally {
        __checkoutPaidHooks.beforeFulfilWrite = null;
      }
      expect(ran).toBe(1);
      expect((await prisma.checkoutIntent.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("released");
    });

    it.each(["open", "opening", "expired", "canceled"])(
      "niyet satırı '%s' durumunda kalmışken (niyet modülü çeviremedi) işlem olayının kaydı satırı 'ödeme alındı'ya çevirir",
      async (status) => {
        const consent = await prisma.checkoutConsent.create({ data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "v" } });
        const open = status === "open" || status === "opening";
        const row = await prisma.checkoutIntent.create({
          data: { organizationId: orgId, consentId: consent.id, planCode: "pro", priceId: "pri_pro", providerRef: "txn_k1", status, openKey: open ? orgId : null, expiresAt: new Date() },
        });
        await recordPaidCheckout({ transactionId: "txn_k1", consentId: consent.id, subscriptionId: null, origin: "api", paidAt: new Date() });
        expect(await prisma.checkoutIntent.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "completed", openKey: null });
      },
    );

    it.each(["fulfilled", "released", "failed"])("KONTROL: '%s' satıra dokunulmaz", async (status) => {
      const consent = await prisma.checkoutConsent.create({ data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "v" } });
      const row = await prisma.checkoutIntent.create({
        data: { organizationId: orgId, consentId: consent.id, planCode: "pro", priceId: "pri_pro", providerRef: "txn_k1", status, expiresAt: new Date() },
      });
      await recordPaidCheckout({ transactionId: "txn_k1", consentId: consent.id, subscriptionId: null, origin: "api", paidAt: new Date() });
      expect((await prisma.checkoutIntent.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(status);
    });

    it("köken alanı YOK ve işlemin aboneliği yerelde bağlı DEĞİL → ödeme ekranı işlemi sayılır, kayıt açılır", async () => {
      const first = await openCheckout();
      await postEvent("transaction.completed", txnData("txn_c1", first.body.consentId!, { origin: undefined, subscription_id: "sub_yeni" }));
      expect((await intentOf(orgId))!).toMatchObject({ status: "completed", providerRef: "txn_c1" });
    });
  });

  describe("saatlik süpürge — operatöre haber + saklama", () => {
    async function awaitingSince(minutes: number, txn: string): Promise<{ id: string; consentId: string }> {
      const first = await openCheckout();
      await postEvent("transaction.completed", txnData(txn, first.body.consentId!));
      const row = await prisma.checkoutIntent.findFirstOrThrow({ where: { providerRef: txn } });
      await prisma.checkoutIntent.update({ where: { id: row.id }, data: { closedAt: new Date(Date.now() - minutes * MIN) } });
      return { id: row.id, consentId: first.body.consentId! };
    }

    it("15 dakikadır bağlanmayan ödeme operatöre BİR KEZ bildirilir (işletme + işlem kimliğiyle); bağlanınca alarm durumu kapanır", async () => {
      const { id, consentId } = await awaitingSince(16, "txn_c1");
      await sweepCheckoutIntents();
      expect(alarms()).toHaveLength(1);
      const text = String((alarms()[0]![1] as Error).message);
      expect(text).toContain(orgId);
      expect(text).toContain("txn_c1");
      expect(await alertRow(id)).not.toBeNull();
      await sweepCheckoutIntents();
      expect(alarms()).toHaveLength(1); // aynı kayıt için ikinci e-posta yok
      await postEvent("subscription.created", subData("sub_1", "active", consentId));
      expect(await alertRow(id)).toBeNull();
    });

    it("KONTROL: 15 dakikadan yeni bekleyen ödeme için alarm yok (abonelik olayı yoldadır)", async () => {
      await awaitingSince(5, "txn_c1");
      await sweepCheckoutIntents();
      expect(alarms()).toHaveLength(0);
    });

    it("süpürge önce uzlaştırır: Paddle'da TAM iadesi onaylı + aboneliği iptal edilmiş ödeme alarm ÜRETMEZ, kayıt kapanır", async () => {
      const { id, consentId } = await awaitingSince(16, "txn_c1");
      paddle.txns.set("txn_c1", { status: "completed", subscription_id: "sub_x", custom_data: { consentId }, origin: "web" });
      paddle.subs.set("sub_x", { status: "canceled" });
      paddle.adjustments.set("txn_c1", [{ transaction_id: "txn_c1", action: "refund", type: "full", status: "approved" }]);
      await sweepCheckoutIntents();
      expect(alarms()).toHaveLength(0);
      expect((await prisma.checkoutIntent.findUniqueOrThrow({ where: { id } })).status).toBe("released");
    });

    it("🚨 bekleyen kayıtların HEPSİ gezilir (51 kayıt — ilk sayfanın arkasındaki de bildirilir)", async () => {
      const consent = await prisma.checkoutConsent.create({ data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "v" } });
      await prisma.checkoutIntent.createMany({
        data: Array.from({ length: 51 }, (_, i) => ({
          organizationId: orgId,
          consentId: consent.id,
          planCode: "pro",
          priceId: "pri_pro",
          providerRef: `txn_p${i}`,
          status: "completed",
          expiresAt: new Date(),
          closedAt: new Date(Date.now() - 60 * MIN),
        })),
      });
      await sweepCheckoutIntents();
      expect(alarms()).toHaveLength(51);
    });

    it("süpürge sınırına çarparsa (gezilemeyen kayıt kaldı) operatöre ayrıca haber verir — sessiz sınır yok", async () => {
      const consent = await prisma.checkoutConsent.create({ data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "v" } });
      await prisma.checkoutIntent.createMany({
        data: Array.from({ length: 51 }, (_, i) => ({
          organizationId: orgId,
          consentId: consent.id,
          planCode: "pro",
          priceId: "pri_pro",
          providerRef: `txn_s${i}`,
          status: "completed",
          expiresAt: new Date(),
          closedAt: new Date(Date.now() - 60 * MIN),
        })),
      });
      const backlog = () => reportErrorMock.mock.calls.filter(([context]) => context === "paddle-paid-not-linked-backlog");
      await sweepPaidCheckouts(new Date(), { maxPages: 1 });
      expect(alarms()).toHaveLength(50);
      expect(backlog()).toHaveLength(1);
      // KONTROL: sınır yetiyorsa bu alarm yok.
      reportErrorMock.mockClear();
      await sweepPaidCheckouts(new Date(), { maxPages: 3 });
      expect(backlog()).toHaveLength(0);
    });

    /** Bekleyen (60 dk önce ödenmiş, Paddle'da bulunamayan → bekler) n kayıt. */
    async function backlogRows(n: number, prefix: string): Promise<void> {
      const consent = await prisma.checkoutConsent.create({ data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "v" } });
      await prisma.checkoutIntent.createMany({
        data: Array.from({ length: n }, (_, i) => ({
          organizationId: orgId,
          consentId: consent.id,
          planCode: "pro",
          priceId: "pri_pro",
          providerRef: `txn_${prefix}${i}`,
          status: "completed",
          expiresAt: new Date(),
          closedAt: new Date(Date.now() - 60 * MIN),
        })),
      });
    }
    const backlogAlarms = () => reportErrorMock.mock.calls.filter(([context]) => context === "paddle-paid-not-linked-backlog");
    const cursorRow = () => prisma.systemLock.findUnique({ where: { name: "checkout-paid-sweep:after" } });

    it("🚨 K6: kayıt sayısı TAM sınır kadarsa (50 kayıt, 1 sayfa) sınır alarmı YOK — gezilmemiş kayıt kalmadı", async () => {
      await backlogRows(50, "e");
      const r = await sweepPaidCheckouts(new Date(), { maxPages: 1 });
      expect(r.checked).toBe(50);
      expect(alarms()).toHaveLength(50);
      expect(backlogAlarms()).toHaveLength(0);
      expect(await cursorRow()).toBeNull();
    });

    it("🚨 K6: sınırın ARKASINDAKİ kayıt sonraki turda gezilir (51 kayıt, tur başına 1 sayfa): imleç kalıcı, 51. kayıt da bildirilir", async () => {
      await backlogRows(51, "k");
      const first = await sweepPaidCheckouts(new Date(), { maxPages: 1 });
      expect(first.checked).toBe(50);
      expect(alarms()).toHaveLength(50);
      expect(backlogAlarms()).toHaveLength(1);
      expect((await cursorRow())?.holder).toBeTruthy();
      const second = await sweepPaidCheckouts(new Date(), { maxPages: 1 });
      expect(second.checked).toBe(1); // eskiden ilk 50'yi yeniden okuyordu
      expect(alarms()).toHaveLength(51);
      const lastId = (await prisma.checkoutIntent.findFirstOrThrow({ where: { providerRef: { startsWith: "txn_k" } }, orderBy: { id: "desc" } })).id;
      expect(String((alarms()[50]![1] as Error).message)).toContain(
        (await prisma.checkoutIntent.findUniqueOrThrow({ where: { id: lastId } })).providerRef!,
      );
    });

    it("K6: imleçten sonrası bitince tur başa sarar ve imlece kadar olanları da gezer; tam tur bitince imleç silinir", async () => {
      await backlogRows(51, "w");
      await sweepPaidCheckouts(new Date(), { maxPages: 1 });
      expect(await cursorRow()).not.toBeNull();
      const second = await sweepPaidCheckouts(new Date(), { maxPages: 3 });
      expect(second.checked).toBe(51);
      expect(await cursorRow()).toBeNull();
      expect(backlogAlarms()).toHaveLength(1); // yalnız ilk turunki
    });

    it("🚨 saklama süresi 'ödeme alındı' kaydını SİLMEZ (silinseydi ikinci ödeme yine açılırdı); bağlanmış eski kayıt silinir", async () => {
      const { id } = await awaitingSince(100 * 24 * 60, "txn_c1");
      const consent = await prisma.checkoutConsent.create({ data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "v" } });
      const done = await prisma.checkoutIntent.create({
        data: { organizationId: orgId, consentId: consent.id, planCode: "pro", priceId: "pri_pro", providerRef: "txn_old", status: "fulfilled", expiresAt: new Date(), closedAt: new Date(Date.now() - 100 * 24 * 60 * MIN) },
      });
      await sweepCheckoutIntents();
      expect(await prisma.checkoutIntent.findUnique({ where: { id } })).not.toBeNull();
      expect(await prisma.checkoutIntent.findUnique({ where: { id: done.id } })).toBeNull();
      expect((await openCheckout()).status).toBe(400);
    });
  });
});
