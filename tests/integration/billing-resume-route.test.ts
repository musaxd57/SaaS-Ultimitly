import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// I4 C (kurucu 10-17: "tıklanınca hemen ödeme alınsın, pakete dönsün") — gerçek PostgreSQL + SAHTE Paddle ağı. Para güvenliği:
// anahtar kapalıyken 404 · önizleme tutarı Paddle'dan (C1 metni) · tek kullanımlık onay · tutar değişirse yeniden onay (Paddle'a gidilmez) ·
// kart reddi → kart güncelleme bağlantısı, hiçbir şey kilitli kalmaz · BELİRSİZ sonuçta yeniden GÖNDERİLMEZ (durum okunur) · eşzamanlı iki
// onay TEK devam çağrısı · yalnız duraklatılmış abonelik · yalnız hesap sahibi.
// ---------------------------------------------------------------------------

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST as preview } from "@/app/api/billing/resume-preview/route";
import { POST as resume } from "@/app/api/billing/resume/route";
import { POST as webhook } from "@/app/api/webhooks/paddle/route";
import { RESUME_PENDING_LOCK } from "@/lib/billing/resume";
import { createHmac } from "node:crypto";

type PaddleState = {
  status: string;
  total: string;
  currency: string | null;
  customerId: string | null;
  resume: "ok" | "declined" | "rejected" | "ambiguous";
  afterAmbiguous: string;
};
let paddle: PaddleState;
let resumeCalls = 0;

function stubPaddle() {
  resumeCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      const method = init?.method ?? "GET";
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (method === "GET" && path === "/subscriptions/sub_1") {
        return json(200, { data: { status: paddle.status, customer_id: paddle.customerId, items: [{ price: { id: "pri_pro" } }] } });
      }
      if (method === "POST" && path === "/pricing-preview") {
        return json(200, { data: { currency_code: paddle.currency, details: { totals: { grand_total: paddle.total } } } });
      }
      if (method === "POST" && path === "/subscriptions/sub_1/resume") {
        resumeCalls++;
        if (paddle.resume === "ok") {
          paddle.status = "active";
          return json(200, { data: { status: "active" } });
        }
        if (paddle.resume === "declined") return json(400, { error: { code: "subscription_payment_declined" } });
        if (paddle.resume === "rejected") return json(400, { error: { code: "subscription_locked" } });
        paddle.status = paddle.afterAmbiguous;
        return json(502, { error: { code: "internal_error" } });
      }
      if (method === "POST" && path === "/customers/ctm_1/portal-sessions") {
        return json(200, {
          data: { urls: { general: { overview: "https://portal/ov" }, subscriptions: [{ id: "sub_1", update_subscription_payment_method: "https://portal/card" }] } },
        });
      }
      return json(404, { error: { code: "not_found" } });
    }),
  );
}

