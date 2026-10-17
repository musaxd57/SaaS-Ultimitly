import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Kartla deneme kapısı — SIZMA ve HATA testleri (kurucu 10-17: "testlerini bol bol yap, hata olmasın, sızma olmasın"; KD1–KD4 kabul).
// Gerçek PostgreSQL. Sınanan: (1) kişisel veri / sebep müşteriye ve denetim kaydına SIZMAZ; (2) bir işletmenin damgası, muafiyeti ya da
// sinyali BAŞKA işletmeye geçmez; (3) ağ / IP izi kapıya GİRMEZ (aydınlatma cümlesi "otomatik karar verilmez"); (4) eşzamanlı saatlik iş
// tek damga yazar; (5) deneme süresi silinmez, kapı biten / ödenmiş hesapta çalışmaz; (6) yetkisiz kişi kapıyı kaldıramaz.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { __cardGateHooks, evaluateTrialCardGates, TRIAL_CARD_REQUIRED_MESSAGE } from "@/lib/billing/trial-card-gate";
import { getEntitlement, premiumAllowed } from "@/lib/billing/subscription";
import { POST as trialEndPost } from "@/app/api/admin/trial-end/route";
import { POST as consentPost } from "@/app/api/billing/consent/route";

const DAY = 86_400_000;
const ctx = { params: Promise.resolve({} as Record<string, never>) } as never;
const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function trialOrg(email: string, opts: { identityReused?: boolean; verified?: boolean; trialEndsInDays?: number } = {}) {
  const org = await prisma.organization.create({ data: { name: `Org ${email}`, ...(opts.identityReused ? { trialIdentityReusedAt: new Date() } : {}) } });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      email,
      name: "Sahip",
      passwordHash: "x",
      role: "owner",
      createdAt: new Date(Date.now() - 3 * DAY),
      emailVerifiedAt: opts.verified === false ? null : new Date(),
    },
  });
  const trialEndsAt = new Date(Date.now() + (opts.trialEndsInDays ?? 7) * DAY);
  await prisma.subscription.create({ data: { organizationId: org.id, planCode: "pro", provider: "trial", status: "trialing", trialEndsAt } });
  return { orgId: org.id, userId: user.id, trialEndsAt };
}

const stampOf = async (orgId: string) => (await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).trialCardRequiredAt;

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

describe("sızma: kişisel veri ve sebep", () => {
  it("🚨 denetim kaydı YALNIZ kapalı küme sebep kodları taşır — e-posta, alan adı, ad, IP YOK", async () => {
    // Ortak posta kutusu (artı takma adı) + geçici e-posta = 40 + 30 = 70 → yüksek; iki hesap da aynı kutuyu paylaşır.
    const a = await trialOrg("deneme+1@mailinator.com");
    const b = await trialOrg("deneme+2@mailinator.com");
    expect(await evaluateTrialCardGates()).toEqual({ required: 2, cleared: 0 });
    const rows = await prisma.auditLog.findMany({ where: { action: "trial.card_required" }, orderBy: { organizationId: "asc" } });
    expect(rows.map((r) => r.organizationId).sort()).toEqual([a.orgId, b.orgId].sort());
    for (const r of rows) {
      const meta = JSON.parse(r.metadataJson ?? "{}") as Record<string, unknown>;
      expect(Object.keys(meta)).toEqual(["reasons"]);
      expect(meta.reasons).toEqual(["mailbox_shared", "disposable_email"]);
      expect(r.metadataJson).not.toMatch(/@|mailinator|deneme|Sahip|Org /u);
      expect(r.actorUserId).toBeNull();
    }
  });

  it("🚨 müşteriye giden metinler sebep / risk / ilan / ağ / puan SÖYLEMEZ (kaçışı öğretmez)", () => {
    // Türkçe sözcük sınırı \p{L} ile (JS'te \b yalnız ASCII — Opus 10-17 KD-C: /ağ\b/ hiçbir şey yakalamıyordu).
    const word = (w: string) => new RegExp(`(?<![\\p{L}])${w}(?![\\p{L}])`, "iu");
    for (const re of [/risk/iu, /kötüye/iu, word("ilan\\p{L}*"), /(?<![\p{L}])IP(?![\p{L}])/u, word("ağ\\p{L}*"), /puan/iu, /işaret/iu, /geçici/iu, /posta/iu, /şüphe/iu]) {
      expect(TRIAL_CARD_REQUIRED_MESSAGE).not.toMatch(re);
    }
    expect(TRIAL_CARD_REQUIRED_MESSAGE).toBe(
      "Denemenize devam etmek için kartınızı ekleyin. Deneme süresince ücret alınmaz; deneme bitmeden iptal ederseniz ücret ödemezsiniz.",
    );
  });

  it("yetki nesnesi yalnız evet / hayır taşır — damga zamanı, sebep ya da puan dışarı ÇIKMAZ", async () => {
    const a = await trialOrg("ali@example.com", { identityReused: true });
    await evaluateTrialCardGates();
    const e = await getEntitlement(a.orgId);
    expect(e.cardRequired).toBe(true);
    const json = JSON.stringify(e);
    expect(json).not.toMatch(/reason|score|identity|mailbox|trialCardRequiredAt|risk/iu);
  });
});

