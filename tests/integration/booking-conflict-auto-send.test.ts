import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// "OTOMATİK GÖNDERİM DURDURULDU" YALNIZ GERÇEKTEN DURDURULUYORSA (kurucu 11-20 sabah B-1: "yalnız bu rezervasyon için gönderim gerçekten
// engelleniyorsa gösterilsin. Eski mesajları sonradan gönderme sözü vermesin."). Gerçek PostgreSQL, kanal taklit.
//
// Yüklem (`lib/booking-conflict-auto-send.ts`): rezervasyon iki dairede etkin kayıtlı (tutma kuralı, `booking-property-conflict.ts`) VE tutma
// kalksa göndericilerden biri (karşılama / giriş / çıkış) bu rezervasyona — şimdi ya da penceresi gelince — mesaj gönderecek. İki yön:
// engelleniyor → var; engellenmiyor (anahtar kapalı, bağlantı yok, kanalsız, metin yok, gönderilmiş, pencere geçmiş, onaysız, silinmiş, tek
// daire) → yok. Ayrıca PARİTE: yanlış kopya kaldırılınca gerçek gönderici gönderiyor ⇔ yüklem "durduruldu" demişti.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: undefined })),
}));
vi.mock("@/lib/hospitable-credentials", async (orig) => ({
  ...(await orig<typeof import("@/lib/hospitable-credentials")>()),
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
  // `hasMessagingConnection` → `getConnectionInfo` (belirteç çekmez) — Girişler ile aynı okuma.
  getConnectionInfo: vi.fn().mockResolvedValue({ connected: true }),
}));

import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { seedAutoMessage } from "../helpers/auto-message";
import { stayDay } from "../helpers/stay-dates";
import { autoSendStoppedByConflict } from "@/lib/booking-conflict-auto-send";
import { findAttentionItems } from "@/modules/intelligence/incidents/attention";
import { sendDueCheckins, sendDueWelcomes } from "@/lib/automation";
import { getConnectionInfo } from "@/lib/hospitable-credentials";
import { tombstoneKeyHash, currentKeyFingerprint } from "@/lib/erasure";

const KINDS = ["welcome", "checkin", "checkout"] as const;
type Kind = (typeof KINDS)[number];

/**
 * Engellenen olağan durum: üç tür açık (taban eski), kanal bağlı; Lale 3'te KANALDAN gelen onaylı kayıt (üç türün metni Lale 3'te), Lale 5'te
 * elle girilmiş yanlış kopya. Varış iki gün sonra (giriş mesajı penceresinde).
 */
async function world(o: { kinds?: readonly Kind[]; templatesOn?: "channel" | "copy" | "none"; arrival?: Date; departure?: Date } = {}) {
  const kinds = o.kinds ?? KINDS;
  const on = (k: Kind) => kinds.includes(k);
  const org = await prisma.organization.create({
    data: {
      name: "Org",
      timezone: "Europe/Istanbul",
      aiSignature: "Lale",
      autoWelcome: on("welcome"),
      autoWelcomeEnabledAt: on("welcome") ? new Date(0) : null,
      autoCheckin: on("checkin"),
      autoCheckinEnabledAt: on("checkin") ? new Date(0) : null,
      autoCheckout: on("checkout"),
      autoCheckoutEnabledAt: on("checkout") ? new Date(0) : null,
    },
  });
  const lale3 = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 3", createdAt: PROPERTY_EXISTED_BEFORE } });
  const lale5 = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 5", createdAt: PROPERTY_EXISTED_BEFORE } });
  const templated = (o.templatesOn ?? "channel") === "channel" ? lale3.id : o.templatesOn === "copy" ? lale5.id : null;
  if (templated) for (const k of KINDS) await seedAutoMessage(templated, k, `Merhaba {isim}, ${k} metni.`);
  const arrivalDate = o.arrival ?? stayDay(2);
  const departureDate = o.departure ?? stayDay(5);
  const channelRow = await prisma.reservation.create({
    data: {
      propertyId: lale3.id, guestName: "Ada Lale", arrivalDate, departureDate, status: "confirmed",
      // Bağlantı damgası yok (eski satır gibi): gönderim yolu taklit kanala gider (PARİTE'de gerçek gönderici koşar).
      sourceReference: "HM-1", channel: "airbnb", guestNameSource: "channel",
    },
  });
  const copy = await prisma.reservation.create({
    data: {
      propertyId: lale5.id, guestName: "Ada Lale", arrivalDate, departureDate, status: "confirmed",
      sourceReference: "HM-1", channel: "manual", guestNameSource: "host",
    },
  });
  return { orgId: org.id, lale3: lale3.id, lale5: lale5.id, channelRowId: channelRow.id, copyId: copy.id };
}

