import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// DENEME KİMLİĞİ (kurucu onayı 10-10; `lib/billing/trial-identity.ts`, migration 61). Aynı ilan / takvimle ikinci ücretsiz deneme:
// sonraki hesabın denemesi o an biter (ödeme yapan / istisnalı / kurucu hesabı etkilenmez); iz hesap silinince KALIR, silinmeden 24 ay sonra
// süpürülür; operatör "denemeyi geri ver" ile istisna tanır. Anahtar KAPALIYKEN hiçbir şey yazılmaz. Kimlik SAĞLAYICIDAN BAĞIMSIZ.
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { POST as addSource } from "@/app/api/properties/[id]/calendar-sources/route";
import { POST as exemptPost } from "@/app/api/admin/trial-identity-exempt/route";
import {
  TRIAL_IDENTITY_BACKFILL_MARKER,
  TRIAL_IDENTITY_REUSED_MESSAGE,
  backfillTrialIdentitiesOnce,
  hashTrialIdentity,
  icalIdentityKey,
  listingIdentityKey,
  recordTrialIdentities,
  sweepTrialIdentities,
} from "@/lib/billing/trial-identity";
import { recordChannelListings } from "@/lib/channels/metadata";
import { deleteAccountData } from "@/lib/data-retention";
import { newTrialSubscriptionData } from "@/lib/billing/subscription";

const AIRBNB = (token: string) => `https://www.airbnb.com.tr/calendar/ical/123456789.ics?s=${token}`;
const OPERATOR_EMAIL = "operator@lixusai.com";