describe("sızma: kiracılar arası", () => {
  it("🚨 bir işletmenin damgası BAŞKA işletmenin yetkisini etkilemez; posta kutusu PAYLAŞILMAYAN komşu damgalanmaz", async () => {
    const risky = await trialOrg("ayse@example.com", { identityReused: true });
    const neighbour = await trialOrg("mehmet@example.com");
    await evaluateTrialCardGates();
    expect(await stampOf(risky.orgId)).not.toBeNull();
    expect(await stampOf(neighbour.orgId)).toBeNull();
    expect(await getEntitlement(neighbour.orgId)).toMatchObject({ cardRequired: false, active: true });
    expect(await premiumAllowed(neighbour.orgId)).toBe(true);
  });

  it("🚨 operatörün 'Kart şartını kaldır'ı YALNIZ hedef işletmeyi etkiler", async () => {
    const a = await trialOrg("a@mailinator.com", { identityReused: true });
    const b = await trialOrg("b@mailinator.com", { identityReused: true });
    await evaluateTrialCardGates();
    const op = await prisma.user.create({ data: { organizationId: a.orgId, email: "op@lixus.test", name: "Op", passwordHash: "x", role: "owner" } });
    vi.stubEnv("SUPERADMIN_EMAILS", "op@lixus.test");
    session = { userId: op.id, organizationId: a.orgId, role: "owner", email: "op@lixus.test", name: "Op", sessionEpoch: 0, mfa: true } as SessionPayload;
    expect((await trialEndPost(post("/api/admin/trial-end", { organizationId: a.orgId, action: "card_exempt" }))).status).toBe(200);
    expect(await stampOf(a.orgId)).toBeNull();
    expect(await stampOf(b.orgId)).not.toBeNull();
    expect(await getEntitlement(b.orgId)).toMatchObject({ cardRequired: true, active: false });
  });

  it("🚨 işletme SAHİBİ (operatör değil) kart şartını kendisi kaldıramaz → 401, damga kalır", async () => {
    const a = await trialOrg("kendi@example.com", { identityReused: true });
    await evaluateTrialCardGates();
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "kendi@example.com", name: "Sahip", sessionEpoch: 0, mfa: true } as SessionPayload;
    expect((await trialEndPost(post("/api/admin/trial-end", { organizationId: a.orgId, action: "card_exempt" }))).status).toBe(401);
    expect(await stampOf(a.orgId)).not.toBeNull();
  });

  it("🚨 kart istenmeyen hesap deneme süreli fiyatla ödeme ekranı AÇAMAZ (denemeyi Paddle'da uzatma yok); ret metni sebep söylemez; KONTROL: kart istenen hesap açar", async () => {
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
    const clean = await trialOrg("temiz@example.com");
    session = { userId: clean.userId, organizationId: clean.orgId, role: "owner", email: "temiz@example.com", name: "Sahip", sessionEpoch: 0 } as SessionPayload;
    const r = await consentPost(post("/api/billing/consent", { planCode: "pro", priceId: "pri_p_t" }), ctx);
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body).toMatchObject({ fields: { planCode: "Plan fiyatı doğrulanamadı. Lütfen sayfayı yenileyip tekrar deneyin." } });
    expect(JSON.stringify(body)).not.toMatch(/risk|kart iste|deneme süreli|işaret/iu);
    expect(await prisma.checkoutConsent.count({ where: { organizationId: clean.orgId } })).toBe(0);
    // KONTROL: aynı istek kart istenen (damgalı) hesapta kabul — ret gerçekten kapıdan.
    const risky = await trialOrg("riskli@example.com", { identityReused: true });
    await evaluateTrialCardGates();
    session = { userId: risky.userId, organizationId: risky.orgId, role: "owner", email: "riskli@example.com", name: "Sahip", sessionEpoch: 0 } as SessionPayload;
    expect((await consentPost(post("/api/billing/consent", { planCode: "pro", priceId: "pri_p_t" }), ctx)).status).toBe(201);
    // Başka işletmenin damgası temiz hesaba deneme fiyatını AÇMAZ.
    session = { userId: clean.userId, organizationId: clean.orgId, role: "owner", email: "temiz@example.com", name: "Sahip", sessionEpoch: 0 } as SessionPayload;
    expect((await consentPost(post("/api/billing/consent", { planCode: "pro", priceId: "pri_p_t" }), ctx)).status).toBe(400);
  });
});