let orgId: string;
const post = (url: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
const ctx = { params: Promise.resolve({} as Record<string, never>) };
const doPreview = () => preview(post("/api/billing/resume-preview"), ctx);
const doResume = (previewToken: string) => resume(post("/api/billing/resume", { previewToken }), ctx);

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  vi.stubEnv("PADDLE_RESUME_ENABLED", "1");
  vi.stubEnv("PADDLE_API_KEY", "test-key");
  vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
  vi.stubEnv("AUTH_SECRET", "test-auth-secret-0123456789-abcdefghijkl");
  paddle = { status: "paused", total: "89900", currency: "TRY", customerId: "ctm_1", resume: "ok", afterAmbiguous: "paused" };
  stubPaddle();
  const org = await prisma.organization.create({ data: { name: "Org" } });
  orgId = org.id;
  const user = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" } });
  session = { userId: user.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  await prisma.subscription.create({
    data: { organizationId: orgId, planCode: "pro", status: "paused", provider: "paddle", providerRef: "sub_1", customerId: "ctm_1" },
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function token(): Promise<string> {
  const res = await doPreview();
  expect(res.status).toBe(200);
  return ((await res.json()) as { previewToken: string }).previewToken;
}

describe("Aboneliği devam ettir", () => {
  it("anahtar KAPALIYKEN iki rota da 404 (bugünkü davranış)", async () => {
    vi.stubEnv("PADDLE_RESUME_ENABLED", "");
    expect((await doPreview()).status).toBe(404);
    expect((await doResume("x")).status).toBe(404);
    expect(resumeCalls).toBe(0);
  });

  it("🚨 önizleme: kurucu C1 metni Paddle tutarıyla (büyük yazı + altında küçük tahsilat cümlesi); onay → TEK devam çağrısı, denetim, kilit webhook'a kadar", async () => {
    const res = await doPreview();
    const body = (await res.json()) as { planName: string; amount: string; confirm: { headline: string; fine: string } };
    expect(body.planName).toBe("Pro");
    expect(body.confirm.headline).toBe("Pro planınız hemen açılır.");
    expect(body.confirm.fine).toMatch(/^₺899,00 kayıtlı kartınızdan şimdi tahsil edilecek\.$/u);
    const r = await doResume(await token());
    expect(r.status).toBe(200);
    expect(resumeCalls).toBe(1);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "billing.resumed" } })).toBe(1);
    expect(await prisma.systemLock.count({ where: { name: RESUME_PENDING_LOCK(orgId) } })).toBe(1);
    // Kilit sürerken ikinci deneme Paddle'a GİTMEZ.
    expect((await doPreview()).status).toBe(409);
    expect(resumeCalls).toBe(1);
  });

  it("🚨 eşzamanlı iki onay (iki sekme, iki geçerli belirteç) → TEK devam çağrısı (tahsilat bir kez)", async () => {
    const [a, b] = [await token(), await token()];
    const statuses = (await Promise.all([doResume(a), doResume(b)])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(resumeCalls).toBe(1);
  });

  it("🚨 tutar değişti (fiyat / vergi) → 409 + yeni tutar, Paddle'a GİDİLMEZ; yeni önizlemeyle onay çalışır", async () => {
    const t = await token();
    paddle.total = "99900";
    const r = await doResume(t);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ amountChanged: true, amount: "₺999,00" });
    expect(resumeCalls).toBe(0);
    expect((await doResume(await token())).status).toBe(200);
    expect(resumeCalls).toBe(1);
  });

  it("🚨 kart reddi → 402 'Ödeme alınamadı. Kart bilgilerinizi güncelleyin.' + Paddle kart güncelleme bağlantısı; kilit kalmaz, yeniden denenebilir", async () => {
    paddle.resume = "declined";
    const r = await doResume(await token());
    expect(r.status).toBe(402);
    expect(await r.json()).toEqual({ error: "Ödeme alınamadı. Kart bilgilerinizi güncelleyin.", cardUpdateUrl: "https://portal/card" });
    expect(await prisma.systemLock.count({ where: { name: RESUME_PENDING_LOCK(orgId) } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "billing.resume_rejected" } })).toBe(1);
    paddle.resume = "ok";
    expect((await doResume(await token())).status).toBe(200);
  });

  it("kesin ret (kart dışı) → 502 sade metin, sağlayıcı kodu müşteriye GİTMEZ", async () => {
    paddle.resume = "rejected";
    const r = await doResume(await token());
    expect(r.status).toBe(502);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe("Aboneliğiniz devam ettirilemedi; ödeme alınmadı. Lütfen tekrar deneyin, sorun sürerse bize yazın.");
    expect(JSON.stringify(body)).not.toMatch(/subscription_locked|Paddle HTTP/u);
  });

  it("🚨 BELİRSİZ sonuç (502) + Paddle hâlâ duraklatılmış → 202 bekliyor, belirteç tüketik, ikinci deneme Paddle'a GİTMEZ", async () => {
    paddle.resume = "ambiguous";
    paddle.afterAmbiguous = "paused";
    const t = await token();
    const r = await doResume(t);
    expect(r.status).toBe(202);
    expect(resumeCalls).toBe(1);
    expect((await doResume(t)).status).toBe(409); // kilit sürüyor
    expect(resumeCalls).toBe(1);
  });

  it("BELİRSİZ sonuç ama Paddle'da abonelik ETKİN (cevap kayboldu) → 200 mutabakat", async () => {
    paddle.resume = "ambiguous";
    paddle.afterAmbiguous = "active";
    const r = await doResume(await token());
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, reconciled: true });
  });

  it("KONTROL: etkin / iptal edilmiş abonelik devam ettirilmez (400, Paddle'a gidilmez); yönetici (sahip değil) 403", async () => {
    await prisma.subscription.update({ where: { organizationId: orgId }, data: { status: "active" } });
    expect((await doPreview()).status).toBe(400);
    await prisma.subscription.update({ where: { organizationId: orgId }, data: { status: "canceled" } });
    expect((await doPreview()).status).toBe(400);
    expect(resumeCalls).toBe(0);
    await prisma.subscription.update({ where: { organizationId: orgId }, data: { status: "paused" } });
    session = { ...session!, role: "manager" };
    expect((await doPreview()).status).toBe(403);
  });

  it("başka işletmenin belirteci bu işletmede geçmez", async () => {
    const t = await token();
    const other = await prisma.organization.create({ data: { name: "B" } });
    const u = await prisma.user.create({ data: { organizationId: other.id, name: "B", email: "b@x.com", passwordHash: "x", role: "owner" } });
    await prisma.subscription.create({ data: { organizationId: other.id, planCode: "pro", status: "paused", provider: "paddle", providerRef: "sub_1", customerId: "ctm_1" } });
    session = { userId: u.id, organizationId: other.id, role: "owner", email: "b@x.com", name: "B", sessionEpoch: 0 };
    expect((await doResume(t)).status).toBe(400);
    expect(resumeCalls).toBe(0);
  });

  it("webhook abonelik ETKİN yazınca devam kilidi kalkar", async () => {
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", "whsec-test");
    await doResume(await token());
    expect(await prisma.systemLock.count({ where: { name: RESUME_PENDING_LOCK(orgId) } })).toBe(1);
    const body = JSON.stringify({
      event_id: "evt_resumed",
      event_type: "subscription.resumed",
      occurred_at: new Date().toISOString(),
      data: { id: "sub_1", status: "active", items: [{ price: { id: "pri_pro" } }] },
    });
    const ts = Math.floor(Date.now() / 1000);
    const h1 = createHmac("sha256", "whsec-test").update(`${ts}:${body}`, "utf8").digest("hex");
    const res = await webhook(
      new NextRequest("http://localhost/api/webhooks/paddle", { method: "POST", headers: { "content-type": "application/json", "paddle-signature": `ts=${ts};h1=${h1}` }, body }),
    );
    expect(res.status).toBe(200);
    expect(await prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } })).toMatchObject({ status: "active" });
    expect(await prisma.systemLock.count({ where: { name: RESUME_PENDING_LOCK(orgId) } })).toBe(0);
  });

  it("🚨 Haiku 10-17: webhook kayboldu — yerelde 'duraklatılmış', Paddle'da ETKİN → önizleme reddedilir, Paddle'a devam GÖNDERİLMEZ (ikinci tahsilat yok)", async () => {
    paddle.status = "active";
    const res = await doPreview();
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("Aboneliğiniz zaten etkin.");
    expect(resumeCalls).toBe(0);
  });

  it("🚨 Haiku 10-17: belirsiz sonuç + Paddle'da ödeme gecikmesi (devam etti, kart reddi) → 402 + kart güncelleme bağlantısı, kilit kalkar", async () => {
    paddle.resume = "ambiguous";
    paddle.afterAmbiguous = "past_due";
    const r = await doResume(await token());
    expect(r.status).toBe(402);
    expect(await r.json()).toMatchObject({ cardUpdateUrl: "https://portal/card" });
    expect(await prisma.systemLock.count({ where: { name: RESUME_PENDING_LOCK(orgId) } })).toBe(0);
  });

  it("🚨 Haiku 10-17: tutar KATI — boş toplam / para birimi yok / müşteri kimliği yok → onay AÇILMAZ (tahmini ya da sıfır rakamla para çekilmez)", async () => {
    paddle.total = "";
    expect((await doPreview()).status).toBe(503);
    paddle.total = "89900";
    paddle.currency = null;
    expect((await doPreview()).status).toBe(503);
    paddle.currency = "TRY";
    await prisma.subscription.update({ where: { organizationId: orgId }, data: { customerId: null } });
    paddle.customerId = null;
    expect((await doPreview()).status).toBe(400);
    expect(resumeCalls).toBe(0);
  });

  it("onaylanan tutar denetim kaydında (gerçek tahsilatla karşılaştırma için — kişisel veri yok)", async () => {
    await doResume(await token());
    const row = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "billing.resumed" } });
    expect(JSON.parse(row.metadataJson ?? "{}")).toMatchObject({ plan: "pro", amount: "₺899,00" });
  });
});
