import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { NextRequest } from "next/server";
import { hashPassword } from "@/lib/auth/password";
import { makeVerifyToken } from "@/lib/auth/email-verify";
import { POST as verifyEmail } from "@/app/api/auth/verify-email/route";
import { EMAIL_VERIFY_REQUIRED_FROM } from "@/lib/auth/email-verify";
import {
  sweepUnverifiedRegistrations,
  UNVERIFIED_MAX_AGE_DAYS,
} from "@/lib/unverified-sweep";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-06T12:00:00Z");
const OLD = new Date(NOW.getTime() - (UNVERIFIED_MAX_AGE_DAYS + 1) * DAY);
const FRESH = new Date(NOW.getTime() - 1 * DAY);

/** Kaydın gerçekten yarattığı üçlü: org + owner + trialing abonelik. */
async function seedRegistration(opts: {
  name: string;
  email: string;
  createdAt: Date;
  emailVerifiedAt?: Date | null;
  subscriptionStatus?: string | null;
  provider?: string;
}) {
  const org = await prisma.organization.create({
    data: { name: opts.name, createdAt: opts.createdAt },
  });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: opts.name,
      email: opts.email,
      passwordHash: await hashPassword("secret123"),
      role: "owner",
      createdAt: opts.createdAt,
      emailVerifiedAt: opts.emailVerifiedAt ?? null,
    },
  });
  if (opts.subscriptionStatus !== null) {
    await prisma.subscription.create({
      data: {
        organizationId: org.id,
        provider: opts.provider ?? "trial",
        planCode: "pro",
        status: opts.subscriptionStatus ?? "trialing",
      },
    });
  }
  return { org, user };
}

const orgExists = async (id: string) =>
  (await prisma.organization.findUnique({ where: { id } })) !== null;

