import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { LEGAL_VERSION } from "@/lib/legal-entity";
import { checkoutLegalTextHash } from "@/lib/legal-text-hash";
import type { SessionPayload } from "@/lib/auth";
import { CHECKOUT_CONSENT_COPY, CHECKOUT_CONSENT_KEYS, checkoutConsentKeysFor } from "@/lib/billing/consent-copy";
import { CHECKOUT_CONSENT_FLAGS } from "../helpers/checkout-consent";

// route-guard's withAuth reads requireSession from @/lib/api (cross-module) — mock
// it so we can drive the session. null = unauthenticated.
let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/billing/consent/route";

// Gövdeye üç açık onay eklenir (rota üçünü de ister); eksik onay testi ham gövdeyi `rawPostReq` ile yollar.
function rawPostReq(body: unknown, extraHeaders?: Record<string, string>) {
  return new NextRequest("http://localhost/api/billing/consent", {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
}
function postReq(body: Record<string, unknown>, extraHeaders?: Record<string, string>) {
  return rawPostReq({ ...body, ...CHECKOUT_CONSENT_FLAGS }, extraHeaders);
}
const ctx = { params: Promise.resolve({} as Record<string, never>) };

describe("POST /api/billing/consent (checkout distance-sales evidence)", () => {
  let orgId: string;
  let userId: string;

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    const user = await prisma.user.create({
      data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" },
    });
    userId = user.id;
    session = { userId, organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("records the acceptance with server-derived version/IP/UA + session org+user", async () => {
    const res = await POST(
      postReq(
        { planCode: "pro", priceId: "pri_123" },
        { "x-forwarded-for": "1.2.3.4, 5.6.7.8", "user-agent": "TestBrowser/1.0" },
      ),
      ctx,
    );
    expect(res.status).toBe(201);
    const rows = await prisma.checkoutConsent.findMany({ where: { organizationId: orgId } });
    expect(rows).toHaveLength(1);
    // The row id is returned as the server-trusted nonce for the checkout customData.
    expect((await res.json()).consentId).toBe(rows[0].id);
    expect(rows[0]).toMatchObject({
      organizationId: orgId,
      userId,
      planCode: "pro",
      priceId: "pri_123",
      legalVersion: LEGAL_VERSION,
      legalTextHash: checkoutLegalTextHash(CHECKOUT_CONSENT_KEYS), // dört metin + gösterilen ÜÇ onay cümlesi
      ip: "5.6.7.8", // rightmost XFF, spoofed leftmost discarded
      userAgent: "TestBrowser/1.0",
    });
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  // -------------------------------------------------------------------------
  // İKİNCİ ABONELİK KAPISI (derin denetim, 2026-08-01).
  //
  // `Subscription` org başına TEK satırdır (`organizationId @unique`). Aynı
  // işletme için ikinci bir Paddle checkout'u tamamlanırsa webhook birincinin
  // `providerRef`'ini EZER → ilk abonelik Paddle'da faturalanmaya DEVAM eder
  // ama bizde görünmez olur (yenileme faturaları da yazılmaz, çünkü consent
  // 24 saat sonra bayatlar). Kapı UI'da vardı, SUNUCUDA YOKTU.
  // Predikat UI ile birebir aynı → yeni bloklama yüzeyi açmaz.
  // -------------------------------------------------------------------------
  it("canlı Paddle aboneliği varken YENİ checkout onayı REDDEDİLİR", async () => {
    await prisma.subscription.create({
      data: { organizationId: orgId, planCode: "pro", status: "active", provider: "paddle", providerRef: "sub_X" },
    });
    const res = await POST(postReq({ planCode: "business", priceId: "pri_9" }), ctx);
    expect(res.status).toBe(400);
    expect(await prisma.checkoutConsent.count()).toBe(0);
  });

  it("İPTAL EDİLMİŞ abonelik yeni checkout'u ENGELLEMEZ (mevcut ürün kararı)", async () => {
    await prisma.subscription.create({
      data: { organizationId: orgId, planCode: "pro", status: "canceled", provider: "paddle", providerRef: "sub_X" },
    });
    const res = await POST(postReq({ planCode: "pro", priceId: "pri_1" }), ctx);
    expect(res.status).toBe(201);
    expect(await prisma.checkoutConsent.count()).toBe(1);
  });

  it("deneme (providerRef'siz) satırı checkout'u ENGELLEMEZ", async () => {
    await prisma.subscription.create({
      data: { organizationId: orgId, planCode: "pro", status: "trialing", provider: "internal" },
    });
    const res = await POST(postReq({ planCode: "pro", priceId: "pri_1" }), ctx);
    expect(res.status).toBe(201);
  });

  it("🚨 kartla deneme fiyatı YALNIZ kart istenen hesaba açılır (Haiku 10-17: aksi hâlde doğrudan istekle deneme Paddle'da uzatılırdı)", async () => {
    vi.stubEnv("TRIAL_CARD_GATE_ENABLED", "1");
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
    vi.stubEnv("PADDLE_PRICE_BASLANGIC_DENEME", "pri_b_t");
    vi.stubEnv("PADDLE_PRICE_PRO_DENEME", "pri_p_t");
    vi.stubEnv("PADDLE_PRICE_ISLETME_DENEME", "pri_i_t");
    vi.stubEnv("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN", "test_client_token");
    vi.stubEnv("BILLING_ENFORCED", "true");
    try {
      await prisma.subscription.create({
        data: { organizationId: orgId, planCode: "pro", status: "trialing", provider: "trial", trialEndsAt: new Date(Date.now() + 5 * 86_400_000) },
      });
      // Kart istenmeyen deneme: deneme fiyatı RED, normal fiyat serbest.
      expect((await POST(postReq({ planCode: "pro", priceId: "pri_p_t" }), ctx)).status).toBe(400);
      expect((await POST(postReq({ planCode: "pro", priceId: "pri_pro" }), ctx)).status).toBe(201);
      // Kart istenen hesap: deneme fiyatı kabul.
      await prisma.organization.update({ where: { id: orgId }, data: { trialCardRequiredAt: new Date() } });
      expect((await POST(postReq({ planCode: "pro", priceId: "pri_p_t" }), ctx)).status).toBe(201);
      // Kurucu 11-13: kartla deneme fiyatında ücretli hizmet deneme BİTİNCE başlar → "hemen başlasın / cayma hakkımı kaybediyorum" onayı
      // İSTENMEZ (istemci o kutuyu göstermez); normal fiyatta aynı eksik gövde reddedilir (karar istemcinin değil fiyatın).
      const { immediateStartConsent: _omit, ...withoutImmediate } = { planCode: "pro", ...CHECKOUT_CONSENT_FLAGS };
      expect((await POST(rawPostReq({ ...withoutImmediate, priceId: "pri_p_t" }), ctx)).status).toBe(201);
      // Kartla deneme satırının özeti yalnız gösterilen İKİ cümleyi taşır (Opus P2-2).
      const trialRow = await prisma.checkoutConsent.findFirstOrThrow({ where: { organizationId: orgId, priceId: "pri_p_t" }, orderBy: { createdAt: "desc" } });
      expect(trialRow.legalTextHash).toBe(checkoutLegalTextHash(checkoutConsentKeysFor({ cardTrial: true })));
      const normal = await POST(rawPostReq({ ...withoutImmediate, priceId: "pri_pro" }), ctx);
      expect(normal.status).toBe(400);
      expect((await normal.json()).fields).toMatchObject({ immediateStartConsent: CHECKOUT_CONSENT_COPY.immediateStart.missing });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("FORBIDS staff (403, no row) — contract/payment authority is owner-only", async () => {
    session = { ...(session as NonNullable<typeof session>), role: "staff" };
    const res = await POST(postReq({ planCode: "pro", priceId: "pri_1" }), ctx);
    expect(res.status).toBe(403);
    expect(await prisma.checkoutConsent.count()).toBe(0);
  });

  it("FORBIDS a MANAGER too (403, no row) — owner-only (withOwner), matching the checkout UI", async () => {
    session = { ...(session as NonNullable<typeof session>), role: "manager" };
    const res = await POST(postReq({ planCode: "pro", priceId: "pri_1" }), ctx);
    expect(res.status).toBe(403);
    expect(await prisma.checkoutConsent.count()).toBe(0);
  });

  it("rejects unauthenticated requests (401, no row)", async () => {
    session = null;
    const res = await POST(postReq({ planCode: "pro", priceId: "pri_123" }), ctx);
    expect(res.status).toBe(401);
    expect(await prisma.checkoutConsent.count()).toBe(0);
  });

  // Kurucu 11-13 ("en yasal şekilde"): üç açık onay ayrı ayrı zorunlu — biri eksik ya da `true` dışında bir değerse kayıt YAZILMAZ ve
  // müşteri o kutunun cümlesini görür (ödeme ekranı kayıt olmadan açılmaz).
  it.each([
    ["preInfoConfirmed", CHECKOUT_CONSENT_COPY.preInfo.missing],
    ["contractAccepted", CHECKOUT_CONSENT_COPY.contract.missing],
    ["immediateStartConsent", CHECKOUT_CONSENT_COPY.immediateStart.missing],
  ] as const)("eksik onay %s → 400, alan hatası, kayıt yok", async (key, message) => {
    const missing: Record<string, unknown> = { planCode: "pro", priceId: "pri_123", ...CHECKOUT_CONSENT_FLAGS };
    delete missing[key];
    const res = await POST(rawPostReq(missing), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).fields).toMatchObject({ [key]: message });
    for (const wrong of [false, "true", 1]) {
      const r = await POST(rawPostReq({ ...missing, [key]: wrong }), ctx);
      expect(r.status).toBe(400);
    }
    expect(await prisma.checkoutConsent.count()).toBe(0);
  });

  it("onaysız eski gövde (yalnız plan + fiyat) artık kayıt yazmaz", async () => {
    const res = await POST(rawPostReq({ planCode: "pro", priceId: "pri_123" }), ctx);
    expect(res.status).toBe(400);
    expect(await prisma.checkoutConsent.count()).toBe(0);
  });

  it("validates the body (400 on empty planCode, no row)", async () => {
    const res = await POST(postReq({ planCode: "", priceId: "pri_123" }), ctx);
    expect(res.status).toBe(400);
    expect(await prisma.checkoutConsent.count()).toBe(0);
  });

  it("is IDOR-proof: a body-supplied org/user id is IGNORED — records for the session only", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    const res = await POST(
      postReq({ planCode: "pro", priceId: "pri_123", organizationId: otherOrg.id, userId: "hacker" }),
      ctx,
    );
    expect(res.status).toBe(201);
    expect(await prisma.checkoutConsent.count({ where: { organizationId: otherOrg.id } })).toBe(0);
    const mine = await prisma.checkoutConsent.findMany({ where: { organizationId: orgId } });
    expect(mine).toHaveLength(1);
    expect(mine[0].userId).toBe(userId); // the session user, not the body's "hacker"
  });

  it("is null-safe when IP/UA headers are absent", async () => {
    const res = await POST(postReq({ planCode: "pro", priceId: "pri_123" }), ctx);
    expect(res.status).toBe(201);
    const row = await prisma.checkoutConsent.findFirst({ where: { organizationId: orgId } });
    expect(row?.ip).toBe("unknown"); // clientIp fallback
    expect(row?.userAgent).toBeNull(); // header absent → null
  });

  it("rejects a planCode that does not match the priceId (fail-closed); a matching pair records normally", async () => {
    // Configure the server price→plan map so the cross-check is active.
    const prev = process.env.PADDLE_PRICE_PRO;
    process.env.PADDLE_PRICE_PRO = "pri_pro_live";
    try {
      // Mismatch: the "business" label against the Pro price → 400, no row.
      const bad = await POST(postReq({ planCode: "business", priceId: "pri_pro_live" }), ctx);
      expect(bad.status).toBe(400);
      expect(await prisma.checkoutConsent.count({ where: { organizationId: orgId } })).toBe(0);

      // Matching pair → recorded, and the stored plan is the price-derived "pro".
      const ok = await POST(postReq({ planCode: "pro", priceId: "pri_pro_live" }), ctx);
      expect(ok.status).toBe(201);
      const row = await prisma.checkoutConsent.findFirst({ where: { organizationId: orgId } });
      expect(row?.planCode).toBe("pro");
      expect(row?.priceId).toBe("pri_pro_live");
    } finally {
      if (prev === undefined) delete process.env.PADDLE_PRICE_PRO;
      else process.env.PADDLE_PRICE_PRO = prev;
    }
  });

  it("throttles abusive repeats (429 after the 20/user cap; no extra row)", async () => {
    for (let i = 0; i < 20; i++) {
      const ok = await POST(postReq({ planCode: "pro", priceId: "pri_123" }), ctx);
      expect(ok.status).toBe(201);
    }
    const throttled = await POST(postReq({ planCode: "pro", priceId: "pri_123" }), ctx);
    expect(throttled.status).toBe(429); // best-effort on the client → never blocks purchase
    expect(await prisma.checkoutConsent.count({ where: { organizationId: orgId } })).toBe(20); // 21st not written
  });

  // ---------------------------------------------------------------------------
  // B-2 (kurucu 11-04: "böyle birşey olamaz kesinlikle hata"): Pro denemesinde 7 daire açan müşteri Başlangıç (2 daire) satın alıp 7 dairenin
  // hepsinde otomasyonu sürdürebiliyordu — daire sınırı yalnız YENİ daireyi engelliyordu. Hesaptaki daire sayısı hedef planın sınırını
  // aşıyorsa o plan satın alınamaz (ödeme ekranı açılmaz, onay kaydı yazılmaz).
  // ---------------------------------------------------------------------------
  const addProperties = (n: number) =>
    prisma.property.createMany({ data: Array.from({ length: n }, (_, i) => ({ organizationId: orgId, name: `Lale ${i + 1}` })) });

  it("🚨 B-2: 3 daireli hesap Başlangıç (en fazla 2) satın alamaz — sade metin, onay kaydı YOK", async () => {
    await addProperties(3);
    const res = await POST(postReq({ planCode: "free", priceId: "pri_123" }), ctx);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain(
      "Hesabınızda 3 daire var; Başlangıç planı en fazla 2 daire içindir. Daha büyük bir plan seçin ya da önce daire sayısını azaltın.",
    );
    expect(await prisma.checkoutConsent.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it("KONTROL B-2: sınırda (2 daire → Başlangıç) ve sığan büyük plan (3 daire → Pro) satın alınabilir", async () => {
    await addProperties(2);
    expect((await POST(postReq({ planCode: "free", priceId: "pri_123" }), ctx)).status).toBe(201);
    await addProperties(1);
    expect((await POST(postReq({ planCode: "pro", priceId: "pri_123" }), ctx)).status).toBe(201);
  });
});
