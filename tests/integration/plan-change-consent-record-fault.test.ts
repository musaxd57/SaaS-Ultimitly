// ---------------------------------------------------------------------------
// Opus 11-13: yükseltmede "hemen başlasın / cayma hakkımı kaybediyorum" onayının KANITI zorunlu. Kayıt "en iyi çaba" idi (`.catch(() => {})`):
// yazım düşerse fark yine tahsil ediliyordu — cayma istisnası kanıtsız kalırdı. Artık kayıt, tek kullanımlık onay tüketilmeden ÖNCE ve
// zorunlu yazılır; yazılamazsa 503, Paddle'a gidilmez, onay belirteci tüketilmez (aynı belirteçle yeniden deneme geçer).
// ⚠️ Prisma temsilcisine casus kurulur → AYRI dosya (CLAUDE.md: `vi.spyOn` sonraki testlere sızar).
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
const { updateMock, previewMock, getPriceMock } = vi.hoisted(() => ({ updateMock: vi.fn(), previewMock: vi.fn(), getPriceMock: vi.fn() }));
vi.mock("@/lib/payments/paddle", async (orig) => ({
  ...(await orig<typeof import("@/lib/payments/paddle")>()),
  isPaddleConfigured: () => true,
  previewSubscriptionUpdate: previewMock,
  updateSubscriptionPlan: updateMock,
  getSubscriptionCurrentPriceId: getPriceMock,
}));

import { POST as CHANGE } from "@/app/api/billing/plan-change/route";
import { signPlanChangeToken } from "@/lib/billing/plan-change";

const req = (body: unknown) => new NextRequest("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({} as Record<string, never>) };

describe("yükseltme onayı kaydı zorunlu", () => {
  let orgId: string;
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    updateMock.mockReset().mockResolvedValue({ ok: true });
    previewMock.mockReset().mockResolvedValue({ mode: "prorated_immediately", immediateTotal: "₺123,45", recurringTotal: "₺899,00" });
    getPriceMock.mockReset().mockResolvedValue("pri_pro");
    vi.stubEnv("PADDLE_PLAN_CHANGE_ENABLED", "1");
    vi.stubEnv("PADDLE_PRICE_BASLANGIC", "pri_baslangic");
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
    vi.stubEnv("PADDLE_PRICE_ISLETME", "pri_isletme");
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    const user = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" } });
    session = { userId: user.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
    await prisma.subscription.create({ data: { organizationId: orgId, planCode: "pro", status: "active", provider: "paddle", providerRef: "sub_1" } });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("🚨 onay kaydı yazılamazsa → 503, Paddle'a gidilmez, belirteç tüketilmez; yazım düzelince aynı belirteçle geçer", async () => {
    const token = signPlanChangeToken({ org: orgId, priceId: "pri_isletme", mode: "upgrade", amount: "₺123,45", sub: "sub_1", from: "pro", fromPrice: null });
    const realCreate = prisma.auditLog.create.bind(prisma.auditLog);
    // Prisma temsilcisindeki casus `mockRestore` ile güvenle geri dönmüyor (CLAUDE.md) → arıza bir bayrakla açılıp kapanır.
    let failConsent = true;
    vi.spyOn(prisma.auditLog, "create").mockImplementation(((args: Parameters<typeof realCreate>[0]) => {
      if (failConsent && args.data.action === "billing.immediate_start_consent") return Promise.reject(new Error("db down")) as never;
      return realCreate(args) as never;
    }) as never);
    const res = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: token }), ctx);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/ücret alınmadı/);
    expect(updateMock).not.toHaveBeenCalled();
    failConsent = false;
    const ok = await CHANGE(req({ immediateStartConsent: true, planCode: "business", previewToken: token }), ctx);
    expect(ok.status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "billing.immediate_start_consent" } })).toBe(1);
  });
});