describe("ağ / IP izi kapıya GİRMEZ (aydınlatma cümlesi: otomatik karar verilmez)", () => {
  it("🚨 aynı adres + aynı ağdan çok kayıt izi olan hesaplar damgalanmaz (yalnız operatör listesinde)", async () => {
    // Opus 10-17 KD-A: her hesapta ağ DIŞI orta sinyal (geçici e-posta, 30) — ağ sinyalleri (aynı adres 20 + yoğun kayıt 15) kapıya girseydi
    // toplam 65 = yüksek olurdu; girmediği için 30 = orta → damga YOK. (Ağ izi olmadan da 30: iddia vakum değil.)
    const orgs = [await trialOrg("x1@mailinator.com"), await trialOrg("x2@mailinator.com"), await trialOrg("x3@mailinator.com")];
    for (const o of orgs) {
      await prisma.signupNetworkTrace.create({
        data: { organizationId: o.orgId, ipHash: "ip-ayni", networkHash: "ag-ayni", networkKind: "v4_24", keyFp: "fp1", expiresAt: new Date(Date.now() + 90 * DAY) },
      });
    }
    expect(await evaluateTrialCardGates()).toEqual({ required: 0, cleared: 0 });
    for (const o of orgs) expect(await stampOf(o.orgId)).toBeNull();
  });
});

