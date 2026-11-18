// ---------------------------------------------------------------------------
// Codex 11-17 B2 — PATCH öncesi / sonrası yerel abonelik okumasının ARIZA dalları.
//  · PATCH'ten hemen önceki okuma düşerse kör PATCH yok: 503 (var olan metin), kilit ve onay geri bırakılır; okuma düzelince aynı onay geçer.
//  · PATCH sonrası "abonelik değişti" alarmı düşerse istek düşmez: müşteri yanıtı aynı, kayıttaki işaret yine yazılır.
// ⚠️ Prisma temsilcisine casus kurulur → AYRI dosya (CLAUDE.md: `vi.spyOn` sonraki testlere sızar).
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
const { updateMock, previewMock, getPriceMock, alarm } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  previewMock: vi.fn(),
  getPriceMock: vi.fn(),
  alarm: { fail: false, calls: 0 },
}));
vi.mock("@/lib/payments/paddle", async (orig) => ({
  ...(await orig<typeof import("@/lib/payments/paddle")>()),
  isPaddleConfigured: () => true,
  previewSubscriptionUpdate: previewMock,
  updateSubscriptionPlan: updateMock,
  getSubscriptionCurrentPriceId: getPriceMock,
}));
vi.mock("@/lib/alert-state", async (orig) => {
  const actual = await orig<typeof import("@/lib/alert-state")>();
  return {
    ...actual,
    alertOnTransition: vi.fn(async (...args: Parameters<typeof actual.alertOnTransition>) => {
      alarm.calls++;
      if (alarm.fail) throw new Error("alarm yolu düştü");
      return actual.alertOnTransition(...args);
    }),
  };
});

import { POST as CHANGE } from "@/app/api/billing/plan-change/route";
import { signPlanChangeToken } from "@/lib/billing/plan-change";

const req = (body: unknown) => new NextRequest("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({} as Record<string, never>) };

describe("plan değişikliği: PATCH öncesi / sonrası abonelik okumasının arıza dalları (B2)", () => {
  let orgId: string;
  const token = () => signPlanChangeToken({ org: orgId, priceId: "pri_isletme", mode: "upgrade", amount: "₺123,45", sub: "sub_1", from: "pro", fromPrice: null });
  const body = (t: string) => req({ immediateStartConsent: true, planCode: "business", previewToken: t });
  // Prisma temsilcisindeki casus geri alınınca bozuk kalıyor (ölçüldü: sonraki testte "findUnique is not a function") → casus dosya başında
  // BİR KEZ kurulur, hiç geri alınmaz; arıza bayrakla açılır. İlk okuma (`resolvePlanChange`) geçer, ikincisi (PATCH öncesi okuma) düşer.
  const fault = { failReread: false, calls: 0 };
  beforeAll(() => {
    const realFind = prisma.subscription.findUnique.bind(prisma.subscription);
    vi.spyOn(prisma.subscription, "findUnique").mockImplementation(((args: Parameters<typeof realFind>[0]) => {
      fault.calls++;
      if (fault.failReread && fault.calls === 2) return Promise.reject(new Error("db down")) as never;
      return realFind(args) as never;
    }) as never);
  });

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    alarm.fail = false;
    alarm.calls = 0;
    fault.failReread = false;
    fault.calls = 0;
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
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 PATCH'ten hemen önceki okuma düşerse → 503 (var olan metin), Paddle'a gidilmez, kilit ve onay geri bırakılır; düzelince aynı onay geçer", async () => {
    const t = token();
    fault.failReread = true;
    const res = await CHANGE(body(t), ctx);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/planınız değişmedi/);
    expect(updateMock).not.toHaveBeenCalled();
    const lock = await prisma.systemLock.findUnique({ where: { name: `plan-change-pending:${orgId}` } });
    expect(lock === null || lock.lockedUntil <= new Date()).toBe(true);
    fault.failReread = false;
    expect((await CHANGE(body(t), ctx)).status).toBe(200); // onay tüketilmemişti
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("🚨 PATCH sonrası 'abonelik değişti' alarmı düşerse istek DÜŞMEZ: 200 aynen, kayıttaki işaret yine yazılır", async () => {
    alarm.fail = true;
    updateMock.mockImplementationOnce(async () => {
      await prisma.subscription.update({ where: { organizationId: orgId }, data: { providerRef: "sub_2" } });
      return { ok: true };
    });
    const res = await CHANGE(body(token()), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, mode: "upgrade", reconciled: false });
    expect(alarm.calls).toBe(1); // alarm denendi (ve düştü)
    const audit = await prisma.auditLog.findFirst({ where: { organizationId: orgId, action: "billing.plan_change" } });
    expect(JSON.parse(audit?.metadataJson ?? "{}")).toMatchObject({ subscriptionSupersededDuringApply: true });
  });
});