const stopped = async (orgId: string, now = new Date()) => [...(await autoSendStoppedByConflict({ organizationId: orgId, refs: ["HM-1"], now }))];

describe("autoSendStoppedByConflict — tutma gerçekten bir otomatik mesajı durduruyor mu (gerçek PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.mocked(getConnectionInfo).mockResolvedValue({ connected: true } as never);
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 olağan durum: iki dairede etkin kayıt + gönderilecek mesaj var → durduruldu", async () => {
    const w = await world();
    expect(await stopped(w.orgId)).toEqual(["HM-1"]);
  });

  it("🚨 tek tür yeter: yalnız karşılama / yalnız giriş / yalnız çıkış açık → durduruldu", async () => {
    for (const k of KINDS) {
      await resetDb();
      const w = await world({ kinds: [k] });
      expect(await stopped(w.orgId), k).toEqual(["HM-1"]);
    }
  });

  it("🚨 çakışma yoksa (yanlış kopya kaldırıldı) → durduruldu DEĞİL; tutma da yok", async () => {
    const w = await world();
    await prisma.reservation.delete({ where: { id: w.copyId } });
    expect(await stopped(w.orgId)).toEqual([]);
  });

  it("🚨 işletmede otomatik mesajlar kapalı / açılış tabanı yok / genel anahtar kapalı / kanal bağlı değil → durduruldu DEĞİL", async () => {
    let w = await world({ kinds: [] });
    expect(await stopped(w.orgId), "üç anahtar kapalı").toEqual([]);

    await resetDb();
    w = await world();
    await prisma.organization.update({
      where: { id: w.orgId },
      data: { autoWelcomeEnabledAt: null, autoCheckinEnabledAt: null, autoCheckoutEnabledAt: null },
    });
    expect(await stopped(w.orgId), "taban yok").toEqual([]);

    await resetDb();
    w = await world();
    vi.stubEnv("AUTO_REPLY_ENABLED", "0");
    expect(await stopped(w.orgId), "genel anahtar").toEqual([]);
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");

    vi.mocked(getConnectionInfo).mockResolvedValue({ connected: false } as never);
    expect(await stopped(w.orgId), "bağlantı yok").toEqual([]);
  });

  it("🚨 anahtar kapatılmış ama açılış tabanı duruyor → DEĞİL (taban tek başına yetmez)", async () => {
    const w = await world();
    await prisma.organization.update({ where: { id: w.orgId }, data: { autoWelcome: false, autoCheckin: false, autoCheckout: false } });
    expect(await stopped(w.orgId)).toEqual([]);
  });

  it("🚨 rezervasyon anahtar açılmadan ÖNCE gelmiş (açılış tabanı sonra) → DEĞİL (gönderici eskilere göndermez)", async () => {
    const w = await world();
    const later = new Date(Date.now() + 3_600_000);
    await prisma.organization.update({
      where: { id: w.orgId },
      data: { autoWelcomeEnabledAt: later, autoCheckinEnabledAt: later, autoCheckoutEnabledAt: later },
    });
    expect(await stopped(w.orgId)).toEqual([]);
  });

  it("🚨 aynı işletmenin başka bir rezervasyonu karışmaz: sorulan çakışmalı kayıtta gönderilecek metin yok, öteki tek dairede gönderilebilir", async () => {
    const w = await world({ templatesOn: "none" });
    const lale7 = await prisma.property.create({ data: { organizationId: w.orgId, name: "Lale 7", createdAt: PROPERTY_EXISTED_BEFORE } });
    for (const k of KINDS) await seedAutoMessage(lale7.id, k, `Merhaba {isim}, ${k} metni.`);
    await prisma.reservation.create({
      data: {
        propertyId: lale7.id, guestName: "Can Lale", arrivalDate: stayDay(2), departureDate: stayDay(5), status: "confirmed",
        sourceReference: "HM-2", channel: "airbnb", guestNameSource: "channel",
      },
    });
    expect([...(await autoSendStoppedByConflict({ organizationId: w.orgId, refs: ["HM-1", "HM-2"], now: new Date() }))]).toEqual([]);
  });

  it("🚨 kanalsız rezervasyon (iki kayıt da elle / takvim) → durduruldu DEĞİL (gönderici zaten göndermez)", async () => {
    const w = await world();
    await prisma.reservation.update({ where: { id: w.channelRowId }, data: { channel: "ics", guestNameSource: "file" } });
    expect(await stopped(w.orgId)).toEqual([]);
  });

  it("🚨 metin yalnız yanlış kopyanın dairesinde (kanal satırının dairesinde yok) → durduruldu DEĞİL; hiç metin yok → DEĞİL", async () => {
    let w = await world({ templatesOn: "copy" });
    expect(await stopped(w.orgId), "metin kopyada").toEqual([]);
    await resetDb();
    w = await world({ templatesOn: "none" });
    expect(await stopped(w.orgId), "metin yok").toEqual([]);
  });

  it("🚨 üç mesaj da gönderilmiş → DEĞİL; biri gönderilmemişse → durduruldu", async () => {
    const w = await world();
    const sent = new Date();
    await prisma.reservation.update({ where: { id: w.channelRowId }, data: { welcomeSentAt: sent, checkinSentAt: sent, checkoutSentAt: sent } });
    expect(await stopped(w.orgId)).toEqual([]);
    await prisma.reservation.update({ where: { id: w.channelRowId }, data: { checkoutSentAt: null } });
    expect(await stopped(w.orgId)).toEqual(["HM-1"]);
  });

  it("🚨 onaylanmamış (beklemede) kanal kaydı → DEĞİL (gönderici zaten göndermez); onaylanınca → durduruldu", async () => {
    const w = await world();
    await prisma.reservation.update({ where: { id: w.channelRowId }, data: { status: "pending" } });
    expect(await stopped(w.orgId)).toEqual([]);
    await prisma.reservation.update({ where: { id: w.channelRowId }, data: { status: "confirmed" } });
    expect(await stopped(w.orgId)).toEqual(["HM-1"]);
  });

  it("🚨 misafir açıkça silinmiş (KVKK) → DEĞİL (gönderici silinmiş misafire göndermez)", async () => {
    const w = await world();
    await prisma.erasureTombstone.create({
      data: {
        organizationId: w.orgId,
        keyType: "source_reference",
        keyHash: tombstoneKeyHash(w.orgId, "source_reference", "HM-1")!,
        keyFingerprint: currentKeyFingerprint(),
        erasedAt: new Date(),
      },
    });
    expect(await stopped(w.orgId)).toEqual([]);
  });

  it("🚨 pencere: varış geçti (konaklama sürüyor) → karşılama / giriş DEĞİL; çıkış açıksa durduruldu, kapalıysa DEĞİL", async () => {
    let w = await world({ kinds: ["welcome", "checkin"], arrival: stayDay(-1), departure: stayDay(2) });
    expect(await stopped(w.orgId), "karşılama + giriş, varış geçti").toEqual([]);
    await resetDb();
    w = await world({ arrival: stayDay(-1), departure: stayDay(2) });
    expect(await stopped(w.orgId), "çıkış açık").toEqual(["HM-1"]);
  });

  it("🚨 çıkış günü: çıkış mesajı işletme saatiyle 12:00'ye kadar gider — 11:59'da durduruldu, 12:00'de DEĞİL (göndericiyle aynı sınır)", async () => {
    const today = stayDay(0);
    const w = await world({ kinds: ["checkout"], arrival: stayDay(-2), departure: today });
    // Varış / çıkış "yalnız tarih" (00:00Z) → İstanbul'da aynı gün. İstanbul = UTC+3: 08:59Z = 11:59, 09:00Z = 12:00.
    const at = (h: number, m: number) => new Date(today.getTime() + (h * 60 + m) * 60_000);
    expect(await stopped(w.orgId, at(5, 0)), "08:00").toEqual(["HM-1"]);
    expect(await stopped(w.orgId, at(8, 59)), "11:59").toEqual(["HM-1"]);
    expect(await stopped(w.orgId, at(9, 0)), "12:00").toEqual([]);
    expect(await stopped(w.orgId, at(13, 0)), "16:00").toEqual([]);
  });

  it("🚨 başka işletmenin aynı kimlikli rezervasyonu iki yönde de okunmaz; boş girdide sonuç boş", async () => {
    // Benim işletmem: iki dairede kayıtlı ama gönderilecek metin yok. Öteki işletme: aynı kimlik TEK dairede, gönderilebilir.
    const mine = await world({ templatesOn: "none" });
    const other = await world();
    await prisma.reservation.delete({ where: { id: other.copyId } });
    // Kiracı karışsaydı: benimki ötekinin gönderilebilir satırıyla "durduruldu", ötekisi benim kopyamla "iki dairede" olurdu.
    expect(await stopped(mine.orgId)).toEqual([]);
    expect(await stopped(other.orgId)).toEqual([]);
    expect([...(await autoSendStoppedByConflict({ organizationId: mine.orgId, refs: [], now: new Date() }))]).toEqual([]);
  });
});

