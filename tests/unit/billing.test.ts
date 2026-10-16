import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

// Mock the DB so these stay pure unit tests (no test database needed).
vi.mock("@/lib/db", () => ({
  prisma: {
    subscription: { findUnique: vi.fn() },
    property: { count: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { getEntitlement, canAddProperty, billingEnforced, premiumAllowed, isFounderOrg } from "@/lib/billing/subscription";

const findUnique = vi.mocked(prisma.subscription.findUnique);
const count = vi.mocked(prisma.property.count);

// The single arbiter of founder/internal treatment: the entitlement guard AND
// the settings page (which swaps the customer billing card for the internal
// note) both key off this — a stale sandbox/test Subscription row must never
// present the founder as a paying customer.
describe("isFounderOrg", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("true ONLY for the exact PRIMARY_ORG_ID", () => {
    vi.stubEnv("PRIMARY_ORG_ID", "founder-org");
    expect(isFounderOrg("founder-org")).toBe(true);
    expect(isFounderOrg("customer-org")).toBe(false);
  });

  it("false for EVERY org when PRIMARY_ORG_ID is unset (never covers a customer by default)", () => {
    vi.stubEnv("PRIMARY_ORG_ID", "");
    expect(isFounderOrg("")).toBe(false);
    expect(isFounderOrg("any-org")).toBe(false);
  });
});

describe("billing entitlements (safe-by-default)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("treats an org with NO subscription as grandfathered + active + unlimited", async () => {
    findUnique.mockResolvedValue(null);
    const ent = await getEntitlement("org1");
    expect(ent.grandfathered).toBe(true);
    expect(ent.active).toBe(true);
    expect(ent.propertyLimit).toBeNull();
  });

  // Operator-created customer billing modes (admin/customers route). Each mode
  // ALWAYS writes a Subscription row, so no operator-created org silently relies
  // on the accidental missing-row grandfathered default.
  it("free-internal mode (grandfathered ROW) → active + unlimited, even ENFORCED", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({
      organizationId: "o", planCode: "grandfathered", status: "grandfathered",
      provider: "manual", createdAt: new Date(),
    } as never);
    const ent = await getEntitlement("o");
    expect(ent.active).toBe(true);
    expect(ent.propertyLimit).toBeNull();
    expect(ent.grandfathered).toBe(true);
    expect(await premiumAllowed("o")).toBe(true);
  });

  it("manual-billing mode (active/provider=manual ROW) → premium allowed, even ENFORCED", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({
      organizationId: "o", planCode: "pro", status: "active",
      provider: "manual", createdAt: new Date(),
    } as never);
    expect(await premiumAllowed("o")).toBe(true);
  });

  it("reads plan + limit + status from an existing subscription", async () => {
    findUnique.mockResolvedValue({ organizationId: "org1", planCode: "pro", status: "active" } as never);
    const ent = await getEntitlement("org1");
    expect(ent.planCode).toBe("pro");
    expect(ent.propertyLimit).toBe(7); // Pro = 3–7
    expect(ent.active).toBe(true);
  });

  it("NEVER blocks adding a property while billing is not enforced (dormant)", async () => {
    vi.stubEnv("BILLING_ENFORCED", "");
    expect(billingEnforced()).toBe(false);
    // Even a canceled sub over any limit is allowed while dormant.
    findUnique.mockResolvedValue({ organizationId: "org1", planCode: "free", status: "canceled" } as never);
    count.mockResolvedValue(99);
    const res = await canAddProperty("org1");
    expect(res.allowed).toBe(true);
  });

  it("enforces the property limit ONLY when BILLING_ENFORCED=true", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({ organizationId: "org1", planCode: "free", status: "active" } as never);
    count.mockResolvedValue(2); // free limit is 2
    const res = await canAddProperty("org1");
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("property_limit");
    expect(res.limit).toBe(2);
  });

  // 🚨 KURUCU MUAFİYETİ MÜLK KAPISINDA DA VAR (denetim, 08-09). `limitsForOrg`
  // 07-31'de tam bu sebeple düzeltilmişti ama MÜLK kapıları atlanmıştı:
  // `getEntitlement`in kurucu ağı yalnız `active`'i zorluyor, `propertyLimit`i
  // DEĞİŞTİRMİYOR. Kurucunun GERÇEK bir Pro aboneliği var (limit 7) ve ~10 daire
  // işletiyor → ürünün sahibi kendi ürününde yeni daire ekleyemiyordu.
  it("KURUCU mülk sınırına takılmaz — aynı abonelikle müşteri TAKILIR", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    vi.stubEnv("PRIMARY_ORG_ID", "founder-org");
    // Kurucunun canlıdaki durumu: gerçek, AKTİF Pro aboneliği + limitin üstünde daire.
    findUnique.mockResolvedValue({ organizationId: "x", planCode: "pro", status: "active" } as never);
    count.mockResolvedValue(10); // Pro limiti 7

    const founder = await canAddProperty("founder-org");
    expect(founder.allowed).toBe(true);
    expect(founder.limit).toBeNull(); // sınırsız olarak raporlanır

    // AYNI abonelikle SIRADAN bir org HÂLÂ engellenir — muafiyet org-kapsamlı,
    // blanket bir bypass değil (bu kontrol olmadan "her zaman izin ver"
    // mutasyonu da yeşil geçerdi).
    const customer = await canAddProperty("some-customer");
    expect(customer.allowed).toBe(false);
    expect(customer.reason).toBe("property_limit");
  });

  it("PRIMARY_ORG_ID SET DEĞİLKEN muafiyet YOK (fail-closed — env'siz kimse kurucu değil)", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    vi.stubEnv("PRIMARY_ORG_ID", "");
    findUnique.mockResolvedValue({ organizationId: "x", planCode: "pro", status: "active" } as never);
    count.mockResolvedValue(10);
    const res = await canAddProperty("founder-org");
    expect(res.allowed).toBe(false);
  });

  it("keeps grandfathered orgs unlimited even when enforcement is ON", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue(null); // no row → grandfathered
    const res = await canAddProperty("org1");
    expect(res.allowed).toBe(true);
    expect(count).not.toHaveBeenCalled();
  });
});