describe("terk edilmiş doğrulanmamış kayıtların süpürülmesi", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("UNVERIFIED_SWEEP_ENABLED", "1");
    // ⚠️ Süpürge `PRIMARY_ORG_ID` yoksa FAIL-CLOSED koşmuyor; testlerde dolu
    // ama test org'undan FARKLI bir değer veriyoruz.
    vi.stubEnv("PRIMARY_ORG_ID", "org-baska-bir-sey");
    vi.stubEnv("UNVERIFIED_SWEEP_DRY_RUN", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("bayrak KAPALIYKEN hiçbir şey silmez (default davranış)", async () => {
    vi.stubEnv("UNVERIFIED_SWEEP_ENABLED", "");
    const { org } = await seedRegistration({
      name: "Terk",
      email: "terk@x.com",
      createdAt: OLD,
    });

    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res).toMatchObject({ scanned: 0, deleted: 0 });
    expect(await orgExists(org.id)).toBe(true);
  });

  it("PRIMARY_ORG_ID YOKKEN hiç koşmaz (fail-closed — kurucu koruması kanıtlanamıyor)", async () => {
    // `isFounderOrg` yalnız bu env'e bakıyor ve env'siz HER ZAMAN false döner.
    // Env'siz koşmak, korumanın var olduğunu sanıp körlemesine silmektir.
    vi.stubEnv("PRIMARY_ORG_ID", "");
    const { org } = await seedRegistration({
      name: "Terk",
      email: "terk@x.com",
      createdAt: OLD,
    });

    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res.deleted).toBe(0);
    expect(res.skippedReasons.primary_org_id_unset).toBe(1);
    expect(await orgExists(org.id)).toBe(true);
  });

  it("DRY-RUN sayar ama SİLMEZ", async () => {
    vi.stubEnv("UNVERIFIED_SWEEP_DRY_RUN", "1");
    const { org } = await seedRegistration({
      name: "Terk",
      email: "terk@x.com",
      createdAt: OLD,
    });

    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res.deleted).toBe(1);
    expect(await orgExists(org.id)).toBe(true); // ← silinmedi
  });

  it("PADDLE denemesine dokunmaz — `status:trialing` TEK BAŞINA yeterli değil", async () => {
    // Gerçek bir Paddle denemesi de `trialing` statüsündedir; ayrım SAĞLAYICIDA.
    const { org } = await seedRegistration({
      name: "PaddleTrial",
      email: "paddle@x.com",
      createdAt: OLD,
      subscriptionStatus: "trialing",
      provider: "paddle",
    });

    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res.deleted).toBe(0);
    expect(res.skippedReasons.billing_provider_touched).toBe(1);
    expect(await orgExists(org.id)).toBe(true);
  });

  it("UÇUŞTAKİ doğrulamaya dokunmaz (kullanıcı şu an deniyor)", async () => {
    const { user, org } = await seedRegistration({
      name: "Ucusta",
      email: "ucusta@x.com",
      createdAt: OLD,
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifyExpiresAt: new Date(NOW.getTime() + 60_000) },
    });

    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res.scanned).toBe(0);
    expect(await orgExists(org.id)).toBe(true);
  });

  it("SAHİPLİK KANITI olan hesaba dokunmaz (2FA kurulmuş / parola değişmiş)", async () => {
    const a = await seedRegistration({ name: "Iki", email: "2fa@x.com", createdAt: OLD });
    await prisma.user.update({
      where: { id: a.user.id },
      data: { twoFactorEnabledAt: OLD },
    });
    const b = await seedRegistration({ name: "Epoch", email: "epoch@x.com", createdAt: OLD });
    await prisma.user.update({ where: { id: b.user.id }, data: { sessionEpoch: 1 } });

    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res.scanned).toBe(0);
    expect(await orgExists(a.org.id)).toBe(true);
    expect(await orgExists(b.org.id)).toBe(true);
  });

  it("KVKK silme talebi işlenmiş org'a ASLA dokunmaz", async () => {
    const { org } = await seedRegistration({
      name: "Tombstone",
      email: "tomb@x.com",
      createdAt: OLD,
    });
    await prisma.erasureTombstone.create({
      data: {
        organizationId: org.id,
        keyType: "guest_email",
        keyHash: "v1:" + "a".repeat(64),
        erasedAt: OLD,
      },
    });

    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res.deleted).toBe(0);
    expect(res.skippedReasons.has_erasure_tombstone).toBe(1);
    expect(await orgExists(org.id)).toBe(true);
  });

  it("terk edilmiş kaydı siler → e-posta adresi SERBEST kalır", async () => {
    const { org } = await seedRegistration({
      name: "Terk",
      email: "terk@x.com",
      createdAt: OLD,
    });

    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res.deleted).toBe(1);
    expect(await orgExists(org.id)).toBe(false);
    // Asıl kazanç: kurban artık kendi adresiyle kaydolabilir.
    expect(await prisma.user.findUnique({ where: { email: "terk@x.com" } })).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 🚨 EN KRİTİK TEST. `needsEmailVerification` cutoff ÖNCESİ hesapları TARİH
  // kontrolüyle muaf tutuyor — `emailVerifiedAt` dolu olduğu için DEĞİL. Yani
  // kurucunun ve cutoff öncesi her müşterinin `emailVerifiedAt`'i NULL olabilir.
  // `createdAt >= EMAIL_VERIFY_REQUIRED_FROM` koşulu düşerse bu süpürge tam da
  // korumanın muaf tuttuğu satırları seçer ve ilk koşuşunda kurucuyu siler.
  // -------------------------------------------------------------------------
  it("CUTOFF ÖNCESİ doğrulanmamış hesaba ASLA dokunmaz (kurucu/personel muafiyeti)", async () => {
    const { org } = await seedRegistration({
      name: "Kurucu",
      email: "kurucu@x.com",
      // Cutoff'tan önce yaratılmış ve doğrulanmamış — tamamen meşru.
      createdAt: new Date(EMAIL_VERIFY_REQUIRED_FROM.getTime() - 30 * DAY),
      emailVerifiedAt: null,
    });

    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res.scanned).toBe(0);
    expect(res.deleted).toBe(0);
    expect(await orgExists(org.id)).toBe(true);
  });

  it("YAŞI DOLMAMIŞ kayda dokunmaz (meşru kullanıcı e-postasını henüz açmadı)", async () => {
    const { org } = await seedRegistration({
      name: "Taze",
      email: "taze@x.com",
      createdAt: FRESH,
    });

    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res.scanned).toBe(0);
    expect(await orgExists(org.id)).toBe(true);
  });

  it("DOĞRULANMIŞ hesaba dokunmaz, ne kadar eski olursa olsun", async () => {
    const { org } = await seedRegistration({
      name: "Dogrulanmis",
      email: "ok@x.com",
      createdAt: OLD,
      emailVerifiedAt: OLD,
    });

    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res.scanned).toBe(0);
    expect(await orgExists(org.id)).toBe(true);
  });

  it("KURUCU org'u (PRIMARY_ORG_ID) her koşulda atlar", async () => {
    const { org } = await seedRegistration({
      name: "Primary",
      email: "primary@x.com",
      createdAt: OLD,
    });
    vi.stubEnv("PRIMARY_ORG_ID", org.id);

    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res.deleted).toBe(0);
    expect(res.skippedReasons.founder_org).toBe(1);
    expect(await orgExists(org.id)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // "El değmiş" sinyalleri. Bu org'un sahibi TANIM GEREĞİ hiç giriş yapamadı
  // (login doğrulama kapısında 403) — aşağıdakilerden biri varsa varsayımımız
  // yanlış demektir ve silmek GERÇEK veri kaybı olur.
  // -------------------------------------------------------------------------
  it("FATURA geçmişi varsa atlar", async () => {
    const { org } = await seedRegistration({
      name: "Odemis",
      email: "odemis@x.com",
      createdAt: OLD,
    });
    await prisma.invoice.create({
      data: {
        organizationId: org.id,
        provider: "paddle",
        providerRef: "inv-1",
        amountMinor: 44900,
        currency: "TRY",
        status: "paid",
      },
    });

    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res.deleted).toBe(0);
    expect(res.skippedReasons.has_billing_history).toBe(1);
    expect(await orgExists(org.id)).toBe(true);
  });

  it("GERÇEK VERİ (mülk) varsa atlar", async () => {
    const { org } = await seedRegistration({
      name: "Veri",
      email: "veri@x.com",
      createdAt: OLD,
    });
    await prisma.property.create({ data: { organizationId: org.id, name: "Daire 1" } });

    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res.deleted).toBe(0);
    expect(res.skippedReasons.has_data).toBe(1);
    expect(await orgExists(org.id)).toBe(true);
  });

  it("HOSPITABLE bağlıysa atlar", async () => {
    const { org } = await seedRegistration({
      name: "Bagli",
      email: "bagli@x.com",
      createdAt: OLD,
    });
    await prisma.organization.update({
      where: { id: org.id },
      data: { hospitableConnectedAt: OLD },
    });

    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res.deleted).toBe(0);
    expect(res.skippedReasons.hospitable_connected).toBe(1);
    expect(await orgExists(org.id)).toBe(true);
  });

  it("İKİNCİ kullanıcı varsa atlar (personel davet edilmiş)", async () => {
    const { org } = await seedRegistration({
      name: "Ekip",
      email: "ekip@x.com",
      createdAt: OLD,
    });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Personel",
        email: "personel@x.com",
        passwordHash: await hashPassword("secret123"),
        role: "staff",
        createdAt: OLD,
        emailVerifiedAt: OLD,
      },
    });

    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res.deleted).toBe(0);
    expect(res.skippedReasons.multi_user).toBe(1);
    expect(await orgExists(org.id)).toBe(true);
  });

  it("DENETİM İZİ varsa atlar (biri bu org'da bir şey yapmış)", async () => {
    const { org } = await seedRegistration({
      name: "Denetim",
      email: "denetim@x.com",
      createdAt: OLD,
    });
    await prisma.auditLog.create({
      data: { organizationId: org.id, action: "auth.login" },
    });

    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res.deleted).toBe(0);
    expect(res.skippedReasons.has_audit_trail).toBe(1);
    expect(await orgExists(org.id)).toBe(true);
  });

  it("abonelik trialing DEĞİLSE atlar (yaşam döngüsünden geçmiş)", async () => {
    const { org } = await seedRegistration({
      name: "Aktif",
      email: "aktif@x.com",
      createdAt: OLD,
      subscriptionStatus: "active",
    });

    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res.deleted).toBe(0);
    expect(res.skippedReasons.subscription_not_trialing).toBe(1);
    expect(await orgExists(org.id)).toBe(true);
  });

  it("SINIR: 7 gün + 1 dk silinir, 6 gün 23 saat DURUR", async () => {
    // ⚠️ 7 ELLE YAZILDI, `UNVERIFIED_MAX_AGE_DAYS`'ten TÜRETİLMEDİ. İlk yazımda
    // sabitten türetmiştim ve test VACUOUS çıktı: sabiti 6'ya çevirince testin
    // kendi beklentisi de kaydığı için mutasyon yeşil kaldı. Eşik bir ürün
    // kararıdır; testin onu BAĞIMSIZ olarak iddia etmesi gerekir.
    expect(UNVERIFIED_MAX_AGE_DAYS).toBe(7);
    const hemenEski = await seedRegistration({
      name: "Eski",
      email: "eski@x.com",
      createdAt: new Date(NOW.getTime() - (7 * DAY + 60_000)),
    });
    const kilPayiTaze = await seedRegistration({
      name: "Taze",
      email: "kilpayi@x.com",
      createdAt: new Date(NOW.getTime() - (7 * DAY - 60 * 60_000)),
    });

    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res.deleted).toBe(1);
    expect(await orgExists(hemenEski.org.id)).toBe(false);
    expect(await orgExists(kilPayiTaze.org.id)).toBe(true);
  });

  it("org silinirken tıklanan doğrulama bağlantısı ÇÖKMEZ, 'expired' döner", async () => {
    // Yarış penceresi: aday sorgusu canlı token'lı kullanıcıyı zaten DIŞLIYOR
    // (`emailVerifyExpiresAt` gelecekte), ama satır yine de silinmiş olabilir.
    // O durumda tüketim `updateMany` 0 satır etkiler → kullanıcı jenerik
    // "bağlantı geçersiz" görür; istisna fırlamaz, 500 dönmez.
    const { org, user } = await seedRegistration({
      name: "Yaris",
      email: "yaris@x.com",
      createdAt: OLD,
    });
    const { raw, hash } = makeVerifyToken();
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifyTokenHash: hash, emailVerifyExpiresAt: new Date(NOW.getTime() - 1000) },
    });

    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res.deleted).toBe(1);
    expect(await orgExists(org.id)).toBe(false);

    const verify = await verifyEmail(
      new NextRequest("http://www.lixusai.com/api/auth/verify-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: raw, password: "secret123" }),
      }),
    );
    expect(verify.status).toBe(400);
    expect((await verify.json()).reason).toBe("expired");
  });

  it("İDEMPOTANT — ikinci koşu hiçbir şey yapmaz", async () => {
    await seedRegistration({ name: "Terk", email: "terk@x.com", createdAt: OLD });

    const first = await sweepUnverifiedRegistrations(NOW);
    expect(first.deleted).toBe(1);

    const second = await sweepUnverifiedRegistrations(NOW);
    expect(second).toMatchObject({ scanned: 0, deleted: 0, skipped: 0, failed: 0 });
  });

  it("karışık kümede YALNIZ terk edilmişi siler, diğerlerini bırakır", async () => {
    const terk = await seedRegistration({ name: "A", email: "a@x.com", createdAt: OLD });
    const taze = await seedRegistration({ name: "B", email: "b@x.com", createdAt: FRESH });
    const dogrulanmis = await seedRegistration({
      name: "C",
      email: "c@x.com",
      createdAt: OLD,
      emailVerifiedAt: OLD,
    });

    const res = await sweepUnverifiedRegistrations(NOW);
    expect(res.deleted).toBe(1);
    expect(await orgExists(terk.org.id)).toBe(false);
    expect(await orgExists(taze.org.id)).toBe(true);
    expect(await orgExists(dogrulanmis.org.id)).toBe(true);
  });
});
