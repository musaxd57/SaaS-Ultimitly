import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

// Stub the Paddle API layer (no network); capture the args the routes pass so we
// can assert upgrade→immediate / downgrade→next-period.
const { updateMock, previewMock, getPriceMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  previewMock: vi.fn(),
  getPriceMock: vi.fn(),
}));
vi.mock("@/lib/payments/paddle", async (orig) => ({
  ...(await orig<typeof import("@/lib/payments/paddle")>()), // fiyat → plan haritası gerçek (env'den)
  isPaddleConfigured: () => true,
  previewSubscriptionUpdate: previewMock,
  updateSubscriptionPlan: updateMock,
  getSubscriptionCurrentPriceId: getPriceMock,
}));

import { POST as PREVIEW } from "@/app/api/billing/plan-preview/route";
import { POST as CHANGE } from "@/app/api/billing/plan-change/route";
import { CHECKOUT_CONSENT_COPY } from "@/lib/billing/consent-copy";
import { checkoutLegalTextHash } from "@/lib/legal-text-hash";
import { signPlanChangeToken } from "@/lib/billing/plan-change";

function req(body: unknown) {
  return new NextRequest("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({} as Record<string, never>) };

describe("plan change routes (gated, PATCH /subscriptions)", () => {
  let orgId: string;
  // Mint a valid preview token the way /plan-preview does. Apply requires one that
  // matches the resolved change (org + target price + mode) AND whose amount still
  // matches a fresh apply-time preview (previewMock returns "₺123,45" by default).
  const tok = (
    priceId: string,
    mode: "upgrade" | "downgrade",
    org = orgId,
    amount: string | null = "₺123,45",
    source: { sub?: string; from?: string; fromPrice?: string | null } = {},
  ) => signPlanChangeToken({ org, priceId, mode, amount, sub: source.sub ?? "sub_1", from: source.from ?? "pro", fromPrice: source.fromPrice ?? null });

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    updateMock.mockReset().mockResolvedValue({ ok: true });
    previewMock.mockReset().mockResolvedValue({
      mode: "prorated_immediately",
      immediateTotal: "₺123,45",
      recurringTotal: "₺899,00",
    });
    // Aboneliğin Paddle'daki şu anki fiyatı: varsayılan = kayıtlı plan (pro). (11-11: fiyat okunamazsa değişiklik HİÇ uygulanmaz — ayrı test.)
    getPriceMock.mockReset().mockResolvedValue("pri_pro");
    vi.stubEnv("PADDLE_PLAN_CHANGE_ENABLED", "1");
    vi.stubEnv("PADDLE_PRICE_BASLANGIC", "pri_baslangic");
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
    vi.stubEnv("PADDLE_PRICE_ISLETME", "pri_isletme");

    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    const user = await prisma.user.create({
      data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" },
    });
    session = { userId: user.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
    await prisma.subscription.create({
      data: { organizationId: orgId, planCode: "pro", status: "active", provider: "paddle", providerRef: "sub_1" },
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("owner-only (withOwner): a MANAGER gets 403 on preview AND apply, no Paddle call", async () => {
    // Billing is owner-scoped in the UI; the API matches so a manager can't drive a
    // plan change via a direct request. The guard runs before the body is read.
    session = { ...(session as SessionPayload), role: "manager" };
    expect((await PREVIEW(req({ planCode: "business" }), ctx)).status).toBe(403);
    expect(
      (await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: tok("pri_isletme", "upgrade") }), ctx)).status,
    ).toBe(403);
    expect(previewMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  // ── YILLIK ABONE KADEME DEĞİŞTİREMEZ (08-07 (2)) ─────────────────────────
  //
  // 🚨 Bu kapı SUNUCUDA. Ayarlar kartındaki `disabled={… || annual}` seçicinin
  // durumuna bakıyor ve seçici her yüklemede "month" ile başlıyor → yıllık
  // abone için buton ZATEN AKTİF geliyordu. `priceIdForPlanCode` yalnız AYLIK
  // id döndürdüğü için tıklama, peşin ödenmiş yıllık aboneliği aylık fiyata
  // taşırdı. İstemci kapısı kimseyi korumuyordu.
  describe("yıllık abonelik koruması", () => {
    const withAnnualEnv = () => {
      vi.stubEnv("PADDLE_PRICE_BASLANGIC_YILLIK", "pri_bas_yil");
      vi.stubEnv("PADDLE_PRICE_PRO_YILLIK", "pri_pro_yil");
      vi.stubEnv("PADDLE_PRICE_ISLETME_YILLIK", "pri_is_yil");
    };

    it("YILLIK fiyattaki abone reddedilir — Paddle'a PATCH GİTMEZ", async () => {
      withAnnualEnv();
      getPriceMock.mockResolvedValue("pri_pro_yil"); // müşteri yıllık Pro'da
      const res = await PREVIEW(req({ planCode: "business" }), ctx);
      expect(res.status).toBe(400);
      // Sebep `fields.error` altında (badRequest sözleşmesi) ve istemci artık
      // ORAYI okuyor — jenerik "Doğrulama hatası" müşteriyi aynı butona
      // sonsuza kadar bastırırdı.
      expect((await res.json()).fields.error).toMatch(/Yıllık aboneliklerde/);
      expect(previewMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("AYLIK fiyattaki abone normal şekilde geçer (ters yön — kapı fazla geniş değil)", async () => {
      withAnnualEnv();
      getPriceMock.mockResolvedValue("pri_pro"); // müşteri aylık Pro'da
      const res = await PREVIEW(req({ planCode: "business" }), ctx);
      expect(res.status).toBe(200);
      expect(previewMock).toHaveBeenCalled();
    });

    it("🚨 Paddle OKUNAMAZSA reddedilir (FAIL-CLOSED)", async () => {
      // Yanlış dönemde faturalama geri alınması zor bir PARA hatası; engellenen
      // plan değişimi geçici bir sürtünme. Belirsizlikte durmak doğru yön.
      withAnnualEnv();
      getPriceMock.mockResolvedValue(null);
      const res = await PREVIEW(req({ planCode: "business" }), ctx);
      expect(res.status).toBe(400);
      expect(previewMock).not.toHaveBeenCalled();
    });

    it("yıllık env YOKKEN Paddle'a HİÇ sorulmaz (davranış birebir eski)", async () => {
      // Yıllık satmayan deployment'a ne gecikme ne yeni arıza yüzeyi eklenmeli.
      getPriceMock.mockResolvedValue("pri_pro_yil"); // önemsiz — sorulmamalı
      const res = await PREVIEW(req({ planCode: "business" }), ctx);
      expect(res.status).toBe(200);
      expect(getPriceMock).not.toHaveBeenCalled();
    });
  });

  it("preview: pro→business is an upgrade (immediate proration)", async () => {
    const res = await PREVIEW(req({ planCode: "business" }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("upgrade");
    expect(typeof body.previewToken).toBe("string");
    expect(body.previewToken.length).toBeGreaterThan(0);
    expect(previewMock).toHaveBeenCalledWith("sub_1", "pri_isletme", "prorated_immediately", orgId);
  });

  it("round-trip: the token minted by preview authorizes the apply", async () => {
    const previewBody = await (await PREVIEW(req({ planCode: "business" }), ctx)).json();
    const res = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: previewBody.previewToken }), ctx);
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith("sub_1", "pri_isletme", "prorated_immediately", orgId);
  });

  it("preview: pro→free is a downgrade (next billing period)", async () => {
    const res = await PREVIEW(req({ planCode: "free" }), ctx);
    expect((await res.json()).mode).toBe("downgrade");
    expect(previewMock).toHaveBeenCalledWith("sub_1", "pri_baslangic", "prorated_next_billing_period", orgId);
  });

  it("🚨 B-2 (kurucu 11-04): 3 daireli hesap Başlangıç'a (en fazla 2) DÜŞEMEZ — önizleme ve uygulama reddeder, Paddle'a hiç gidilmez", async () => {
    await prisma.property.createMany({ data: [1, 2, 3].map((i) => ({ organizationId: orgId, name: `Lale ${i}` })) });
    const pre = await PREVIEW(req({ planCode: "free" }), ctx);
    expect(pre.status).toBe(400);
    expect(JSON.stringify(await pre.json())).toContain("Hesabınızda 3 daire var; Başlangıç planı en fazla 2 daire içindir.");
    const apply = await CHANGE(req({ immediateStartConsent: true, planCode: "free", previewToken: tok("pri_baslangic", "downgrade") }), ctx);
    expect(apply.status).toBe(400);
    expect(previewMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    // KONTROL: aynı hesap sığan plana (İşletme) yükselebilir.
    expect((await PREVIEW(req({ planCode: "business" }), ctx)).status).toBe(200);
  });

  // Kurucu 11-13 ("en yasal şekilde") + Opus P2-4: yükseltmede fark ANINDA tahsil edilir → ödeme ekranıyla aynı "hemen başlasın / cayma
  // hakkımı kaybediyorum" onayı zorunlu. Yoksa hiçbir şey tüketilmez / Paddle'a gitmez; varsa kanıtı denetim kaydına yazılır.
  it("🚨 change: onaysız YÜKSELTME → 400 alan hatası, Paddle'a gidilmez, onay belirteci tüketilmez (aynı belirteçle onaylı istek geçer)", async () => {
    const token = tok("pri_isletme", "upgrade");
    const res = await CHANGE(req({ planCode: "business", previewToken: token }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).fields).toMatchObject({ immediateStartConsent: CHECKOUT_CONSENT_COPY.immediateStart.missing });
    expect(updateMock).not.toHaveBeenCalled();
    const ok = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: token }), ctx);
    expect(ok.status).toBe(200);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "billing.immediate_start_consent" } });
    expect(audit.metadataJson).toContain(checkoutLegalTextHash(["immediateStart"]));
  });

  it("change: DÜŞÜRMEDE anlık tahsilat yok → onay istenmez", async () => {
    const res = await CHANGE(req({ planCode: "free", previewToken: tok("pri_baslangic", "downgrade") }), ctx);
    expect(res.status).not.toBe(400);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "billing.immediate_start_consent" } })).toBe(0);
  });

  it("change: applies an upgrade with immediate proration", async () => {
    const res = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: tok("pri_isletme", "upgrade") }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith("sub_1", "pri_isletme", "prorated_immediately", orgId);
  });

  it("change: 502 on a DEFINITIVE (4xx) rejection — sağlayıcının ham sebebi müşteriye GİTMEZ (K3, 10-17)", async () => {
    updateMock.mockResolvedValue({ ok: false, kind: "definitive", reason: "Paddle HTTP 400 (subscription_locked) env=production resource=subscriptions" });
    const res = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: tok("pri_isletme", "upgrade") }), ctx);
    expect(res.status).toBe(502);
    const body = await res.json();
    // ⬅️ ESKİDE `detail: "Paddle HTTP 400 (subscription_locked) env=production …"` ekranda "(…)" olarak çıkıyordu.
    expect(JSON.stringify(body)).not.toMatch(/subscription_locked|env=|Paddle HTTP/);
    expect(body.error).toBe("Plan değişikliği yapılamadı; planınız değişmedi. Lütfen tekrar deneyin, sorun sürerse bize yazın.");
    // 15 ajan A10 F6: reddedilen deneme de iz bırakır; "değiştirildi" kaydı YAZILMAZ.
    const rows = await prisma.auditLog.findMany({ where: { action: { startsWith: "billing.plan_change" } } });
    expect(rows.map((r) => r.action)).toEqual(["billing.plan_change_rejected"]);
    expect(JSON.parse(rows[0].metadataJson ?? "{}")).toMatchObject({ from: "pro", to: "business" });
  });

  it("change: 400 when no preview token is supplied (no blind apply)", async () => {
    const res = await CHANGE(req({ immediateStartConsent: true, planCode: "business" }), ctx);
    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("change: 400 when the token is for a different price (no reuse across plans)", async () => {
    // A token minted for a downgrade to free can't authorize the business upgrade.
    const res = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: tok("pri_baslangic", "downgrade") }), ctx);
    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("change: 400 when the token is for a different org (no cross-tenant reuse)", async () => {
    const res = await CHANGE(
      req({ planCode: "business", previewToken: tok("pri_isletme", "upgrade", "someone-else") }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("change: 400 when the token is tampered/forged (bad HMAC)", async () => {
    const valid = tok("pri_isletme", "upgrade");
    const forged = `${valid.split(".")[0]}.deadbeef`;
    const res = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: forged }), ctx);
    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("change: a valid token is SINGLE-USE — the second apply is rejected, only one Paddle mutation", async () => {
    const t = tok("pri_isletme", "upgrade");
    const first = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: t }), ctx);
    expect(first.status).toBe(200);
    // Same token, still inside its 10-min TTL: a replay (double-submit / stolen
    // token) must NOT drive a second PATCH/charge.
    const second = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: t }), ctx);
    expect(second.status).toBe(409);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("change: a DEFINITIVE (4xx) failure RELEASES the nonce so the same token can be retried", async () => {
    const t = tok("pri_isletme", "upgrade");
    updateMock.mockResolvedValueOnce({ ok: false, kind: "definitive", reason: "Paddle HTTP 400 (bad_request) env=production resource=subscriptions" });
    expect((await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: t }), ctx)).status).toBe(502);
    // Paddle rejected → nothing mutated → the token isn't burned → retry proceeds.
    const retry = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: t }), ctx);
    expect(retry.status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(2);
  });

  it("change: an AMBIGUOUS failure keeps the nonce consumed; reconcile sees target price → success, NO second PATCH", async () => {
    const t = tok("pri_isletme", "upgrade");
    // The PATCH reached Paddle and applied, but the response was lost (timeout).
    updateMock.mockResolvedValueOnce({ ok: false, kind: "ambiguous", reason: "The operation timed out" });
    getPriceMock.mockResolvedValueOnce("pri_pro"); // pre-PATCH check: not yet on target (still the source price)
    getPriceMock.mockResolvedValue("pri_isletme"); // reconcile GET: subscription IS on the target
    const first = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: t }), ctx);
    expect(first.status).toBe(200);
    expect((await first.json()).reconciled).toBe(true);
    // Same token again: nonce already consumed → 409, and NO second Paddle mutation.
    const retry = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: t }), ctx);
    expect(retry.status).toBe(409);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  // ── HIZLI DAL ARTIK DENETİM İZİ BIRAKIYOR (08-09 (2)) ──────────────────────
  //
  // 🚨 `alreadyOn === r.priceId` dalı `writeAudit`ten ÖNCE dönüyordu → PARA
  // ROTASINDA müşteriye "başarılı" denen bir sonuç HİÇBİR iz bırakmadan
  // geçiyordu. Kardeş "ambiguous → reconciled" dalı aşağı düşüp audit yazıyor;
  // asimetri kazaraydı. Bu dal Paddle'a hiçbir istek GÖNDERMEZ ("already
  // applied olanı yeniden PATCH etme" kuralı) — kayıt bu yüzden `noop: true`.
  it("🚨 change: Paddle ZATEN hedefteyken audit YAZILIR ve PATCH gönderilmez", async () => {
    const t = tok("pri_isletme", "upgrade");
    getPriceMock.mockResolvedValue("pri_isletme"); // hızlı yol: zaten hedefte

    const res = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: t }), ctx);

    expect(res.status).toBe(200);
    expect((await res.json()).reconciled).toBe(true);
    expect(updateMock).not.toHaveBeenCalled(); // Paddle'a DOKUNULMADI

    const rows = await prisma.auditLog.findMany({ where: { action: "billing.plan_change" } });
    expect(rows).toHaveLength(1);
    // `metadataJson` kolonu STRING'dir — nesne gibi eşleştirmek sessizce geçerdi.
    expect(JSON.parse(rows[0].metadataJson ?? "{}")).toMatchObject({
      from: "pro",
      to: "business",
      reconciled: true,
      noop: true,
    });
  });

  it("change: an AMBIGUOUS failure NOT reconciled to target → 202 pending, nonce stays consumed, NO second PATCH", async () => {
    const t = tok("pri_isletme", "upgrade");
    updateMock.mockResolvedValueOnce({ ok: false, kind: "ambiguous", reason: "fetch failed" });
    getPriceMock.mockResolvedValue("pri_pro"); // still the old price / unknown
    const first = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: t }), ctx);
    expect(first.status).toBe(202);
    expect((await first.json()).pending).toBe(true);
    // 🚨 15 ajan A10 F6: tahsilat gerçekleşmiş olabilir → "bekliyor" kaydı; "değiştirildi" kaydı YAZILMAZ.
    const rows = await prisma.auditLog.findMany({ where: { action: { startsWith: "billing.plan_change" } } });
    expect(rows.map((r) => r.action)).toEqual(["billing.plan_change_pending"]);
    expect(JSON.parse(rows[0].metadataJson ?? "{}")).toMatchObject({ from: "pro", to: "business" });
    // We must NOT blindly re-send (could double-apply) → the same token is still spent.
    const retry = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: t }), ctx);
    expect(retry.status).toBe(409);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("change: 409 when the apply-time amount differs from the previewed amount (no blind charge)", async () => {
    // The customer confirmed "₺123,45"; by apply time Paddle now computes a
    // different immediate charge → refuse and make them re-confirm.
    previewMock.mockResolvedValue({ mode: "prorated_immediately", immediateTotal: "₺200,00", recurringTotal: "₺899,00" });
    const res = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: tok("pri_isletme", "upgrade", orgId, "₺123,45") }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).amountChanged).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("change: 409 when the currency differs at apply time (formatted string changes)", async () => {
    previewMock.mockResolvedValue({ mode: "prorated_immediately", immediateTotal: "$123.45", recurringTotal: "$899.00" });
    const res = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: tok("pri_isletme", "upgrade", orgId, "₺123,45") }), ctx);
    expect(res.status).toBe(409);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("change: 409 for an upgrade when the apply-time preview can't return an amount (fail-closed)", async () => {
    previewMock.mockResolvedValue(null); // Paddle preview failed at apply time
    const res = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: tok("pri_isletme", "upgrade") }), ctx);
    expect(res.status).toBe(409);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("404 (dormant) when the feature flag is OFF — nothing reaches Paddle", async () => {
    vi.stubEnv("PADDLE_PLAN_CHANGE_ENABLED", "");
    expect((await PREVIEW(req({ planCode: "business" }), ctx)).status).toBe(404);
    expect((await CHANGE(req({ immediateStartConsent: true, planCode: "business" }), ctx)).status).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("400 on the same plan, and on an org without a Paddle subscription", async () => {
    expect((await CHANGE(req({ immediateStartConsent: true, planCode: "pro" }), ctx)).status).toBe(400); // same plan
    await prisma.subscription.update({ where: { organizationId: orgId }, data: { provider: "manual" } });
    expect((await CHANGE(req({ immediateStartConsent: true, planCode: "business" }), ctx)).status).toBe(400); // not a Paddle sub
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("403 for a staff member (owner/manager only)", async () => {
    session = { ...(session as SessionPayload), role: "staff" };
    expect((await CHANGE(req({ immediateStartConsent: true, planCode: "business" }), ctx)).status).toBe(403);
  });
  // ── İPTAL EDİLMİŞ ABONELİK KAPISI (08-05) ───────────────────────────────────
  // Arayüz iptal edilmiş aboneliğe plan-değişimi ZATEN açmıyor; sunucu `status`'ü
  // seçmiyordu bile, yani doğrudan API çağrısı ölü bir Paddle id'sine PATCH
  // gönderebiliyordu. `plan-change` Paddle'a dokunmadan ÖNCE `jti` nonce'unu
  // tükettiği için belirsiz bir cevap müşteriyi hiç oturmayan bir "pending"
  // durumunda bırakabilirdi.
  it("iptal edilmiş abonelikte plan değişimi REDDEDİLİR — Paddle'a HİÇ gidilmez", async () => {
    await prisma.subscription.update({ where: { organizationId: orgId }, data: { status: "canceled" } });
    for (const [name, res] of [
      ["preview", await PREVIEW(req({ planCode: "business" }), ctx)],
      ["apply", await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: tok("pri_isletme", "upgrade") }), ctx)],
    ] as const) {
      expect(res.status, name).toBe(400);
      // ⚠️ Mesaj `fields.error`'da: `badRequest(fields)` argümanı ALAN HARİTASI
      // olarak sarıyor, üstteki `error` her zaman generic "Doğrulama hatası".
      // (İlk yazımda üst seviyeye baktım ve test haklı olarak kırmızı verdi.)
      expect((await res.json()).fields?.error, name).toContain("iptal edilmiş");
    }
    // Asıl kazanç: sağlayıcıya hiç dokunulmadı, nonce harcanmadı.
    expect(previewMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("Kurucu 10-16 (S4): duraklatılmış abonelikte plan değişimi açık metinle REDDEDİLİR — Paddle'a HİÇ gidilmez", async () => {
    await prisma.subscription.update({ where: { organizationId: orgId }, data: { status: "paused" } });
    for (const [name, res] of [
      ["preview", await PREVIEW(req({ planCode: "business" }), ctx)],
      ["apply", await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: tok("pri_isletme", "upgrade") }), ctx)],
    ] as const) {
      expect(res.status, name).toBe(400);
      expect((await res.json()).fields?.error, name).toContain("duraklatıldığı");
    }
    expect(previewMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("SADECE canceled / paused reddedilir — past_due/trialing/grandfathered plan değiştirebilir", async () => {
    // 🚨 Bu testin varlık sebebi: "active değilse reddet" gibi daha GENİŞ bir
    // kural, ödemesi gecikmiş (`past_due`; 10-16'dan beri ek süre yok, erişim ödenmiş dönem sonuna kadar) ödeyen bir müşteriyi plan
    // değiştiremez hâle getirirdi — arayüz ona izin verdiği hâlde. Kapının DAR
    // olduğu pinlenmezse o regresyon sessizce gelir.
    previewMock.mockResolvedValue({ immediateTotal: 100, currency: "TRY" });
    for (const status of ["active", "trialing", "past_due", "grandfathered"]) {
      await prisma.subscription.update({ where: { organizationId: orgId }, data: { status } });
      const res = await PREVIEW(req({ planCode: "business" }), ctx);
      expect(res.status, status).toBe(200);
    }
  });

  it("GERİ ALMA gerçek: BILLING_ALLOW_CANCELED_PLAN_CHANGE=1 eski davranışı aynen getirir", async () => {
    // Kaçış kapısı DEKORATİF OLMAMALI. Railway'de tek env ile, deploy beklemeden
    // geri alınabildiğini burada ölçüyoruz; yoksa "geri alınabilir" iddiası
    // sınanmamış bir söz olurdu.
    await prisma.subscription.update({ where: { organizationId: orgId }, data: { status: "canceled" } });
    previewMock.mockResolvedValue({ immediateTotal: 100, currency: "TRY" });
    vi.stubEnv("BILLING_ALLOW_CANCELED_PLAN_CHANGE", "1");
    expect((await PREVIEW(req({ planCode: "business" }), ctx)).status).toBe(200);
  });

  it("CONCURRENT applies with two DIFFERENT valid tokens: only ONE reaches Paddle", async () => {
    // First PATCH hangs in-flight; the second apply must be refused by the ATOMIC
    // pending claim (the old upsert let both through → double PATCH/charge).
    let releaseFirst!: (v: { ok: boolean }) => void;
    let entered!: () => void;
    const enteredFirstPatch = new Promise<void>((r) => (entered = r));
    updateMock.mockImplementationOnce(() => {
      entered(); // deterministic barrier: resolves the moment the PATCH is entered
      return new Promise((res) => (releaseFirst = res));
    });
    const p1 = CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: tok("pri_isletme", "upgrade") }), ctx);
    await enteredFirstPatch; // first request is INSIDE the PATCH, holding the claim
    const second = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: tok("pri_isletme", "upgrade") }), ctx);
    expect(second.status).toBe(409);
    expect((await second.json()).pendingVerification).toBe(true);
    releaseFirst({ ok: true });
    expect((await p1).status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // ÖDEME P3 (Codex 11-10) — ESKİ ÖNİZLEME. Onay yalnız hedefi (fiyat + yön) bağlıyordu; müşteri önizlemeyi gördükten sonra abonelik başka
  // sekmede değişirse eski onay yeni durumun üstüne uygulanabiliyordu (özellikle düşürmede: anlık tutar iki tarafta da boş → tutar kıyası
  // hiçbir şey yakalamaz). Onay artık kaynağı da bağlar: abonelik + plan (+ biliniyorsa Paddle'daki fiyat).
  // ---------------------------------------------------------------------------
  describe("P3 — onay, önizlemenin yapıldığı abonelik / plan için geçerli", () => {
    const noCharge = () => previewMock.mockResolvedValue({ mode: "prorated_next_billing_period", immediateTotal: null, recurringTotal: "₺399,00" });
    const pendingRow = () => prisma.systemLock.findUnique({ where: { name: `plan-change-pending:${orgId}` } });

    it("🚨 önizlemeden sonra abonelik DEĞİŞTİ (yeni abonelik kimliği) → eski onay uygulanmaz, Paddle'a PATCH gitmez", async () => {
      noCharge();
      const preview = await (await PREVIEW(req({ planCode: "free" }), ctx)).json(); // pro → başlangıç (düşürme, tutar yok)
      await prisma.subscription.update({ where: { organizationId: orgId }, data: { providerRef: "sub_2" } }); // başka sekmede yeni abonelik
      const res = await CHANGE(req({ immediateStartConsent: true, planCode: "free", previewToken: preview.previewToken }), ctx);
      expect(res.status).toBe(400); // ⬅️ ESKİDE 200 (eski onay yeni aboneliğe uygulanıyordu)
      expect((await res.json()).fields.error).toMatch(/Tutar onayı bu plan için değil/);
      expect(updateMock).not.toHaveBeenCalled();
      // Erken ret: onay tüketilmeden ve Paddle'a yeniden tutar sorulmadan (önizleme yalnız bir kez — önizleme rotasında — çağrıldı).
      expect(previewMock).toHaveBeenCalledTimes(1);
    });

    it("🚨 önizlemeden sonra PLAN değişti (business'tan önizlendi, şimdi pro) → aynı hedefe düşürme onayı uygulanmaz", async () => {
      noCharge();
      await prisma.subscription.update({ where: { organizationId: orgId }, data: { planCode: "business" } });
      const preview = await (await PREVIEW(req({ planCode: "free" }), ctx)).json(); // business → başlangıç
      await prisma.subscription.update({ where: { organizationId: orgId }, data: { planCode: "pro" } }); // başka sekmede pro'ya inildi
      const res = await CHANGE(req({ immediateStartConsent: true, planCode: "free", previewToken: preview.previewToken }), ctx);
      expect(res.status).toBe(400); // ⬅️ ESKİDE 200
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("🚨 yerel satır henüz güncellenmedi ama Paddle'daki fiyat önizlemedekinden FARKLI → kilit alındıktan sonraki son bakış reddeder; kilit ve onay geri bırakılır", async () => {
      noCharge();
      const t = tok("pri_baslangic", "downgrade", orgId, null, { fromPrice: "pri_pro" });
      getPriceMock.mockResolvedValue("pri_isletme"); // Paddle'da abonelik artık business (başka sekmenin değişikliği; webhook henüz gelmedi)
      const res = await CHANGE(req({ immediateStartConsent: true, planCode: "free", previewToken: t }), ctx);
      expect(res.status).toBe(400); // ⬅️ ESKİDE 200
      expect(updateMock).not.toHaveBeenCalled();
      const lock = await pendingRow();
      expect(lock === null || lock.lockedUntil <= new Date()).toBe(true); // "işleniyor" kilidi takılı kalmadı
      // Onay tüketilmedi: aynı onay, kaynak yeniden uyuşunca (ör. değişiklik geri alındı) kullanılabilir.
      getPriceMock.mockResolvedValue("pri_pro");
      expect((await CHANGE(req({ immediateStartConsent: true, planCode: "free", previewToken: t }), ctx)).status).toBe(200);
      expect(updateMock).toHaveBeenCalledTimes(1);
    });

    it("KONTROL: kaynak aynı (abonelik + plan + Paddle fiyatı) → uygulanır; önizlemede fiyat okunmamış olsa da (fromPrice boş) plan eşleşince uygulanır", async () => {
      noCharge();
      getPriceMock.mockResolvedValue("pri_pro");
      expect((await CHANGE(req({ immediateStartConsent: true, planCode: "free", previewToken: tok("pri_baslangic", "downgrade", orgId, null, { fromPrice: "pri_pro" }) }), ctx)).status).toBe(200);
      expect((await CHANGE(req({ immediateStartConsent: true, planCode: "free", previewToken: tok("pri_baslangic", "downgrade", orgId, null) }), ctx)).status).toBe(200);
      expect(updateMock).toHaveBeenCalledTimes(2);
    });

    it("🚨 önizlemede fiyat okunmamış (fromPrice boş) + yerel satır eski: Paddle'daki fiyat BAŞKA plana karşılık geliyorsa uygulanmaz (Haiku incelemesi 11-11)", async () => {
      // Sekme 1 pro → business yükseltmesini uyguladı (webhook henüz gelmedi: yerel plan hâlâ pro). Sekme 2'nin eski "pro → başlangıç" onayı.
      noCharge();
      getPriceMock.mockResolvedValue("pri_isletme");
      const t = tok("pri_baslangic", "downgrade", orgId, null);
      const res = await CHANGE(req({ immediateStartConsent: true, planCode: "free", previewToken: t }), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).fields.error).toMatch(/Tutar onayı bu plan için değil/);
      expect(updateMock).not.toHaveBeenCalled();
      const lock = await pendingRow();
      expect(lock === null || lock.lockedUntil <= new Date()).toBe(true);
    });

    it("🚨 kör PATCH yok: aboneliğin Paddle'daki fiyatı okunamazsa değişiklik uygulanmaz (503), kilit ve onay geri bırakılır; okuma düzelince aynı onay geçer", async () => {
      const t = tok("pri_isletme", "upgrade");
      getPriceMock.mockResolvedValue(null);
      const res = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: t }), ctx);
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatch(/planınız değişmedi/);
      expect(updateMock).not.toHaveBeenCalled();
      const lock = await pendingRow();
      expect(lock === null || lock.lockedUntil <= new Date()).toBe(true);
      getPriceMock.mockResolvedValue("pri_pro");
      expect((await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: t }), ctx)).status).toBe(200);
      expect(updateMock).toHaveBeenCalledTimes(1);
    });

    it("kaynağı taşımayan (eski biçim) onay geçersizdir — müşteri tutarı yeniden onaylar", async () => {
      const { createHmac } = await import("node:crypto");
      const body = Buffer.from(JSON.stringify({ org: orgId, priceId: "pri_isletme", mode: "upgrade", amount: "₺123,45", jti: "eski-bicim", exp: Date.now() + 60_000 })).toString("base64url");
      const legacy = `${body}.${createHmac("sha256", process.env.AUTH_SECRET ?? "").update(body).digest("base64url")}`;
      const res = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: legacy }), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).fields.error).toMatch(/süresi doldu/); // belirteç geçersiz sayıldı (yeniden önizleme istenir)
      expect(updateMock).not.toHaveBeenCalled();
      // Yalnız abonelik / plan alanı eksik olan belirteç de geçersiz (fiyat alanı doğru biçimde olsa bile).
      const body2 = Buffer.from(JSON.stringify({ org: orgId, priceId: "pri_isletme", mode: "upgrade", amount: "₺123,45", fromPrice: null, jti: "eski-bicim-2", exp: Date.now() + 60_000 })).toString("base64url");
      const legacy2 = `${body2}.${createHmac("sha256", process.env.AUTH_SECRET ?? "").update(body2).digest("base64url")}`;
      const res2 = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: legacy2 }), ctx);
      expect(res2.status).toBe(400);
      expect((await res2.json()).fields.error).toMatch(/süresi doldu/);
    });
  });

  // ---------------------------------------------------------------------------
  // ÖDEME P4 (Codex 11-10) — KİLİT SAHİBİ. "Zaten hedefteyiz" dalı kilidi ADLA siliyordu ve bu okuma kilit alınmadan önce yapılıyordu →
  // o arada başka bir isteğin aldığı kilit de gidiyordu (üçüncü istek ikinci PATCH sürerken Paddle'a gidebilirdi).
  // ---------------------------------------------------------------------------
  it("🚨 P4: 'zaten hedefteyiz' görecek istek, o sırada PATCH'i süren BAŞKA isteğin kilidini SİLMEZ", async () => {
    let releaseB!: (v: { ok: boolean }) => void;
    let enteredB!: () => void;
    const bInPatch = new Promise<void>((r) => (enteredB = r));
    updateMock.mockImplementationOnce(() => {
      enteredB();
      return new Promise((res) => (releaseB = res));
    });
    // A isteği tutar kıyasındayken (kilitten ÖNCE) B isteği başlar, kilidi alır ve PATCH'e girer.
    let pB: Promise<Response> | null = null;
    previewMock.mockImplementationOnce(async () => {
      getPriceMock.mockResolvedValueOnce("pri_pro"); // B'nin "zaten hedefte mi" okuması: değil (hâlâ kaynak fiyat) → PATCH
      pB = CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: tok("pri_isletme", "upgrade") }), ctx);
      await bInPatch;
      getPriceMock.mockResolvedValue("pri_isletme"); // A okursa: zaten hedefte (B'nin değişikliği Paddle'a ulaştı)
      return { mode: "prorated_immediately", immediateTotal: "₺123,45", recurringTotal: "₺899,00" };
    });
    const a = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: tok("pri_isletme", "upgrade") }), ctx);
    const lock = await prisma.systemLock.findUnique({ where: { name: `plan-change-pending:${orgId}` } });
    expect(lock !== null && lock.lockedUntil > new Date()).toBe(true); // ⬅️ ESKİDE silinmişti (B'nin PATCH'i sürerken)
    expect(a.status).toBe(409); // A sıradaki değişikliği bekler
    releaseB({ ok: true });
    expect((await pB!).status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(await prisma.systemLock.count({ where: { name: `plan-change-pending:${orgId}`, lockedUntil: { gt: new Date() } } })).toBe(0); // B kendi kilidini bıraktı
  });

  it("🚨 P4: süresi aşan (kilidi düşmüş) isteğin geç temizliği, o arada kilidi alan YENİ isteğin kilidini silmez", async () => {
    const lockName = `plan-change-pending:${orgId}`;
    let finishFirst!: (v: { ok: boolean }) => void;
    let finishSecond!: (v: { ok: boolean }) => void;
    let secondEntered!: () => void;
    const secondInPatch = new Promise<void>((r) => (secondEntered = r));
    let pSecond: Promise<Response> | null = null;
    updateMock
      .mockImplementationOnce(async () => {
        // Birinci istek PATCH'te takıldı ve kilidinin süresi doldu → ikinci istek kilidi alıp kendi PATCH'ine girer.
        await prisma.systemLock.update({ where: { name: lockName }, data: { lockedUntil: new Date(Date.now() - 1_000) } });
        pSecond = CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: tok("pri_isletme", "upgrade") }), ctx);
        await secondInPatch;
        return new Promise((res) => (finishFirst = res));
      })
      .mockImplementationOnce(() => {
        secondEntered();
        return new Promise((res) => (finishSecond = res));
      });
    const pFirst = CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: tok("pri_isletme", "upgrade") }), ctx);
    await secondInPatch;
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf("function"));
    finishFirst({ ok: true });
    expect((await pFirst).status).toBe(200);
    const lock = await prisma.systemLock.findUnique({ where: { name: lockName } });
    expect(lock !== null && lock.lockedUntil > new Date()).toBe(true); // ⬅️ adla silinseydi ikinci isteğin kilidi giderdi
    finishSecond({ ok: true });
    expect((await pSecond!).status).toBe(200);
    expect(await prisma.systemLock.count({ where: { name: lockName, lockedUntil: { gt: new Date() } } })).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Codex 11-17 B2 — İSTEK SÜRERKEN ABONELİK DEĞİŞİRSE. Kaynak yalnız istek başında yerel satırdan karşılaştırılıyordu; yeniden önizleme /
  // fiyat okuması sırasında webhook kayıtlı aboneliği A'dan B'ye çevirirse rota A'ya PATCH atıp 200 dönüyordu (yükseltmede fark A'nın
  // kartından anında çekilir, yerel plan değişmez). Artık PATCH'ten hemen önce satır yeniden okunur; PATCH sırasında değişirse kayda işaret
  // düşer ve operatöre geçiş tabanlı alarm gider (müşteri yanıtı aynı).
  // ---------------------------------------------------------------------------
  describe("B2 — PATCH anında kayıtlı abonelik hâlâ önizlenen abonelik", () => {
    const pendingRow = () => prisma.systemLock.findUnique({ where: { name: `plan-change-pending:${orgId}` } });
    const swapTo = (data: { providerRef?: string; planCode?: string; status?: string }) => prisma.subscription.update({ where: { organizationId: orgId }, data });
    const supersededAlarm = () => prisma.systemLock.findUnique({ where: { name: `alert-state:billing-plan-change-superseded:${orgId}:sub_1` } });
    const lastAudit = async () => {
      const row = await prisma.auditLog.findFirst({ where: { organizationId: orgId, action: "billing.plan_change" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      return row ? { metadata: JSON.parse(row.metadataJson ?? "{}") as Record<string, unknown> } : null;
    };
    const body = (t: string) => req({ immediateStartConsent: true, planCode: "business", previewToken: t });

    async function expectRefusedThenSameTokenWorks(t: string, res: Response) {
      expect(res.status).toBe(400); // ⬅️ ESKİDE 200 + PATCH eski aboneliğe (sub_1)
      expect((await res.json()).fields.error).toMatch(/Tutar onayı bu plan için değil/);
      expect(updateMock).not.toHaveBeenCalled();
      const lock = await pendingRow();
      expect(lock === null || lock.lockedUntil <= new Date()).toBe(true); // "işleniyor" kilidi takılı kalmadı
      // Onay tüketilmedi: satır önizlenen hâline dönünce AYNI onay geçer.
      await swapTo({ providerRef: "sub_1", planCode: "pro", status: "active" });
      expect((await CHANGE(body(t), ctx)).status).toBe(200);
      expect(updateMock).toHaveBeenCalledTimes(1);
      expect(updateMock.mock.calls[0][0]).toBe("sub_1");
    }

    it("🚨 yeniden önizleme sırasında kayıtlı abonelik B'ye geçti → PATCH YOK, 400 (var olan metin), kilit serbest, onay tüketilmedi", async () => {
      const t = tok("pri_isletme", "upgrade");
      previewMock.mockImplementationOnce(async () => {
        await swapTo({ providerRef: "sub_2" }); // webhook: yeni abonelik eskisinin yerine geçti
        return { mode: "prorated_immediately", immediateTotal: "₺123,45", recurringTotal: "₺899,00" };
      });
      await expectRefusedThenSameTokenWorks(t, await CHANGE(body(t), ctx));
    });

    it("🚨 Paddle fiyat okuması sırasında (kilitten sonra) abonelik B'ye geçti → aynı ret (yeniden okuma fiyat okumasından SONRA)", async () => {
      const t = tok("pri_isletme", "upgrade");
      getPriceMock.mockImplementationOnce(async () => {
        await swapTo({ providerRef: "sub_2" });
        return "pri_pro"; // A'nın Paddle'daki fiyatı değişmedi — eski son bakış bunu göremiyordu
      });
      await expectRefusedThenSameTokenWorks(t, await CHANGE(body(t), ctx));
    });

    it("🚨 fiyat okuması sırasında PLAN ya da DURUM değişti (aynı abonelik) → aynı ret", async () => {
      for (const change of [{ planCode: "business" }, { status: "paused" }, { status: "canceled" }]) {
        updateMock.mockClear();
        const t = tok("pri_isletme", "upgrade");
        getPriceMock.mockImplementationOnce(async () => {
          await swapTo(change);
          return "pri_pro";
        });
        const res = await CHANGE(body(t), ctx);
        expect(res.status, JSON.stringify(change)).toBe(400);
        expect(updateMock, JSON.stringify(change)).not.toHaveBeenCalled();
        await swapTo({ providerRef: "sub_1", planCode: "pro", status: "active" });
      }
    });

    it("🚨 PATCH sırasında abonelik B'ye geçti → müşteri yanıtı AYNI (200) ama kayıtta işaret + operatöre geçiş tabanlı alarm (yalnız kimlikler)", async () => {
      updateMock.mockImplementationOnce(async () => {
        await swapTo({ providerRef: "sub_2" });
        return { ok: true };
      });
      const res = await CHANGE(body(tok("pri_isletme", "upgrade")), ctx);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, mode: "upgrade", reconciled: false });
      expect((await lastAudit())?.metadata).toMatchObject({ subscriptionSupersededDuringApply: true });
      expect(await supersededAlarm()).not.toBeNull(); // ⬅️ ESKİDE iz yoktu
    });

    it("🚨 belirsiz PATCH → uzlaştırıldı (Paddle hedefte) ve o arada abonelik B'ye geçti → aynı işaret + alarm", async () => {
      updateMock.mockImplementationOnce(async () => {
        await swapTo({ providerRef: "sub_2" });
        return { ok: false, kind: "ambiguous" };
      });
      getPriceMock.mockResolvedValueOnce("pri_pro").mockResolvedValueOnce("pri_isletme"); // önce kaynak, sonra uzlaştırma: hedefte
      const res = await CHANGE(body(tok("pri_isletme", "upgrade")), ctx);
      expect(res.status).toBe(200);
      expect((await res.json()).reconciled).toBe(true);
      expect((await lastAudit())?.metadata).toMatchObject({ subscriptionSupersededDuringApply: true, reconciled: true });
      expect(await supersededAlarm()).not.toBeNull();
    });

    it("KONTROL (B2): satır değişmezse bugünkü akış aynen — 200, PATCH kayıtlı aboneliğe, işaret ve alarm YOK", async () => {
      const res = await CHANGE(body(tok("pri_isletme", "upgrade")), ctx);
      expect(res.status).toBe(200);
      expect(updateMock).toHaveBeenCalledTimes(1);
      expect(updateMock.mock.calls[0][0]).toBe("sub_1");
      expect((await lastAudit())?.metadata).not.toHaveProperty("subscriptionSupersededDuringApply");
      expect(await supersededAlarm()).toBeNull();
    });
  });
});