describe("premiumAllowed — paid/AI feature gate (free-tier downgrade)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("DORMANT: always allowed while BILLING_ENFORCED is off — even a canceled sub", async () => {
    vi.stubEnv("BILLING_ENFORCED", "");
    findUnique.mockResolvedValue({ organizationId: "o", planCode: "pro", status: "canceled" } as never);
    expect(await premiumAllowed("o")).toBe(true);
  });

  it("ENFORCED + active sub → allowed (automation stays on)", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({ organizationId: "o", planCode: "pro", status: "active" } as never);
    expect(await premiumAllowed("o")).toBe(true);
  });

  it("ENFORCED + grandfathered (no sub) → allowed (founder unaffected)", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue(null);
    expect(await premiumAllowed("o")).toBe(true);
  });

  it("ENFORCED + canceled → BLOCKED (free tier: automation off)", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({ organizationId: "o", planCode: "pro", status: "canceled" } as never);
    expect(await premiumAllowed("o")).toBe(false);
  });

  it("ENFORCED + expired trial → BLOCKED", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({
      organizationId: "o",
      planCode: "pro",
      status: "trialing",
      trialEndsAt: new Date(Date.now() - 86_400_000),
    } as never);
    expect(await premiumAllowed("o")).toBe(false);
  });

  it("ENFORCED + trialing with NO trialEndsAt (malformed) → BLOCKED (fail-closed, no infinite trial)", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({
      organizationId: "o",
      planCode: "pro",
      status: "trialing",
      trialEndsAt: null, // missing anchor must not grant an unlimited free trial
    } as never);
    const ent = await getEntitlement("o");
    expect(ent.trialExpired).toBe(true);
    expect(await premiumAllowed("o")).toBe(false);
  });

  it("ENFORCED + PRIMARY_ORG_ID with a canceled sub → still allowed (founder never paywalled)", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    vi.stubEnv("PRIMARY_ORG_ID", "founder-org");
    findUnique.mockResolvedValue({
      organizationId: "founder-org",
      planCode: "pro",
      status: "canceled", // e.g. a test payment that later lapsed
    } as never);
    // A non-founder org with the same canceled sub IS blocked (proves the guard
    // is org-scoped, not a blanket bypass).
    expect(await premiumAllowed("some-customer")).toBe(false);
    expect(await premiumAllowed("founder-org")).toBe(true);
  });

  // ── KURUCU 10-16: ödeme gecikmesinde EK SÜRE YOK ("Geçerli ödenmiş dönem bitince ücretli otomatik işler dursun; yenileme ödemesi
  // doğrulanınca açılsın. Ek 14 gün istemiyorum."). ÖNCE: yenileme başarısız olunca 14 gün daha açık. SONRA: ödenmiş dönem bitince kapalı. ──
  it("🚨 Kurucu 10-16: ENFORCED + past_due, ödenmiş dönem 3 gün önce BİTTİ → KAPALI (eski kural: 14 günlük ek süre içinde açık)", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({
      organizationId: "o",
      planCode: "pro",
      status: "past_due",
      currentPeriodEnd: new Date(Date.now() - 3 * 86_400_000),
      pastDueSince: new Date(Date.now() - 3 * 86_400_000),
      updatedAt: new Date(),
    } as never);
    expect(await premiumAllowed("o")).toBe(false); // ⬅️ ESKİDE true
  });

  it("Kurucu 10-16: past_due ama ödenmiş dönem HÂLÂ sürüyor (dönem sonu ileride) → açık (ödenmiş hizmet kesilmez)", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({
      organizationId: "o",
      planCode: "pro",
      status: "past_due",
      currentPeriodEnd: new Date(Date.now() + 2 * 86_400_000),
      pastDueSince: new Date(),
      updatedAt: new Date(),
    } as never);
    expect(await premiumAllowed("o")).toBe(true);
  });

  it("Kurucu 10-16: past_due + dönem sonu BİLİNMİYOR → kapalı (ödenmemiş erişim verilmez); taze yeniden deneme olayı (updatedAt) açmaz", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({
      organizationId: "o",
      planCode: "pro",
      status: "past_due",
      currentPeriodEnd: null,
      pastDueSince: new Date(Date.now() - 2 * 86_400_000),
      updatedAt: new Date(),
      createdAt: new Date(Date.now() - 60 * 86_400_000),
    } as never);
    expect(await premiumAllowed("o")).toBe(false);
  });

  it("Kurucu 10-16: yenileme ödemesi doğrulanınca (active) ANINDA açık; kurucu işletmesi past_due'da da açık (ağ korunur)", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({ organizationId: "o", planCode: "pro", status: "active", currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } as never);
    expect(await premiumAllowed("o")).toBe(true);
    vi.stubEnv("PRIMARY_ORG_ID", "founder-org");
    findUnique.mockResolvedValue({ organizationId: "founder-org", planCode: "pro", status: "past_due", currentPeriodEnd: new Date(Date.now() - 30 * 86_400_000) } as never);
    expect(await premiumAllowed("founder-org")).toBe(true);
  });

  // KARAKTERİZASYON (Opus F6): `getEntitlement` bu değişiklikte değişmedi — "paused" zaten etkin durumlar dışındaydı. Asıl düzeltme
  // Paddle eşlemesinde (`paddleStatusToLocal`); kırmızı-önce kanıtı `paddle-webhook.test.ts` S4 uçtan uca testindedir.
  it("Kurucu 10-16 (S4, karakterizasyon): ENFORCED + paused → kapalı (ödeme gecikmesi ek süresi duraklatmaya verilmez)", async () => {
    vi.stubEnv("BILLING_ENFORCED", "true");
    findUnique.mockResolvedValue({
      organizationId: "o",
      planCode: "pro",
      status: "paused",
      currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000), // dönem sonu ileride olsa da
      pastDueSince: null,
      updatedAt: new Date(),
      createdAt: new Date(Date.now() - 60 * 86_400_000),
    } as never);
    expect(await premiumAllowed("o")).toBe(false);
    expect((await getEntitlement("o")).status).toBe("paused");
    // Kurucu ağı korunur.
    vi.stubEnv("PRIMARY_ORG_ID", "founder-org");
    findUnique.mockResolvedValue({ organizationId: "founder-org", planCode: "pro", status: "paused" } as never);
    expect(await premiumAllowed("founder-org")).toBe(true);
  });

  it("DORMANT: past_due allowed while BILLING_ENFORCED is off (even long past grace)", async () => {
    vi.stubEnv("BILLING_ENFORCED", "");
    findUnique.mockResolvedValue({
      organizationId: "o",
      planCode: "pro",
      status: "past_due",
      currentPeriodEnd: new Date(Date.now() - 100 * 86_400_000),
    } as never);
    expect(await premiumAllowed("o")).toBe(true);
  });
});
