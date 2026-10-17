// ---------------------------------------------------------------------------
// YAŞAM DÖNGÜSÜ MESAJLARI — TEK TARİH KURALI (ikinci inceleme 09-25, zaman ajanı P1).
//
// Saklı rezervasyon tarihi iki biçimde durur: "yalnız tarih" (D 00:00Z — Hospitable köprüsü; D 12:00Z — iCal tarih
// değeri) ve gerçek an (iCal TZID). Karşılama / giriş / çıkış göndericileri her değeri org gününün BAŞINA kıyaslıyor,
// çıkış göndericisi ayrıca değeri org dilimine ÇEVİRİYORDU (`dateKeyInTimeZone`). Ölçülen sonuç:
//  · New York'ta çıkış hatırlatması çıkıştan bir gün ÖNCE 08:00–11:00 arası gidiyordu (misafire "bugün çıkış" — yanlış gün);
//  · aynı gün giriş yapan misafirin karşılama ve giriş mesajı hiç gitmiyordu;
//  · Auckland'da dünün 12:00Z değeri "bugün" sayılıyor, başlamış konaklamaya giriş mesajı gidiyordu.
// Kural artık `calendarDateOf` (gönderici ve önizleme AYNI). İstanbul davranışı değişmedi (öteki dosyalar pinliyor).
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));

import { sendOnChannel } from "@/lib/messaging";
import {
  previewCheckins,
  previewCheckouts,
  previewWelcomes,
  sendDueCheckins,
  sendDueCheckouts,
  sendDueWelcomes,
} from "@/lib/automation";

const mockSend = vi.mocked(sendOnChannel);
const midnight = (d: string) => new Date(`${d}T00:00:00.000Z`);
const noon = (d: string) => new Date(`${d}T12:00:00.000Z`);

async function seed(timezone: string, stay: { arrival: Date; departure: Date }) {
  const enabledAt = new Date("2026-01-01T00:00:00Z");
  const org = await prisma.organization.create({
    data: {
      name: "Gün Kuralı Org",
      timezone,
      autoWelcome: true,
      autoWelcomeEnabledAt: enabledAt,
      autoCheckin: true,
      autoCheckinEnabledAt: enabledAt,
      autoCheckout: true,
      autoCheckoutEnabledAt: enabledAt,
    },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
  for (const category of ["welcome", "checkin", "checkout"]) {
    await prisma.knowledgeBaseItem.create({
      data: { propertyId: property.id, category, title: category, content: `${category} metni`, isActive: true },
    });
  }
  await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Ayşe Yılmaz",
      arrivalDate: stay.arrival,
      departureDate: stay.departure,
      channel: "airbnb",
      status: "confirmed",
      sourceReference: "res-day-rule",
    },
  });
  return org.id;
}

describe("yaşam döngüsü mesajları — TEK TARİH KURALI (New York / Auckland)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true } as never);
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("🚨 New York: çıkış hatırlatması çıkıştan bir gün ÖNCE gitmez, çıkış GÜNÜ sabahı gider (D 00:00Z)", async () => {
    const orgId = await seed("America/New_York", { arrival: midnight("2026-06-17"), departure: midnight("2026-06-20") });
    vi.setSystemTime(new Date("2026-06-19T13:00:00Z")); // 06-19 09:00 EDT — çıkıştan bir gün önce
    expect((await sendDueCheckouts(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2026-06-20T13:00:00Z")); // 06-20 09:00 EDT — çıkış günü
    expect((await sendDueCheckouts(orgId)).sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("🚨 Auckland: iCal tarih değeri (D 12:00Z) çıkışında hatırlatma çıkış GÜNÜ gider, ertesi gün gitmez", async () => {
    const orgId = await seed("Pacific/Auckland", { arrival: noon("2026-06-17"), departure: noon("2026-06-20") });
    vi.setSystemTime(new Date("2026-06-19T21:00:00Z")); // 06-20 09:00 NZST — çıkış günü
    expect((await sendDueCheckouts(orgId)).sent).toBe(1);
    await prisma.reservation.updateMany({ data: { checkoutSentAt: null } });
    vi.clearAllMocks();
    mockSend.mockResolvedValue({ ok: true } as never);
    vi.setSystemTime(new Date("2026-06-20T21:00:00Z")); // 06-21 09:00 NZST — çıkıştan sonraki gün
    expect((await sendDueCheckouts(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("🚨 New York: AYNI GÜN giriş yapan misafirin karşılama ve giriş mesajı gider (eskiden hiç gitmiyordu)", async () => {
    const orgId = await seed("America/New_York", { arrival: midnight("2026-06-20"), departure: midnight("2026-06-22") });
    vi.setSystemTime(new Date("2026-06-20T14:00:00Z")); // 06-20 10:00 EDT — giriş günü
    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
    expect((await sendDueCheckins(orgId)).sent).toBe(1);
  });

  it("KONTROL (New York): DÜN başlamış konaklamaya karşılama/giriş mesajı gitmez", async () => {
    const orgId = await seed("America/New_York", { arrival: midnight("2026-06-19"), departure: midnight("2026-06-22") });
    vi.setSystemTime(new Date("2026-06-20T14:00:00Z"));
    expect((await sendDueWelcomes(orgId)).sent).toBe(0);
    expect((await sendDueCheckins(orgId)).sent).toBe(0);
  });

  it("🚨 Auckland: DÜN başlamış konaklamaya (D 12:00Z) giriş mesajı gitmez (eskiden 'bugün' sayılıyordu)", async () => {
    const orgId = await seed("Pacific/Auckland", { arrival: noon("2026-06-19"), departure: noon("2026-06-22") });
    vi.setSystemTime(new Date("2026-06-19T22:00:00Z")); // 06-20 10:00 NZST
    expect((await sendDueCheckins(orgId)).sent).toBe(0);
    expect((await sendDueWelcomes(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("önizleme == gerçek: New York'ta bugünün çıkışı ve bugünün girişi önizlemede de görünür", async () => {
    const outId = await seed("America/New_York", { arrival: midnight("2026-06-17"), departure: midnight("2026-06-20") });
    vi.setSystemTime(new Date("2026-06-20T14:00:00Z"));
    expect((await previewCheckouts(outId)).map((p) => p.guest)).toEqual(["Ayşe Yılmaz"]);

    await resetDb();
    const inId = await seed("America/New_York", { arrival: midnight("2026-06-20"), departure: midnight("2026-06-22") });
    expect((await previewCheckins(inId)).map((p) => p.guest)).toEqual(["Ayşe Yılmaz"]);
    expect((await previewWelcomes(inId, 12, new Date("2026-06-20T14:00:00Z"))).map((p) => p.guest)).toEqual(["Ayşe Yılmaz"]);
  });

  it("önizleme KONTROL: dün biten konaklamanın çıkışı önizlemede yok (Auckland D 12:00Z)", async () => {
    const orgId = await seed("Pacific/Auckland", { arrival: noon("2026-06-15"), departure: noon("2026-06-19") });
    vi.setSystemTime(new Date("2026-06-19T22:00:00Z")); // 06-20 10:00 NZST
    expect(await previewCheckouts(orgId)).toEqual([]);
  });
});