describe("hata: yarış, süre, kapsam", () => {
  it("🚨 iki saatlik iş AYNI ANDA (ikisi de OKUDUKTAN sonra yazar — kanca bariyeri) → tek damga, tek denetim kaydı", async () => {
    const a = await trialOrg("yaris@example.com", { identityReused: true });
    // Opus 10-17 KD-B: iki koşu da okuma bitmeden yazmaya geçmesin — ikisi de "damgasız" görür, yarışı koşullu yazım çözer.
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>((r) => (release = r));
    __cardGateHooks.afterRead = async () => {
      arrived++;
      if (arrived === 2) release();
      await barrier;
    };
    let runs: { required: number; cleared: number }[];
    try {
      runs = await Promise.all([evaluateTrialCardGates(), evaluateTrialCardGates()]);
    } finally {
      __cardGateHooks.afterRead = null;
    }
    expect(arrived).toBe(2);
    expect(runs.reduce((n, r) => n + r.required, 0)).toBe(1);
    expect(await prisma.auditLog.count({ where: { organizationId: a.orgId, action: "trial.card_required" } })).toBe(1);
  });

  it("🚨 deneme süresi SİLİNMEZ: damga deneme bitişini değiştirmez; kalan gün görünür; deneme 'bitti' sayılmaz", async () => {
    const a = await trialOrg("sure@example.com", { identityReused: true, trialEndsInDays: 9 });
    await evaluateTrialCardGates();
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: a.orgId } });
    expect(sub.trialEndsAt?.toISOString()).toBe(a.trialEndsAt.toISOString());
    expect(await getEntitlement(a.orgId)).toMatchObject({ cardRequired: true, trialExpired: false, trialDaysLeft: 9, trialing: true });
  });

  it("deneme BİTİNCE damga temizlenir (denetimli); biten deneme sınırlı moda zaten düşer — kart metni DEĞİL 'deneme bitti' yolu", async () => {
    const a = await trialOrg("bitti@example.com", { identityReused: true });
    await evaluateTrialCardGates();
    await prisma.subscription.update({ where: { organizationId: a.orgId }, data: { trialEndsAt: new Date(Date.now() - 60_000) } });
    expect(await evaluateTrialCardGates()).toEqual({ required: 0, cleared: 1 });
    expect(await stampOf(a.orgId)).toBeNull();
    expect(await getEntitlement(a.orgId)).toMatchObject({ cardRequired: false, trialExpired: true, active: false });
    expect(await prisma.auditLog.count({ where: { organizationId: a.orgId, action: "trial.card_requirement_cleared" } })).toBe(1);
  });

  it("ödeyen (Paddle etkin) ve eski (grandfathered) hesap kapıya hiç GİRMEZ — sinyal olsa da", async () => {
    const paid = await trialOrg("odeyen@example.com", { identityReused: true });
    await prisma.subscription.update({ where: { organizationId: paid.orgId }, data: { provider: "paddle", status: "active", providerRef: "sub_paid", trialEndsAt: null } });
    const old = await trialOrg("eski@example.com", { identityReused: true });
    await prisma.subscription.update({ where: { organizationId: old.orgId }, data: { provider: "manual", status: "grandfathered", trialEndsAt: null } });
    expect(await evaluateTrialCardGates()).toEqual({ required: 0, cleared: 0 });
    expect(await getEntitlement(paid.orgId)).toMatchObject({ cardRequired: false, active: true });
    expect(await getEntitlement(old.orgId)).toMatchObject({ cardRequired: false, active: true });
  });

  it("KD4 (a): ilan işareti TEK BAŞINA yeter (60 = yüksek); orta bant (yalnız ortak posta kutusu, 40) kart İSTEMEZ", async () => {
    const listing = await trialOrg("ilan@example.com", { identityReused: true });
    const m1 = await trialOrg("kutu+1@example.com");
    const m2 = await trialOrg("kutu+2@example.com");
    await evaluateTrialCardGates();
    expect(await stampOf(listing.orgId)).not.toBeNull();
    expect(await stampOf(m1.orgId)).toBeNull();
    expect(await stampOf(m2.orgId)).toBeNull();
  });

  it("anahtar açık ama ödeme penceresi anahtarı YOK → kapı hiç çalışmaz (kart eklenemeyen kilit olmaz); eski damga erişimi kapatmaz", async () => {
    const a = await trialOrg("anahtarsiz@example.com", { identityReused: true });
    await evaluateTrialCardGates();
    vi.stubEnv("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN", "");
    expect(await getEntitlement(a.orgId)).toMatchObject({ cardRequired: false, active: true });
    expect(await evaluateTrialCardGates()).toEqual({ required: 0, cleared: 0 });
  });
});