describe("PARİTE: yanlış kopya kaldırılınca gerçek gönderici gönderiyor ⇔ yüklem 'durduruldu' demişti", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.mocked(getConnectionInfo).mockResolvedValue({ connected: true } as never);
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  const cases: { name: string; setup: () => Promise<{ orgId: string; copyId: string }> }[] = [
    { name: "olağan (metin kanal dairesinde)", setup: () => world({ kinds: ["welcome", "checkin"] }) },
    { name: "metin yalnız kopyanın dairesinde", setup: () => world({ kinds: ["welcome", "checkin"], templatesOn: "copy" }) },
    {
      name: "iki mesaj da gönderilmiş",
      setup: async () => {
        const w = await world({ kinds: ["welcome", "checkin"] });
        await prisma.reservation.update({ where: { id: w.channelRowId }, data: { welcomeSentAt: new Date(), checkinSentAt: new Date() } });
        return w;
      },
    },
    { name: "varış geçti", setup: () => world({ kinds: ["welcome", "checkin"], arrival: stayDay(-1), departure: stayDay(2) }) },
  ];

  for (const c of cases) {
    it(`🚨 ${c.name}`, async () => {
      const w = await c.setup();
      const said = (await stopped(w.orgId)).length > 0;
      // Tutma GERÇEKTEN uygulanıyor: kopya dururken gönderici hiçbir şey göndermez.
      expect((await sendDueWelcomes(w.orgId)).sent + (await sendDueCheckins(w.orgId)).sent, "kopya dururken").toBe(0);
      await prisma.reservation.delete({ where: { id: w.copyId } });
      const sentAfter = (await sendDueWelcomes(w.orgId)).sent + (await sendDueCheckins(w.orgId)).sent;
      expect(sentAfter > 0, `yüklem ${said ? "durduruldu" : "durdurulmadı"} dedi, gönderici ${sentAfter} gönderdi`).toBe(said);
    });
  }
});

describe("Dikkat satırı yüklemi okur", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.mocked(getConnectionInfo).mockResolvedValue({ connected: true } as never);
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  const twoPropertyRow = async (orgId: string) =>
    (await findAttentionItems(orgId, { now: new Date() })).find((i) => i.kind === "booking_two_properties");

  it("🚨 engelleniyor → satır `autoSendStopped: true`; engellenmiyor (anahtarlar kapalı) → satır YİNE var, `autoSendStopped` yok", async () => {
    const blocked = await world();
    expect((await twoPropertyRow(blocked.orgId))?.autoSendStopped).toBe(true);
    await resetDb();
    const free = await world({ kinds: [] });
    const row = await twoPropertyRow(free.orgId);
    expect(row).toBeDefined();
    expect(row?.autoSendStopped).toBeFalsy();
  });
});
