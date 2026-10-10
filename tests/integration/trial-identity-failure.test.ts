import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// DENEME KİMLİĞİ — kayıt ARIZASI (Haiku incelemesi 10-10: "sessiz kayıp"). Takvim kaynağı önce "sayıldı" işaretleniyor, kayıt sonra
// yapılıyordu; kayıt hata verirse iz bir daha hiç denenmiyordu. Şimdi işaret GERİ ALINIR ve sonraki okuma yeniden dener.
// Prisma temsilcisine `vi.spyOn` sonraki testlere sızar → bu test AYRI dosyada (CLAUDE.md çalışma dersi).
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
import {
  TRIAL_IDENTITY_BACKFILL_MARKER,
  TRIAL_IDENTITY_ENABLED_AT_MARKER,
  TRIAL_IDENTITY_REUSED_MESSAGE,
  backfillTrialIdentitiesOnce,
} from "@/lib/billing/trial-identity";
import { newTrialSubscriptionData } from "@/lib/billing/subscription";

const AIRBNB = (token: string) => `https://www.airbnb.com.tr/calendar/ical/123456789.ics?s=${token}`;
const VALID_ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";

async function trialOrg(name: string) {
  const org = await prisma.organization.create({ data: { name } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: `${name} daire` } });
  await prisma.subscription.create({ data: { organizationId: org.id, ...newTrialSubscriptionData() } });
  return { orgId: org.id, propertyId: property.id };
}
async function add(o: { orgId: string; propertyId: string }, url: string) {
  session = { userId: "u", organizationId: o.orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  const res = await addSource(
    new NextRequest(`http://localhost/api/properties/${o.propertyId}/calendar-sources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Airbnb", url }),
    }),
    { params: Promise.resolve({ id: o.propertyId }) },
  );
  return ((await res.json()) as { id: string }).id;
}
async function sync(orgId: string, id: string) {
  session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  vi.mocked(fetchFeedText).mockResolvedValueOnce(VALID_ICS);
  const res = await syncSource(new NextRequest(`http://localhost/api/calendar-sources/${id}/sync`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { trialNotice?: string; errors: string[] };
}

describe("deneme kimliği — kayıt arızası", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "1");
    vi.stubEnv("PRIMARY_ORG_ID", "");
    await backfillTrialIdentitiesOnce();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 kayıt hata verirse takvim 'sayıldı' işareti GERİ ALINIR, senkron yine başarılı; sonraki okuma yeniden dener ve kural işler", async () => {
    const a = await trialOrg("A");
    await sync(a.orgId, await add(a, AIRBNB("1")));
    const b = await trialOrg("B");
    const id = await add(b, AIRBNB("2"));

    // İlk çağrı arıza, sonrakiler gerçek yazım (Prisma temsilcisinde casusun "özgüne düşme"si güvenilmez → özgün baştan bağlanır).
    const original = prisma.trialIdentity.createMany.bind(prisma.trialIdentity);
    let calls = 0;
    const spy = vi
      .spyOn(prisma.trialIdentity, "createMany")
      .mockImplementation(((args: Parameters<typeof original>[0]) =>
        calls++ === 0 ? Promise.reject(new Error("db down")) : original(args)) as unknown as typeof prisma.trialIdentity.createMany);
    const first = await sync(b.orgId, id);
    expect(spy).toHaveBeenCalled();
    expect(first.errors).toEqual([]); // senkronun kendisi bozulmaz
    expect(first.trialNotice).toBeUndefined();
    expect((await prisma.calendarSource.findUniqueOrThrow({ where: { id } })).trialIdentityCheckedAt).toBeNull();
    expect((await prisma.subscription.findUniqueOrThrow({ where: { organizationId: b.orgId } })).trialEndReason).toBeNull();

    const second = await sync(b.orgId, id);
    expect(second.trialNotice).toBe(TRIAL_IDENTITY_REUSED_MESSAGE);
    expect((await prisma.calendarSource.findUniqueOrThrow({ where: { id } })).trialIdentityCheckedAt).not.toBeNull();
    expect((await prisma.subscription.findUniqueOrThrow({ where: { organizationId: b.orgId } })).trialEndReason).toBe("identity_reused");
  });

  it("🚨 geri doldurmada bir işletmenin kaydı hata verirse geri doldurma TAMAMLANMAZ (işaret yok, o takvim 'sayıldı' işaretlenmez); diğerleri kaydedilir", async () => {
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "");
    await prisma.systemLock.deleteMany({ where: { name: { in: [TRIAL_IDENTITY_BACKFILL_MARKER, TRIAL_IDENTITY_ENABLED_AT_MARKER] } } });
    const a = await trialOrg("A");
    const aId = await add(a, AIRBNB("1"));
    await sync(a.orgId, aId);
    const b = await trialOrg("B");
    const bId = await add(b, "https://www.airbnb.com/calendar/ical/555.ics?s=z");
    await sync(b.orgId, bId);
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "1");

    const original = prisma.trialIdentity.createMany.bind(prisma.trialIdentity);
    let calls = 0;
    vi.spyOn(prisma.trialIdentity, "createMany").mockImplementation(((args: Parameters<typeof original>[0]) =>
      calls++ === 0 ? Promise.reject(new Error("db down")) : original(args)) as unknown as typeof prisma.trialIdentity.createMany);

    expect(await backfillTrialIdentitiesOnce()).toBe("incomplete");
    expect(await prisma.systemLock.count({ where: { name: TRIAL_IDENTITY_BACKFILL_MARKER } })).toBe(0);
    expect((await prisma.calendarSource.findUniqueOrThrow({ where: { id: aId } })).trialIdentityCheckedAt).toBeNull(); // A (ilk, arızalı)
    expect((await prisma.calendarSource.findUniqueOrThrow({ where: { id: bId } })).trialIdentityCheckedAt).not.toBeNull(); // B kaydedildi
    expect(await prisma.trialIdentity.count()).toBe(1);
    // Sonraki geçiş yeniden dener ve tamamlar.
    expect(await backfillTrialIdentitiesOnce()).toBe("done");
    expect(await prisma.trialIdentity.count()).toBe(2);
  });

  it("🚨 geri doldurma EKSİKKEN yeni hesap eski hesabın ilanının 'ilk sahibi' olamaz: hiçbir kimlik yazılmaz; tamamlanınca yeni hesap cezalanır (Haiku üçüncü inceleme)", async () => {
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "");
    await prisma.systemLock.deleteMany({ where: { name: { in: [TRIAL_IDENTITY_BACKFILL_MARKER, TRIAL_IDENTITY_ENABLED_AT_MARKER] } } });
    const a = await trialOrg("A");
    await sync(a.orgId, await add(a, AIRBNB("1")));
    vi.stubEnv("TRIAL_IDENTITY_ENABLED", "1");

    const original = prisma.trialIdentity.createMany.bind(prisma.trialIdentity);
    let failA = true;
    vi.spyOn(prisma.trialIdentity, "createMany").mockImplementation(((args: Parameters<typeof original>[0]) => {
      const rows = (args as { data: { firstOrganizationId?: string | null }[] }).data;
      return failA && rows.some((r) => r.firstOrganizationId === a.orgId) ? Promise.reject(new Error("db down")) : original(args);
    }) as unknown as typeof prisma.trialIdentity.createMany);

    expect(await backfillTrialIdentitiesOnce()).toBe("incomplete");
    const c = await trialOrg("C");
    const cId = await add(c, AIRBNB("2"));
    expect((await sync(c.orgId, cId)).trialNotice).toBeUndefined();
    expect(await prisma.trialIdentity.count()).toBe(0); // C ilk sahip OLMADI
    expect((await prisma.calendarSource.findUniqueOrThrow({ where: { id: cId } })).trialIdentityCheckedAt).toBeNull();

    failA = false; // arıza geçti
    expect((await sync(c.orgId, cId)).trialNotice).toBe(TRIAL_IDENTITY_REUSED_MESSAGE);
    expect((await prisma.trialIdentity.findFirstOrThrow()).firstOrganizationId).toBe(a.orgId);
  });
});
