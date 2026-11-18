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
      if (init?.method === "PATCH") {
        if (row!.status !== "ready") throw new Error("Paddle HTTP 400 (transaction_immutable) env=sandbox resource=transactions");
        row!.status = "canceled";
        return { data: { id, status: "canceled" } };
      }
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
import { sweepCheckoutIntents } from "@/lib/billing/checkout-intent";
import { paidCheckoutAlertKey, paidCheckoutsAwaitingSummary, releasePaidCheckoutByOperator } from "@/lib/billing/checkout-paid";
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
    paddle.reads.length = 0;
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
        ["ödenmemiş işlem", () => paddle.txns.set("txn_c9", { status: "ready", custom_data: null, origin: "web" }), "txn_c9"],
        ["Paddle okunamıyor", () => paddle.txns.set("txn_c9", null), "txn_c9"],
        ["Paddle işlemi bulamıyor", () => undefined, "txn_c9"],
        ["biçimsiz işlem kimliği", () => undefined, "txn_c9; drop"],
        ["işlem kimliği gönderilmedi", () => undefined, undefined],
      ])("%s → kalıcı kayıt YAZILMAZ (yalnız 10 dk kilit); kilit düşünce ekran açılır", async (_label, arrange, transactionId) => {
        const first = await openCheckout();
        arrange();
        expect((await pendingPost(pendingReq({ consentId: first.body.consentId, transactionId }), ctx)).status).toBe(200);
        expect(await prisma.checkoutIntent.count()).toBe(0);
        expect((await openCheckout()).status).toBe(400); // kilit geçerli
        await expireLock(orgId);
        expect((await openCheckout()).status).toBe(201);
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

    it("işlemin Paddle'daki aboneliği İPTAL edilmiş (operatör iptal + iade etti) → kayıt 'geçersiz', yeni ödeme açılır", async () => {
      const consentId = await awaiting();
      paddle.txns.set("txn_c1", { status: "completed", subscription_id: "sub_x", custom_data: { consentId }, origin: "web" });
      paddle.subs.set("sub_x", { status: "canceled" });
      expect((await openCheckout()).status).toBe(201);
      expect((await intentOf(orgId))!.status).toBe("released");
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

    it("süpürge önce uzlaştırır: Paddle'da aboneliği iptal edilmiş ödeme alarm ÜRETMEZ, kayıt kapanır", async () => {
      const { id, consentId } = await awaitingSince(16, "txn_c1");
      paddle.txns.set("txn_c1", { status: "completed", subscription_id: "sub_x", custom_data: { consentId }, origin: "web" });
      paddle.subs.set("sub_x", { status: "canceled" });
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
