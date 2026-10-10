import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// DENEME KİMLİĞİ (kurucu onayı 10-10; `lib/billing/trial-identity.ts`, migration 61). Aynı ilan / takvimle ikinci ücretsiz deneme:
// sonraki hesabın denemesi o an biter (ödeme yapan / istisnalı / kurucu hesabı etkilenmez); iz hesap silinince KALIR, silinmeden 24 ay sonra
// süpürülür; operatör "denemeyi geri ver" ile istisna tanır. Anahtar KAPALIYKEN hiçbir şey yazılmaz. Kimlik = rezervasyon kanalının GERÇEK
// ilan numarası / takvim jetonu (iCal ya da doğrudan bağlantı aynı kimliği verir); köprü sağlayıcısının (Hospitable) kendi mülk kimliği DEĞİL.
// Takvim kimliği EKLEMEDE değil, sunucu gerçek takvim döndürdüğünde (jetonun sahibi) kaynak başına bir kez sayılır.
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/net/pinned-fetch", () => ({ fetchFeedText: vi.fn() }));
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { POST as addSource } from "@/app/api/properties/[id]/calendar-sources/route";
import { POST as syncSource } from "@/app/api/calendar-sources/[id]/sync/route";
import { fetchFeedText } from "@/lib/net/pinned-fetch";
import { POST as exemptPost } from "@/app/api/admin/trial-identity-exempt/route";
import {
  TRIAL_IDENTITY_BACKFILL_MARKER,
  TRIAL_IDENTITY_ENABLED_AT_MARKER,
  TRIAL_IDENTITY_KEY_FP_MARKER,
  TRIAL_IDENTITY_REUSED_MESSAGE,
  backfillTrialIdentitiesOnce,
  hashTrialIdentity,
  channelListingIdentityKey,
  icalIdentityKey,
  otaListingKey,
  recordTrialIdentities,
  recordVerifiedCalendarIdentity,
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
const VALID_ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Airbnb Inc//Hosting Calendar//EN\r\nEND:VCALENDAR\r\n";
const asOwner = (orgId: string) => {
  session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
};
/** Takvimi ekler (kimlik SAYILMAZ) ve elle senkronlar: sunucu `feed` döndürür → gerçek okumada kimlik sayılır. Senkron yanıtının gövdesi döner. */
async function addIcal(o: { orgId: string; propertyId: string }, url: string, feed: string = VALID_ICS) {
  asOwner(o.orgId);
  const added = await addSource(
    new NextRequest(`http://localhost/api/properties/${o.propertyId}/calendar-sources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Airbnb", url }),
    }),
    { params: Promise.resolve({ id: o.propertyId }) },
  );
  expect(added.status).toBe(201);
  const { id } = (await added.json()) as { id: string; trialNotice?: unknown };
  return { id, ...(await syncIcal(o.orgId, id, feed)) };
}
async function syncIcal(orgId: string, id: string, feed: string = VALID_ICS) {
  asOwner(orgId);
  vi.mocked(fetchFeedText).mockResolvedValueOnce(feed);
  const res = await syncSource(new NextRequest(`http://localhost/api/calendar-sources/${id}/sync`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { trialNotice?: string; errors: string[] };
}
const sub = (orgId: string) => prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });
/** Anahtar HİÇ açılmamış duruma dön (açılış anı + geri doldurma işaretleri silinir). */
async function flagNeverOn() {
  vi.stubEnv("TRIAL_IDENTITY_ENABLED", "");
  await prisma.systemLock.deleteMany({ where: { name: { in: [TRIAL_IDENTITY_BACKFILL_MARKER, TRIAL_IDENTITY_ENABLED_AT_MARKER] } } });
}

describe("kimlik anahtarları (saf)", () => {
  it("Airbnb takvimi ilan numarasıyla tanınır — jeton / alan adı uzantısı / www / .ics / sondaki eğik çizgi / baştaki sıfır değişse de AYNI kimlik", () => {
    const a = icalIdentityKey(AIRBNB("aaa"));
    expect(a).toEqual({ type: "ota_listing", value: "airbnb:123456789" });
    expect(icalIdentityKey("https://airbnb.com/calendar/ical/123456789.ics?s=bbb")).toEqual(a);
    expect(icalIdentityKey("https://www.airbnb.de/calendar/ical/123456789.ics")).toEqual(a);
    expect(icalIdentityKey("https://www.airbnb.com/calendar/ical/0123456789/")).toEqual(a);
    expect(icalIdentityKey("https://www.airbnb.co.uk/calendar/ical/123456789.ics?s=1")).toEqual(a);
    expect(icalIdentityKey("https://tr.airbnb.com/calendar/ical/123456789.ics?s=1")).toEqual(a);
    expect(icalIdentityKey("https://www.airbnb.com/calendar/ical/123456780.ics")).not.toEqual(a);
    expect(icalIdentityKey("https://www.airbnb.com/rooms/123456789")).toBeNull();
  });

  it("Booking yalnız takvim jetonuyla (ek / sıralı sorgu parametresi kimliği DEĞİŞTİRMEZ); VRBO jetonla; farklı jeton farklı kimlik", () => {
    const b = icalIdentityKey("https://admin.booking.com/hotel/hoteladmin/ical.html?t=abc12345-XY");
    expect(b).toEqual({ type: "ota_calendar", value: "booking:abc12345-XY" });
    expect(icalIdentityKey("https://admin.booking.com/hotel/hoteladmin/ical.html?x=1&t=abc12345-XY&utm=z")).toEqual(b);
    expect(icalIdentityKey("https://admin.booking.com/hotel/hoteladmin/ical.html?t=zzz99999-XY")).not.toEqual(b);
    expect(icalIdentityKey("https://admin.booking.com/hotel/hoteladmin/ical.html")).toBeNull();
    expect(icalIdentityKey("http://www.vrbo.com/icalendar/0a1b2c3d4e5f6789.ics")).toEqual({ type: "ota_calendar", value: "vrbo:0a1b2c3d4e5f6789" });
    expect(icalIdentityKey("https://www.homeaway.co.uk/icalendar/0a1b2c3d4e5f6789.ics")).toEqual({ type: "ota_calendar", value: "vrbo:0a1b2c3d4e5f6789" });
  });

  it("🚨 tanınmayan takvim KİMLİK DEĞİLDİR (herkese açık ortak takvim iki ev sahibinde ortak olabilir); geçersiz → null", () => {
    expect(icalIdentityKey("https://calendar.google.com/calendar/ical/tr.turkish%23holiday%40group.v.calendar.google.com/public/basic.ics")).toBeNull();
    expect(icalIdentityKey("https://example.com/calendar/ical/123456789.ics")).toBeNull();
    expect(icalIdentityKey("https://airbnb.com.evil.example/calendar/ical/123456789.ics")).toBeNull();
    // Kapalı uzantı listesi (Haiku): bilinmeyen iki harfli uzantı / alt alan zinciri kimlik değildir.
    expect(icalIdentityKey("https://airbnb.io/calendar/ical/123456789.ics")).toBeNull();
    expect(icalIdentityKey("https://evil.www.airbnb.com/calendar/ical/123456789.ics")).toBeNull();
    expect(icalIdentityKey("https://vrbo.io/icalendar/0a1b2c3d4e5f6789.ics")).toBeNull();
    expect(icalIdentityKey("ftp://airbnb.com/calendar/ical/1.ics")).toBeNull();
    expect(icalIdentityKey("bozuk")).toBeNull();
  });

  it("🚨 kanal bağlantısı: doğrudan kanal → rezervasyon kanalının ilan kimliği (iCal ile AYNI); köprü (Hospitable) / tanınmayan / boş → null", () => {
    expect(channelListingIdentityKey("airbnb_direct", "123456789")).toEqual(icalIdentityKey(AIRBNB("q")));
    expect(channelListingIdentityKey(" Airbnb ", " 0123456789 ")).toEqual({ type: "ota_listing", value: "airbnb:123456789" });
    expect(channelListingIdentityKey("booking_direct", "77")).toEqual({ type: "ota_listing", value: "booking:77" });
    expect(channelListingIdentityKey("hospitable", "123456789")).toBeNull();
    expect(channelListingIdentityKey("bilinmeyen", "1")).toBeNull();
    expect(channelListingIdentityKey("airbnb_direct", " ")).toBeNull();
  });

  it("🚨 iz GERİ DÖNDÜRÜLEMEZ özet: kimlik metnini taşımaz; tür ayrı özet verir; aynı girdi aynı özet", () => {
    const h = hashTrialIdentity({ type: "ota_listing", value: "airbnb:123456789" });
    expect(h).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(h).not.toContain("123456789");
    expect(hashTrialIdentity({ type: "ota_calendar", value: "airbnb:123456789" })).not.toBe(h);
    expect(hashTrialIdentity({ type: "ota_listing", value: "airbnb:123456789" })).toBe(h);
  });
});

describe("kural (gerçek PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "1");
    vi.stubEnv("PRIMARY_ORG_ID", "");
    // Anahtar çoktan açık + zamanlanmış geçiş koşmuş (açılış anı + geri doldurma işareti). Açıp kapatan testler `flagNeverOn` ile sıfırlar.
    await backfillTrialIdentitiesOnce();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("KONTROL: anahtar KAPALIYKEN hiçbir iz yazılmaz, deneme bitmez (bugünkü davranış)", async () => {
    await flagNeverOn();
    const a = await trialOrg("A");
    const b = await trialOrg("B");
    await addIcal(a, AIRBNB("1"));
    expect((await addIcal(b, AIRBNB("2"))).trialNotice).toBeUndefined();
    expect(await prisma.trialIdentity.count()).toBe(0);
    expect(await prisma.calendarSource.count({ where: { trialIdentityCheckedAt: { not: null } } })).toBe(0);
    expect(await prisma.systemLock.count({ where: { name: TRIAL_IDENTITY_ENABLED_AT_MARKER } })).toBe(0);
    expect((await sub(b.orgId)).trialEndReason).toBeNull();
  });

  it("🚨 ikinci hesap AYNI Airbnb ilanının takvimini (farklı jetonla) bağlar ve takvim okunur → takvim YİNE eklenir, deneme o an biter, sade not + denetim kaydı; ilk hesap etkilenmez", async () => {
    const a = await trialOrg("A");
    const b = await trialOrg("B");
    await addIcal(a, AIRBNB("1"));
    const synced = await addIcal(b, AIRBNB("2"));
    expect(synced.trialNotice).toBe(TRIAL_IDENTITY_REUSED_MESSAGE);
    expect(synced).not.toHaveProperty("trialEnded");
    expect(await prisma.calendarSource.count({ where: { propertyId: b.propertyId } })).toBe(1);
    const sb = await sub(b.orgId);
    expect(sb.trialEndReason).toBe("identity_reused");
    expect(sb.trialEndsAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await prisma.auditLog.count({ where: { organizationId: b.orgId, action: "trial.ended_identity_reused" } })).toBe(1);
    const sa = await sub(a.orgId);
    expect(sa.trialEndReason).toBeNull();
    expect(sa.trialEndsAt!.getTime()).toBeGreaterThan(Date.now());
    // Aynı kaynağın sonraki okumaları kimliği YENİDEN saymaz (kaynak başına bir kez): ikinci denetim kaydı / not yok.
    expect((await syncIcal(b.orgId, synced.id)).trialNotice).toBeUndefined();
    expect(await prisma.auditLog.count({ where: { organizationId: b.orgId, action: "trial.ended_identity_reused" } })).toBe(1);
  });

  it("🚨 KONTROL: başkasının (herkese açık) ilan numarasıyla eklenen ama OKUNAMAYAN takvim (sahte jeton → giriş / hata sayfası) kimlik SAYILMAZ — gerçek sahip sonra bağlayınca denemesi sürer", async () => {
    const attacker = await trialOrg("X");
    const fake = await addIcal(attacker, AIRBNB("sahte"), "<!DOCTYPE html><html><body>Giriş yapın</body></html>");
    expect(fake.errors.length).toBeGreaterThan(0);
    expect(await prisma.trialIdentity.count()).toBe(0);
    expect((await prisma.calendarSource.findUniqueOrThrow({ where: { id: fake.id } })).trialIdentityCheckedAt).toBeNull();
    const owner = await trialOrg("O");
    expect((await addIcal(owner, AIRBNB("gercek"))).trialNotice).toBeUndefined();
    expect((await sub(owner.orgId)).trialEndReason).toBeNull();
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
    // Pozitif kontrol (Haiku: tespit bozuk olsa da yukarısı geçerdi): aynı ilanı bağlayan sıradan deneme hesabının denemesi biter.
    const plain = await trialOrg("N");
    expect((await addIcal(plain, AIRBNB("5"))).trialNotice).toBe(TRIAL_IDENTITY_REUSED_MESSAGE);
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
        { keyHash: "v1:old-orphan", keyType: "ota_calendar", firstOrganizationId: null, lastSeenAt: new Date("2027-12-01T00:00:00Z") },
        { keyHash: "v1:young-orphan", keyType: "ota_calendar", firstOrganizationId: null, lastSeenAt: new Date("2028-03-01T00:00:00Z") },
        { keyHash: "v1:old-live", keyType: "ota_calendar", firstOrganizationId: live.orgId, lastSeenAt: new Date("2025-01-01T00:00:00Z") },
      ],
    });
    expect(await sweepTrialIdentities(now)).toBe(1);
    expect((await prisma.trialIdentity.findMany({ select: { keyHash: true } })).map((r) => r.keyHash).sort()).toEqual(["v1:old-live", "v1:young-orphan"]);
  });

  it("🚨 ilk açılış geri doldurması: mevcut hesapların kimlikleri YALNIZ kaydedilir (kimsenin denemesi bitmez), en eski hesap 'ilk'; bir kez koşar", async () => {
    await flagNeverOn();
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

  it("🚨 KONTROL: anahtar açıldığı an HATA durumundaki eski takvim sonra düzelip okunursa da ceza yok (anahtar öncesi eklenen takvim muaf); sonradan gelen yeni hesap cezalanır", async () => {
    await flagNeverOn();
    const a = await trialOrg("A");
    await addIcal(a, AIRBNB("1"));
    const b = await trialOrg("B");
    const broken = await addIcal(b, AIRBNB("2"), "<html>zaman aşımı</html>");
    expect(broken.errors.length).toBeGreaterThan(0);
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "1");
    expect(await backfillTrialIdentitiesOnce()).toBe("done"); // zamanlanmış geçiş: açılış anı + A kaydedilir, B (hata) atlanır
    expect((await syncIcal(b.orgId, broken.id)).trialNotice).toBeUndefined();
    expect((await sub(b.orgId)).trialEndReason).toBeNull();
    expect((await prisma.calendarSource.findUniqueOrThrow({ where: { id: broken.id } })).trialIdentityCheckedAt).not.toBeNull();
    const c = await trialOrg("C");
    expect((await addIcal(c, AIRBNB("3"))).trialNotice).toBe(TRIAL_IDENTITY_REUSED_MESSAGE);
  });

  it("🚨 anahtar açıldıktan sonra eklenen takvim, zamanlanmış geçiş henüz koşmadan okunsa da geri doldurma ÖNCE koşar: eski hesabın ilanını bağlayan yeni hesap cezalanır", async () => {
    await flagNeverOn();
    const a = await trialOrg("A");
    await addIcal(a, AIRBNB("1"));
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "1");
    // Açılış anı gözlendi (ör. başka bir org'un senkronu) ama geri doldurma işareti yok — geri doldurmayı kayıt yolu tetikler.
    await prisma.systemLock.create({ data: { name: TRIAL_IDENTITY_ENABLED_AT_MARKER, lockedUntil: new Date() } });
    const b = await trialOrg("B");
    expect((await addIcal(b, AIRBNB("2"))).trialNotice).toBe(TRIAL_IDENTITY_REUSED_MESSAGE);
    expect((await sub(a.orgId)).trialEndReason).toBeNull();
    expect(await prisma.systemLock.count({ where: { name: TRIAL_IDENTITY_BACKFILL_MARKER } })).toBe(1);
  });

  it("🚨 KONTROL: anahtar açıldıktan sonraki İLK olay, iki hesapta zaten bulunan ESKİ takvimin yeniden okunmasıysa da ceza yok; en eski hesap 'ilk' kalır", async () => {
    await flagNeverOn();
    const a = await trialOrg("A");
    await addIcal(a, AIRBNB("1"));
    const b = await trialOrg("B");
    const old = await addIcal(b, AIRBNB("2"));
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "1");
    expect((await syncIcal(b.orgId, old.id)).trialNotice).toBeUndefined();
    expect((await sub(b.orgId)).trialEndReason).toBeNull();
    expect((await prisma.trialIdentity.findFirstOrThrow()).firstOrganizationId).toBe(a.orgId);
  });

  it("KONTROL: anahtar açılmadan ÖNCE iki hesapta zaten bulunan ilan cezalandırılmaz (geri doldurma yalnız kaydeder); ilgisiz takvim eklemek denemeyi bitirmez", async () => {
    await flagNeverOn();
    const a = await trialOrg("A");
    await addIcal(a, AIRBNB("1"));
    const b = await trialOrg("B");
    const old = await addIcal(b, AIRBNB("2"));
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "1");
    await backfillTrialIdentitiesOnce(); // zamanlanmış geçiş
    const fresh = await addIcal(b, "https://www.airbnb.com/calendar/ical/555.ics?s=z");
    expect((await prisma.calendarSource.findUniqueOrThrow({ where: { id: fresh.id } })).trialIdentityCheckedAt).not.toBeNull();
    // Zaten bulunan (anahtar öncesi okunmuş) takvimin sonraki okuması da cezalandırmaz.
    expect((await syncIcal(b.orgId, old.id)).trialNotice).toBeUndefined();
    expect((await sub(b.orgId)).trialEndReason).toBeNull();
  });

  const link = async (o: { orgId: string; propertyId: string }, provider: string, externalId: string) => {
    const conn = await prisma.channelConnection.create({ data: { organizationId: o.orgId, provider, status: "active" } });
    await recordChannelListings(o.orgId, conn.id, [{ externalId, propertyId: o.propertyId }]);
  };

  it("🚨 ilan yazıcısı: A ilanı iCal ile, B AYNI ilanı doğrudan Airbnb bağlantısıyla bağlar → aynı kimlik, B'nin denemesi biter", async () => {
    vi.stubEnv("CHANNEL_METADATA_WRITE", "1");
    const a = await trialOrg("A");
    await addIcal(a, AIRBNB("1"));
    const b = await trialOrg("B");
    await link(b, "airbnb_direct", "123456789");
    expect((await sub(a.orgId)).trialEndReason).toBeNull();
    expect((await sub(b.orgId)).trialEndReason).toBe("identity_reused");
  });

  it("KONTROL: anahtar öncesi iki hesapta bulunan ilanın aynı hesapta BAŞKA daireye yeniden eşlenmesi yeni kullanım sayılmaz", async () => {
    vi.stubEnv("CHANNEL_METADATA_WRITE", "1");
    await flagNeverOn();
    const a = await trialOrg("A");
    await link(a, "airbnb_direct", "123456789");
    const b = await trialOrg("B");
    const conn = await prisma.channelConnection.create({ data: { organizationId: b.orgId, provider: "airbnb_direct", status: "active" } });
    await recordChannelListings(b.orgId, conn.id, [{ externalId: "123456789", propertyId: b.propertyId }]);
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "1");
    const other = await prisma.property.create({ data: { organizationId: b.orgId, name: "B ikinci daire" } });
    await recordChannelListings(b.orgId, conn.id, [{ externalId: "123456789", propertyId: other.id }]);
    expect((await prisma.channelListing.findFirstOrThrow({ where: { connectionId: conn.id } })).propertyId).toBe(other.id);
    expect((await sub(b.orgId)).trialEndReason).toBeNull();
  });

  it("🚨 anahtar açıldıktan sonraki İLK olay doğrudan kanal ilanıysa da geri doldurma ÖNCE koşar: eski hesabın (iCal) ilanını bağlayan yeni hesabın denemesi biter", async () => {
    vi.stubEnv("CHANNEL_METADATA_WRITE", "1");
    await flagNeverOn();
    const a = await trialOrg("A");
    await addIcal(a, AIRBNB("1"));
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "1");
    const b = await trialOrg("B");
    await link(b, "airbnb_direct", "123456789");
    expect((await sub(b.orgId)).trialEndReason).toBe("identity_reused");
    expect((await sub(a.orgId)).trialEndReason).toBeNull();
  });

  it("🚨 geri doldurma yalnız açılış anından ÖNCEKİ ilan eşlemesini alır: açılıştan sonra bağlanan ilan (hesap daha eski olsa da) 'ilk' sayılmaz", async () => {
    vi.stubEnv("CHANNEL_METADATA_WRITE", "1");
    await flagNeverOn();
    const older = await trialOrg("Eski"); // daha ESKİ hesap — geri doldurmada önce işlenir
    const a = await trialOrg("A");
    await link(a, "airbnb_direct", "123456789"); // anahtar öncesi
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "1");
    await prisma.systemLock.create({ data: { name: TRIAL_IDENTITY_ENABLED_AT_MARKER, lockedUntil: new Date() } }); // açılış gözlendi, geri doldurma koşmadı
    await link(older, "airbnb_direct", "123456789"); // anahtar sonrası
    expect((await sub(older.orgId)).trialEndReason).toBe("identity_reused");
    expect((await prisma.trialIdentity.findFirstOrThrow()).firstOrganizationId).toBe(a.orgId);
  });

  it("🚨 KONTROL: anahtar ÖNCESİ eklenmiş ama hiç okunamamış takvim (sahte jeton) geri doldurmada da kimlik sayılmaz — başkasının ilanını önceden kapamaz", async () => {
    await flagNeverOn();
    const attacker = await trialOrg("X");
    const fake = await addIcal(attacker, AIRBNB("sahte"), "<html>Giriş yapın</html>");
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "1");
    expect(await backfillTrialIdentitiesOnce()).toBe("done");
    expect(await prisma.trialIdentity.count()).toBe(0);
    expect((await prisma.calendarSource.findUniqueOrThrow({ where: { id: fake.id } })).trialIdentityCheckedAt).toBeNull();
    const owner = await trialOrg("O");
    expect((await addIcal(owner, AIRBNB("gercek"))).trialNotice).toBeUndefined();
  });

  it("KONTROL: düzeltmeden (U37, 10-08) önceki 'başarılı' okuma güvenilmez — geri doldurma o takvimi kaydetmez", async () => {
    await flagNeverOn();
    const a = await trialOrg("A");
    const old = await addIcal(a, AIRBNB("1"));
    await prisma.calendarSource.update({ where: { id: old.id }, data: { lastSyncedAt: new Date("2026-10-01T00:00:00Z") } });
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "1");
    expect(await backfillTrialIdentitiesOnce()).toBe("done");
    expect(await prisma.trialIdentity.count()).toBe(0);
    expect((await prisma.calendarSource.findUniqueOrThrow({ where: { id: old.id } })).trialIdentityCheckedAt).toBeNull();
  });

  it("🚨 özet anahtarı değişmişse (parmak izi uyuşmaz) kayıt DURUR: iz yazılmaz, takvim 'sayıldı' işaretlenmez, deneme bitmez", async () => {
    const a = await trialOrg("A");
    await addIcal(a, AIRBNB("1"));
    expect(await prisma.trialIdentity.count()).toBe(1);
    await prisma.systemLock.update({ where: { name: TRIAL_IDENTITY_KEY_FP_MARKER }, data: { holder: "fp:baska-anahtar" } });
    const b = await trialOrg("B");
    const synced = await addIcal(b, AIRBNB("2"));
    expect(synced.trialNotice).toBeUndefined();
    expect(await prisma.trialIdentity.count()).toBe(1);
    expect((await prisma.calendarSource.findUniqueOrThrow({ where: { id: synced.id } })).trialIdentityCheckedAt).toBeNull();
    expect((await sub(b.orgId)).trialEndReason).toBeNull();
  });

  it("🚨 anahtar KAPANINCA zamanlanmış geçiş açılış anı + geri doldurma işaretini siler (parmak izi kalır): kapalıyken bağlanan ilan yeniden açılışta kayda geçer", async () => {
    vi.stubEnv("CHANNEL_METADATA_WRITE", "1");
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "");
    expect(await backfillTrialIdentitiesOnce()).toBe("off");
    expect((await prisma.systemLock.findMany({ where: { name: { startsWith: "trial-identity-" } }, select: { name: true } })).map((r) => r.name)).toEqual([
      TRIAL_IDENTITY_KEY_FP_MARKER,
    ]);
    const a = await trialOrg("A");
    await link(a, "airbnb_direct", "123456789"); // anahtar kapalıyken
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "1");
    expect(await backfillTrialIdentitiesOnce()).toBe("done"); // yeniden açılış: yeni açılış anı + geri doldurma
    const b = await trialOrg("B");
    await link(b, "airbnb_direct", "123456789");
    expect((await sub(b.orgId)).trialEndReason).toBe("identity_reused");
    expect((await sub(a.orgId)).trialEndReason).toBeNull();
  });

  it("🚨 aynı kaynağın EŞZAMANLI iki okuması kimliği bir kez sayar: tek not, tek denetim kaydı", async () => {
    const a = await trialOrg("A");
    await addIcal(a, AIRBNB("1"));
    const b = await trialOrg("B");
    asOwner(b.orgId);
    const added = await addSource(
      new NextRequest(`http://localhost/api/properties/${b.propertyId}/calendar-sources`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "Airbnb", url: AIRBNB("2") }),
      }),
      { params: Promise.resolve({ id: b.propertyId }) },
    );
    const src = await prisma.calendarSource.findUniqueOrThrow({ where: { id: ((await added.json()) as { id: string }).id } });
    const results = await Promise.all([1, 2, 3].map(() => recordVerifiedCalendarIdentity(src, b.orgId, AIRBNB("2"))));
    expect(results.filter((r) => r.trialEnded)).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { organizationId: b.orgId, action: "trial.ended_identity_reused" } })).toBe(1);
  });

  it("🚨 KONTROL: köprü sağlayıcısının (Hospitable) mülk kimliği iz ÜRETMEZ — iki hesap aynı Hospitable mülk kimliğini bağlasa da deneme sürer", async () => {
    vi.stubEnv("CHANNEL_METADATA_WRITE", "1");
    const a = await trialOrg("A");
    await link(a, "hospitable", "p-42");
    const b = await trialOrg("B");
    await link(b, "hospitable", "p-42");
    expect(await prisma.trialIdentity.count()).toBe(0);
    expect((await sub(b.orgId)).trialEndReason).toBeNull();
  });

  it("enforce: false yalnız kaydeder", async () => {
    const a = await trialOrg("A");
    const b = await trialOrg("B");
    const key = otaListingKey("airbnb", "1");
    await recordTrialIdentities(a.orgId, [key]);
    expect(await recordTrialIdentities(b.orgId, [key], { enforce: false })).toEqual({ reused: true, trialEnded: false, ok: true });
    expect((await sub(b.orgId)).trialEndReason).toBeNull();
  });
});

describe("operatör: denemeyi geri ver", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "1");
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR_EMAIL);
    await backfillTrialIdentitiesOnce();
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

  it("🚨 K8: operatör müşteri hesabına BÜRÜNMÜŞKEN istisna yazamaz (403), hiçbir şey değişmez", async () => {
    const b = await trialOrg("B");
    const opId = await operator();
    session = {
      userId: "musteri",
      organizationId: b.orgId,
      role: "owner",
      email: "o@x.com",
      name: "O",
      sessionEpoch: 0,
      mfa: true,
      actorUserId: opId,
      actorEmail: OPERATOR_EMAIL,
      impersonatedAt: Math.floor(Date.now() / 1000),
    };
    expect((await exempt(b.orgId)).status).toBe(403);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: b.orgId } })).trialIdentityExempt).toBe(false);
    expect(await prisma.auditLog.count({ where: { action: "trial.identity_exempt" } })).toBe(0);
  });
});
