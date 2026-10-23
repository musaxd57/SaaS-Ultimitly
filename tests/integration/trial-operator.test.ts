import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";
import { __resetRateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// Kurucu Q4 (10-17: "dediğin mantıklı") — gerçek PostgreSQL. Operatör riskli deneme listesinde denemeyi elle BİTİRİR / GERİ VERİR:
//  · yalnız süren deneme bitirilir (ödeyen / bitmiş deneme 409); hesap kapanmaz, erişim yalnız deneme süresinden düşer;
//  · müşteri ayarlarda sebepsiz onaylı metni görür (sabit pinli);
//  · genel "14 günlük denemeniz doldu" e-postası GİTMEZ (yanlış olurdu); geri verilince damgalar silinir;
//  · geri ver YALNIZ operatörün bitirdiği denemeyi açar; denetim kaydı her işlemde; yetkisiz 401.
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/email", () => ({ emailService: { sendReporting: vi.fn(async () => ({ ok: true })), send: vi.fn(async () => {}) } }));

import { POST as trialEnd } from "@/app/api/admin/trial-end/route";
import { TRIAL_END_REASON_OPERATOR, TRIAL_OPERATOR_ENDED_MESSAGE } from "@/lib/billing/trial-operator";
import { getEntitlement } from "@/lib/billing/subscription";
import { sendDueTrialReminders } from "@/lib/billing/trial-reminders";
import { emailService } from "@/lib/email";

const OPERATOR = "ops@lixusai.com";
const DAY = 86_400_000;

async function seed(sub: { provider: string; status: string; trialEndsAt: Date | null; trialEndReason?: string | null }) {
  const opOrg = await prisma.organization.create({ data: { name: "Lixus" } });
  const op = await prisma.user.create({
    data: { organizationId: opOrg.id, email: OPERATOR, name: "Op", passwordHash: "x", role: "owner", sessionEpoch: 1, twoFactorEnabledAt: new Date() },
  });
  const org = await prisma.organization.create({ data: { name: "Müşteri" } });
  await prisma.user.create({ data: { organizationId: org.id, email: "owner@x.com", name: "Sahip", passwordHash: "x", role: "owner" } });
  await prisma.subscription.create({ data: { organizationId: org.id, planCode: "pro", ...sub } });
  session = { userId: op.id, organizationId: opOrg.id, role: "owner", email: OPERATOR, name: "Op", sessionEpoch: 1, mfa: true } as SessionPayload;
  return org.id;
}

const call = (organizationId: string, action: string) =>
  trialEnd(new NextRequest("http://localhost/api/admin/trial-end", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId, action }) }));

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  vi.clearAllMocks();
  vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR);
  vi.stubEnv("BILLING_ENFORCED", "true");
  vi.stubEnv("TRIAL_EMAILS_ENABLED", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("operatör: denemeyi bitir / geri ver", () => {
  it("🚨 süren deneme bitirilir: erişim düşer, sebep 'operator_ended', genel 'deneme bitti' e-postası GİTMEZ; ikinci bitirme 409", async () => {
    const orgId = await seed({ provider: "trial", status: "trialing", trialEndsAt: new Date(Date.now() + 10 * DAY) });
    expect((await getEntitlement(orgId)).active).toBe(true);
    expect((await call(orgId, "end")).status).toBe(200);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });
    expect(sub.trialEndReason).toBe(TRIAL_END_REASON_OPERATOR);
    expect(sub.trialEndsAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect((await getEntitlement(orgId)).active).toBe(false);
    expect(await sendDueTrialReminders(new Date())).toEqual({ ending: 0, ended: 0 });
    expect(vi.mocked(emailService.sendReporting)).not.toHaveBeenCalled();
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "trial.operator_ended" } })).toBe(1);
    expect((await call(orgId, "end")).status).toBe(409);
  });

  it("🚨 geri ver: yalnız operatörün bitirdiği deneme — bugünden yeni süre, damgalar silinir (süresi dolunca e-posta yine gider)", async () => {
    const orgId = await seed({ provider: "trial", status: "trialing", trialEndsAt: new Date(Date.now() + 10 * DAY) });
    await call(orgId, "end");
    expect((await call(orgId, "restore")).status).toBe(200);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });
    expect(sub).toMatchObject({ trialEndReason: null, trialEndingSentAt: null, trialEndedSentAt: null });
    expect(sub.trialEndsAt!.getTime()).toBeGreaterThan(Date.now() + 13 * DAY);
    expect((await getEntitlement(orgId)).active).toBe(true);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "trial.operator_restored" } })).toBe(1);
    expect((await call(orgId, "restore")).status).toBe(409);
  });

  it("KONTROL: kendi süresi dolmuş deneme / ödeyen abonelik bitirilmez; ESKİ kural (ilan) ile bitmiş deneme bu yoldan geri VERİLMEZ", async () => {
    const lapsed = await seed({ provider: "trial", status: "trialing", trialEndsAt: new Date(Date.now() - DAY) });
    expect((await call(lapsed, "end")).status).toBe(409);
    expect((await call(lapsed, "restore")).status).toBe(409);
    await resetDb();
    const paying = await seed({ provider: "paddle", status: "active", trialEndsAt: null });
    expect((await call(paying, "end")).status).toBe(409);
    await resetDb();
    const identity = await seed({ provider: "trial", status: "trialing", trialEndsAt: new Date(Date.now() - DAY), trialEndReason: "identity_reused" });
    expect((await call(identity, "restore")).status).toBe(409);
    expect(await prisma.subscription.findUniqueOrThrow({ where: { organizationId: identity } })).toMatchObject({ trialEndReason: "identity_reused" });
  });

  it("yetki: operatör olmayan oturum 401; geçersiz işlem 400; bilinmeyen işletme 404", async () => {
    const orgId = await seed({ provider: "trial", status: "trialing", trialEndsAt: new Date(Date.now() + DAY) });
    expect((await call(orgId, "pause")).status).toBe(400);
    expect((await call("yok", "end")).status).toBe(404);
    session = { ...session!, email: "owner@x.com", mfa: true } as SessionPayload;
    expect((await call(orgId, "end")).status).toBe(401);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } })).trialEndReason).toBeNull();
  });

  it("müşteri metni kurucu onaylı (Q4) — sebep / risk sözcüğü yok", () => {
    expect(TRIAL_OPERATOR_ENDED_MESSAGE).toBe(
      "Ücretsiz denemeniz sona erdi. Devam etmek için bir plan seçin. Bir yanlışlık olduğunu düşünüyorsanız bize yazın.",
    );
    expect(TRIAL_OPERATOR_ENDED_MESSAGE).not.toMatch(/risk|kötüye|şüphe|IP|ilan/iu);
  });

  it("Haiku 10-17: kurucu org operatör yolundan bitirilemez (409, deneme sürer)", async () => {
    const orgId = await seed({ provider: "trial", status: "trialing", trialEndsAt: new Date(Date.now() + 5 * DAY) });
    vi.stubEnv("PRIMARY_ORG_ID", orgId);
    const res = await call(orgId, "end");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "protected_org" });
    expect((await prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } })).trialEndReason).toBeNull();
  });
});