async function trialOrg(name: string, sub: "trial" | "paddle" = "trial") {
  const org = await prisma.organization.create({ data: { name } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: `${name} daire` } });
  await prisma.subscription.create({
    data:
      sub === "trial"
        ? { organizationId: org.id, ...newTrialSubscriptionData() }
        : // Denemenin ORTASINDA ödemeye geçmiş hesap: deneme bitiş tarihi hâlâ ileride (gerçek durum) — kural yine dokunmamalı.
          { organizationId: org.id, planCode: "pro", status: "active", provider: "paddle", providerRef: `sub_${name}`, trialEndsAt: new Date(Date.now() + 5 * 86_400_000) },
  });
  return { orgId: org.id, propertyId: property.id };
}
const addIcal = (o: { orgId: string; propertyId: string }, url: string) => {
  session = { userId: "u", organizationId: o.orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  return addSource(
    new NextRequest(`http://localhost/api/properties/${o.propertyId}/calendar-sources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Airbnb", url }),
    }),
    { params: Promise.resolve({ id: o.propertyId }) },
  );
};
const sub = (orgId: string) => prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });

describe("kimlik anahtarları (saf)", () => {
  it("Airbnb takvimi ilan numarasıyla tanınır — jeton / alan adı uzantısı / www değişse de AYNI kimlik", () => {
    const a = icalIdentityKey(AIRBNB("aaa"));
    expect(a).toEqual({ type: "ical_listing", value: "airbnb:123456789" });
    expect(icalIdentityKey("https://airbnb.com/calendar/ical/123456789.ics?s=bbb")).toEqual(a);
    expect(icalIdentityKey("https://www.airbnb.de/calendar/ical/123456789.ics")).toEqual(a);
  });

  it("diğer takvimler normalize adresle (www / sondaki eğik çizgi / sorgu sırası farkı aynı); farklı jeton farklı kimlik; geçersiz → null", () => {
    const b = icalIdentityKey("https://admin.booking.com/hotel/ical.html?t=abc&x=1");
    expect(b).toEqual({ type: "ical_url", value: "admin.booking.com/hotel/ical.html?t=abc&x=1" });
    expect(icalIdentityKey("https://www.admin.booking.com/hotel/ical.html/?x=1&t=abc")).toEqual(b);
    expect(icalIdentityKey("https://admin.booking.com/hotel/ical.html?t=xyz&x=1")).not.toEqual(b);
    expect(icalIdentityKey("ftp://x.com/a.ics")).toBeNull();
    expect(icalIdentityKey("bozuk")).toBeNull();
  });

  it("ilan kimliği kanal adı + ilan numarası (sağlayıcıdan bağımsız); boş → null", () => {
    expect(listingIdentityKey(" Hospitable ", " p-1 ")).toEqual({ type: "listing", value: "hospitable:p-1" });
    expect(listingIdentityKey("airbnb_direct", "987")).toEqual({ type: "listing", value: "airbnb_direct:987" });
    expect(listingIdentityKey("", "x")).toBeNull();
  });

  it("🚨 iz GERİ DÖNDÜRÜLEMEZ özet: kimlik metnini taşımaz; tür ayrı özet verir; aynı girdi aynı özet", () => {
    const h = hashTrialIdentity({ type: "ical_listing", value: "airbnb:123456789" });
    expect(h).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(h).not.toContain("123456789");
    expect(hashTrialIdentity({ type: "listing", value: "airbnb:123456789" })).not.toBe(h);
    expect(hashTrialIdentity({ type: "ical_listing", value: "airbnb:123456789" })).toBe(h);
  });
});

describe("kural (gerçek PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "1");
    vi.stubEnv("PRIMARY_ORG_ID", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("KONTROL: anahtar KAPALIYKEN hiçbir iz yazılmaz, deneme bitmez (bugünkü davranış)", async () => {
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "");
    const a = await trialOrg("A");
    const b = await trialOrg("B");
    expect((await addIcal(a, AIRBNB("1"))).status).toBe(201);
    const res = await addIcal(b, AIRBNB("2"));
    expect(res.status).toBe(201);
    expect((await res.json()).trialNotice).toBeUndefined();
    expect(await prisma.trialIdentity.count()).toBe(0);
    expect((await sub(b.orgId)).trialEndReason).toBeNull();
  });

  it("🚨 ikinci hesap AYNI Airbnb ilanının takvimini (farklı jetonla) bağlar → takvim YİNE eklenir, deneme o an biter, sade not + denetim kaydı; ilk hesap etkilenmez", async () => {
    const a = await trialOrg("A");
    const b = await trialOrg("B");
    await addIcal(a, AIRBNB("1"));
    const res = await addIcal(b, AIRBNB("2"));
    expect(res.status).toBe(201);
    expect((await res.json()).trialNotice).toBe(TRIAL_IDENTITY_REUSED_MESSAGE);
    expect(await prisma.calendarSource.count({ where: { propertyId: b.propertyId } })).toBe(1);
    const sb = await sub(b.orgId);
    expect(sb.trialEndReason).toBe("identity_reused");
    expect(sb.trialEndsAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await prisma.auditLog.count({ where: { organizationId: b.orgId, action: "trial.ended_identity_reused" } })).toBe(1);
    const sa = await sub(a.orgId);
    expect(sa.trialEndReason).toBeNull();
    expect(sa.trialEndsAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("KONTROL: aynı hesap kendi takvimini yeniden ekler → deneme sürer; farklı ilan → deneme sürer", async () => {
    const a = await trialOrg("A");
    await addIcal(a, AIRBNB("1"));
    await addIcal(a, AIRBNB("9"));
    const b = await trialOrg("B");
    await addIcal(b, "https://www.airbnb.com/calendar/ical/555.ics?s=z");
    expect((await sub(a.orgId)).trialEndReason).toBeNull();
    expect((await sub(b.orgId)).trialEndReason).toBeNull();
  });

  it("KONTROL: ödeme yapan hesap, istisnalı hesap ve kurucu hesabı etkilenmez", async () => {
    const a = await trialOrg("A");
    await addIcal(a, AIRBNB("1"));
    const paying = await trialOrg("P", "paddle");
    await addIcal(paying, AIRBNB("2"));
    expect((await sub(paying.orgId)).status).toBe("active");
    expect((await sub(paying.orgId)).trialEndReason).toBeNull();
    expect((await sub(paying.orgId)).trialEndsAt!.getTime()).toBeGreaterThan(Date.now());
    const exempt = await trialOrg("E");
    await prisma.organization.update({ where: { id: exempt.orgId }, data: { trialIdentityExempt: true } });
    await addIcal(exempt, AIRBNB("3"));
    expect((await sub(exempt.orgId)).trialEndReason).toBeNull();
    const founder = await trialOrg("F");
    vi.stubEnv("PRIMARY_ORG_ID", founder.orgId);
    await addIcal(founder, AIRBNB("4"));
    expect((await sub(founder.orgId)).trialEndReason).toBeNull();
  });

  it("🚨 hesabı SİLİP yeniden açma: iz kalır (sahibi boşa çekilir, 24 ay silinme anından sayılır) → yeni hesabın denemesi biter", async () => {
    const a = await trialOrg("A");
    await addIcal(a, AIRBNB("1"));
    await prisma.trialIdentity.updateMany({ data: { lastSeenAt: new Date("2020-01-01T00:00:00Z") } });
    const before = Date.now();
    expect(await deleteAccountData(a.orgId)).toEqual({ deleted: true });
    const [row] = await prisma.trialIdentity.findMany();
    expect(row.firstOrganizationId).toBeNull();
    expect(row.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    const b = await trialOrg("B");
    await addIcal(b, AIRBNB("2"));
    expect((await sub(b.orgId)).trialEndReason).toBe("identity_reused");
  });

  it("🚨 saklama: yalnız sahibi silinmiş + 24 ayı geçmiş iz silinir; yaşayan hesabın eski izi silinmez", async () => {
    const now = new Date("2030-01-15T00:00:00Z");
    const live = await trialOrg("L");
    await prisma.trialIdentity.createMany({
      data: [
        { keyHash: "v1:old-orphan", keyType: "ical_url", firstOrganizationId: null, lastSeenAt: new Date("2027-12-01T00:00:00Z") },
        { keyHash: "v1:young-orphan", keyType: "ical_url", firstOrganizationId: null, lastSeenAt: new Date("2028-03-01T00:00:00Z") },
        { keyHash: "v1:old-live", keyType: "ical_url", firstOrganizationId: live.orgId, lastSeenAt: new Date("2025-01-01T00:00:00Z") },
      ],
    });
    expect(await sweepTrialIdentities(now)).toBe(1);
    expect((await prisma.trialIdentity.findMany({ select: { keyHash: true } })).map((r) => r.keyHash).sort()).toEqual(["v1:old-live", "v1:young-orphan"]);
  });

  it("🚨 ilk açılış geri doldurması: mevcut hesapların kimlikleri YALNIZ kaydedilir (kimsenin denemesi bitmez), en eski hesap 'ilk'; bir kez koşar", async () => {
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "");
    const a = await trialOrg("A");
    await addIcal(a, AIRBNB("1"));
    const b = await trialOrg("B");
    await addIcal(b, AIRBNB("2"));
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "1");
    expect(await backfillTrialIdentitiesOnce()).toBe("done");
    expect((await sub(a.orgId)).trialEndReason).toBeNull();
    expect((await sub(b.orgId)).trialEndReason).toBeNull();
    expect((await prisma.trialIdentity.findFirstOrThrow()).firstOrganizationId).toBe(a.orgId);
    expect(await prisma.systemLock.count({ where: { name: TRIAL_IDENTITY_BACKFILL_MARKER } })).toBe(1);
    expect(await backfillTrialIdentitiesOnce()).toBe("skipped");
    // Geri doldurmadan SONRA yeni hesap aynı ilanı bağlarsa kural işler.
    const c = await trialOrg("C");
    await addIcal(c, AIRBNB("3"));
    expect((await sub(c.orgId)).trialEndReason).toBe("identity_reused");
  });

  it("ilan yazıcısı (kanal bağlantısı, sağlayıcıdan bağımsız): aynı kanal + ilan numarası ikinci hesapta → deneme biter", async () => {
    vi.stubEnv("CHANNEL_METADATA_WRITE", "1");
    const link = async (o: { orgId: string; propertyId: string }) => {
      const conn = await prisma.channelConnection.create({ data: { organizationId: o.orgId, provider: "airbnb_direct", status: "active" } });
      await recordChannelListings(o.orgId, conn.id, [{ externalId: "L-42", propertyId: o.propertyId }]);
    };
    const a = await trialOrg("A");
    await link(a);
    const b = await trialOrg("B");
    await link(b);
    expect((await sub(a.orgId)).trialEndReason).toBeNull();
    expect((await sub(b.orgId)).trialEndReason).toBe("identity_reused");
  });

  it("enforce: false yalnız kaydeder", async () => {
    const a = await trialOrg("A");
    const b = await trialOrg("B");
    const key = listingIdentityKey("x", "1");
    await recordTrialIdentities(a.orgId, [key]);
    expect(await recordTrialIdentities(b.orgId, [key], { enforce: false })).toEqual({ reused: true, trialEnded: false });
    expect((await sub(b.orgId)).trialEndReason).toBeNull();
  });
});

describe("operatör: denemeyi geri ver", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "1");
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR_EMAIL);
  });
  afterEach(() => vi.unstubAllEnvs());

  const exempt = (organizationId: string) =>
    exemptPost(
      new NextRequest("http://localhost/api/admin/trial-identity-exempt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId }),
      }),
    );
  async function operator() {
    const org = await prisma.organization.create({ data: { name: "Operatör org" } });
    const user = await prisma.user.create({ data: { organizationId: org.id, name: "Op", email: OPERATOR_EMAIL, passwordHash: "x", role: "owner" } });
    session = { userId: user.id, organizationId: org.id, role: "owner", email: OPERATOR_EMAIL, name: "Op", sessionEpoch: 0, mfa: true };
    return user.id;
  }

  it("🚨 kimlik sebebiyle biten deneme yeniden başlar + kuruluş muaf + denetim kaydı (operatör kimliğiyle); sonra aynı ilan yine bitirmez", async () => {
    const a = await trialOrg("A");
    await addIcal(a, AIRBNB("1"));
    const b = await trialOrg("B");
    await addIcal(b, AIRBNB("2"));
    expect((await sub(b.orgId)).trialEndReason).toBe("identity_reused");
    const opId = await operator();
    const res = await exempt(b.orgId);
    expect(res.status).toBe(200);
    expect((await res.json()).trialRestored).toBe(true);
    const sb = await sub(b.orgId);
    expect(sb.trialEndReason).toBeNull();
    expect(sb.trialEndsAt!.getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: b.orgId } })).trialIdentityExempt).toBe(true);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: b.orgId, action: "trial.identity_exempt" } });
    expect(log.actorUserId).toBe(opId);
    await addIcal(b, AIRBNB("3"));
    expect((await sub(b.orgId)).trialEndReason).toBeNull();
  });

  it("KONTROL: kendi süresi dolmuş deneme UZATILMAZ (yalnız muafiyet yazılır)", async () => {
    const b = await trialOrg("B");
    const past = new Date(Date.now() - 86_400_000);
    await prisma.subscription.update({ where: { organizationId: b.orgId }, data: { trialEndsAt: past } });
    await operator();
    expect((await (await exempt(b.orgId)).json()).trialRestored).toBe(false);
    expect((await sub(b.orgId)).trialEndsAt!.getTime()).toBe(past.getTime());
  });

  it("🚨 yalnız 2FA'lı operatör: müşteri / 2FA'sız operatör 401; bilinmeyen işletme 404", async () => {
    const b = await trialOrg("B");
    session = { userId: "u", organizationId: b.orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0, mfa: true };
    expect((await exempt(b.orgId)).status).toBe(401);
    await operator();
    session = { ...session!, mfa: false };
    expect((await exempt(b.orgId)).status).toBe(401);
    session = { ...session!, mfa: true };
    expect((await exempt("yok")).status).toBe(404);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: b.orgId } })).trialIdentityExempt).toBe(false);
  });
});
