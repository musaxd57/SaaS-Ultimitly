import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { evaluateTrialCardGates } from "@/lib/billing/trial-card-gate";
import { getEntitlement, premiumAllowed } from "@/lib/billing/subscription";

// ---------------------------------------------------------------------------
// Kartla deneme kapısı (kurucu 10-17, migration 74) — gerçek PostgreSQL. Saatlik iş yüksek riskli süren denemeyi damgalar, bandan düşeni
// temizler; damga YALNIZ anahtar + faturalandırma zorunluyken otomatik işleri durdurur; kart Paddle'da eklenince (sağlayıcı paddle)
// kapı kalkar. Anahtar kapalıyken hiçbir şey yazılmaz.
// ---------------------------------------------------------------------------

const DAY = 86_400_000;

async function trialOrg(email: string, opts: { identityReused?: boolean; verified?: boolean } = {}) {
  const org = await prisma.organization.create({ data: { name: email, ...(opts.identityReused ? { trialIdentityReusedAt: new Date() } : {}) } });
  await prisma.user.create({
    data: {
      organizationId: org.id,
      email,
      name: "S",
      passwordHash: "x",
      role: "owner",
      createdAt: new Date(Date.now() - 3 * DAY),
      emailVerifiedAt: opts.verified === false ? null : new Date(),
    },
  });
  await prisma.subscription.create({ data: { organizationId: org.id, planCode: "pro", provider: "trial", status: "trialing", trialEndsAt: new Date(Date.now() + 7 * DAY) } });
  return org.id;
}

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("TRIAL_CARD_GATE_ENABLED", "1");
  vi.stubEnv("PADDLE_PRICE_BASLANGIC_DENEME", "pri_b_t");
  vi.stubEnv("PADDLE_PRICE_PRO_DENEME", "pri_p_t");
  vi.stubEnv("PADDLE_PRICE_ISLETME_DENEME", "pri_i_t");
  vi.stubEnv("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN", "test_client_token");
  vi.stubEnv("BILLING_ENFORCED", "true");
  vi.stubEnv("PRIMARY_ORG_ID", "kurucu-org-yok");
});
afterEach(() => vi.unstubAllEnvs());

describe("kartla deneme kapısı", () => {
  it("🚨 ilan başka denemede kullanılmış (yüksek) → damga + sınırlı mod; temiz deneme etkilenmez; ikinci koşu yeniden damgalamaz", async () => {
    const risky = await trialOrg("risky@example.com", { identityReused: true });
    const clean = await trialOrg("clean@example.com");
    expect(await evaluateTrialCardGates()).toEqual({ required: 1, cleared: 0 });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: risky } })).trialCardRequiredAt).not.toBeNull();
    expect(await getEntitlement(risky)).toMatchObject({ cardRequired: true, active: false });
    expect(await premiumAllowed(risky)).toBe(false);
    expect(await getEntitlement(clean)).toMatchObject({ cardRequired: false, active: true });
    expect(await evaluateTrialCardGates()).toEqual({ required: 0, cleared: 0 });
    expect(await prisma.auditLog.count({ where: { organizationId: risky, action: "trial.card_required" } })).toBe(1);
  });

  it("🚨 kart Paddle'da eklendi (sağlayıcı paddle, trialing) → erişim AÇIK, saatlik iş damgayı temizler", async () => {
    const risky = await trialOrg("risky@example.com", { identityReused: true });
    await evaluateTrialCardGates();
    await prisma.subscription.update({ where: { organizationId: risky }, data: { provider: "paddle", providerRef: "sub_ct" } });
    expect(await getEntitlement(risky)).toMatchObject({ cardRequired: false, active: true });
    expect(await evaluateTrialCardGates()).toEqual({ required: 0, cleared: 1 });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: risky } })).trialCardRequiredAt).toBeNull();
  });

  it("operatör ilan işaretini kaldırınca puan düşer → saatlik iş damgayı temizler, erişim açılır", async () => {
    const risky = await trialOrg("risky@example.com", { identityReused: true });
    await evaluateTrialCardGates();
    await prisma.organization.update({ where: { id: risky }, data: { trialIdentityReusedAt: null, trialIdentityExempt: true } });
    expect(await evaluateTrialCardGates()).toEqual({ required: 0, cleared: 1 });
    expect(await getEntitlement(risky)).toMatchObject({ cardRequired: false, active: true });
  });

  it("KONTROL: anahtar KAPALI → hiçbir şey yazılmaz ve eski damga erişimi kapatmaz; faturalandırma zorunlu değilken damga etkisiz", async () => {
    const risky = await trialOrg("risky@example.com", { identityReused: true });
    await evaluateTrialCardGates();
    vi.stubEnv("TRIAL_CARD_GATE_ENABLED", "");
    expect(await getEntitlement(risky)).toMatchObject({ cardRequired: false, active: true });
    expect(await evaluateTrialCardGates()).toEqual({ required: 0, cleared: 0 });
    vi.stubEnv("TRIAL_CARD_GATE_ENABLED", "1");
    vi.stubEnv("BILLING_ENFORCED", "");
    expect(await getEntitlement(risky)).toMatchObject({ cardRequired: false, active: true });
  });

  it("kurucu org ve demo hesap hiç damgalanmaz; kurucu org eski damgayla da kilitlenmez", async () => {
    const founder = await trialOrg("founder@example.com", { identityReused: true });
    vi.stubEnv("PRIMARY_ORG_ID", founder);
    expect(await evaluateTrialCardGates()).toEqual({ required: 0, cleared: 0 });
    await prisma.organization.update({ where: { id: founder }, data: { trialCardRequiredAt: new Date() } });
    expect((await getEntitlement(founder)).active).toBe(true);
  });

  it("🚨 Haiku 10-17: operatör 'Kart şartını kaldır' → erişim hemen açılır, saatlik iş bir daha DAMGALAMAZ; kart istenmeyen hesapta 409", async () => {
    const risky = await trialOrg("risky@example.com", { identityReused: true });
    await evaluateTrialCardGates();
    const { exemptTrialCardGate } = await import("@/lib/billing/trial-operator");
    expect(await exemptTrialCardGate(risky, "op")).toEqual({ ok: true });
    expect(await getEntitlement(risky)).toMatchObject({ cardRequired: false, active: true });
    expect(await evaluateTrialCardGates()).toEqual({ required: 0, cleared: 0 });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: risky } })).trialCardRequiredAt).toBeNull();
    expect(await exemptTrialCardGate(risky, "op")).toEqual({ ok: false, reason: "not_card_required" });
  });

  it("Haiku 10-17: damga KOŞULLU — okuma ile yazma arasında deneme bittiyse damga yazılmaz", async () => {
    const risky = await trialOrg("risky@example.com", { identityReused: true });
    // Saatlik iş "şimdi"yi, deneme bitişinden SONRAKİ bir an olarak görürse aday değildir; aynı koşul yazımın içinde de var.
    await prisma.subscription.update({ where: { organizationId: risky }, data: { trialEndsAt: new Date(Date.now() - 1000) } });
    expect(await evaluateTrialCardGates()).toEqual({ required: 0, cleared: 0 });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: risky } })).trialCardRequiredAt).toBeNull();
  });
});
