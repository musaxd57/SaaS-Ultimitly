import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// AD BİLİNMİYORSA "Merhaba," (kurucu kararı 09-28). Sağlayıcı adı vermeyen rezervasyon "Rezervasyon HM4K2" diye kaydediliyor;
// karşılama / giriş / çıkış mesajı bu değeri ad sanıp "Merhaba Rezervasyon HM4K2," yazıyordu. Gönderici ile Ayarlar önizlemesi
// AYNI gövdeyi kurar (parite).
// ---------------------------------------------------------------------------

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

async function seed(guestName: string, content: Record<"welcome" | "checkin" | "checkout", string>) {
  const enabledAt = new Date("2026-01-01T00:00:00Z");
  const org = await prisma.organization.create({
    data: {
      name: "Ad Kuralı Org",
      timezone: "Europe/Istanbul",
      autoWelcome: true,
      autoWelcomeEnabledAt: enabledAt,
      autoCheckin: true,
      autoCheckinEnabledAt: enabledAt,
      autoCheckout: true,
      autoCheckoutEnabledAt: enabledAt,
    },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
  for (const category of ["welcome", "checkin", "checkout"] as const) {
    await prisma.knowledgeBaseItem.create({
      data: { propertyId: property.id, category, title: category, content: content[category], isActive: true },
    });
  }
  await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName,
      arrivalDate: midnight("2026-06-20"),
      departureDate: midnight("2026-06-22"),
      channel: "airbnb",
      status: "confirmed",
      sourceReference: "res-name-rule",
    },
  });
  return org.id;
}

const sentBodies = () => mockSend.mock.calls.map((c) => c[1]);

describe("yaşam döngüsü mesajları — ad bilinmiyorsa 'Merhaba,'", () => {
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

  it("🚨 şablonda ad belirteci YOKKEN kodun selamı adsız: 'Merhaba,' (önizleme aynı gövde)", async () => {
    const orgId = await seed("Rezervasyon HM4K2", { welcome: "Hoş geldiniz.", checkin: "Kapı kodu 1234.", checkout: "Bugün çıkış." });
    vi.setSystemTime(new Date("2026-06-20T07:00:00Z")); // 10:00 İstanbul, giriş günü
    const [welcomePreview] = await previewWelcomes(orgId, 12, new Date());
    const [checkinPreview] = await previewCheckins(orgId, 12);
    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
    expect((await sendDueCheckins(orgId)).sent).toBe(1);
    expect(sentBodies()).toEqual(["Merhaba,\n\nHoş geldiniz.", "Merhaba,\n\nKapı kodu 1234."]);
    expect(welcomePreview.body).toBe("Merhaba,\n\nHoş geldiniz.");
    expect(checkinPreview.body).toBe("Merhaba,\n\nKapı kodu 1234.");
    for (const body of sentBodies()) expect(body).not.toContain("Rezervasyon");
  });

  it("🚨 ev sahibinin şablonundaki `{isim}` ad bilinmiyorken boşluğuyla kalkar (çıkış mesajı + önizleme)", async () => {
    const orgId = await seed("Misafir", {
      welcome: "Merhaba {isim}, hoş geldiniz.",
      checkin: "Merhaba {isim}, kapı kodu 1234.",
      checkout: "Merhaba {isim}, bugün çıkış günü.",
    });
    vi.setSystemTime(new Date("2026-06-22T07:00:00Z")); // 10:00 İstanbul, çıkış günü
    const [checkoutPreview] = await previewCheckouts(orgId, 12);
    expect((await sendDueCheckouts(orgId)).sent).toBe(1);
    expect(sentBodies()).toEqual(["Merhaba, bugün çıkış günü."]);
    expect(checkoutPreview.body).toBe("Merhaba, bugün çıkış günü.");
  });

  it("KONTROL — gerçek adda ilk ad (davranış aynı)", async () => {
    const orgId = await seed("Ayşe Yılmaz", {
      welcome: "Hoş geldiniz.",
      checkin: "Merhaba {isim}, kapı kodu 1234.",
      checkout: "Bugün çıkış.",
    });
    vi.setSystemTime(new Date("2026-06-20T07:00:00Z"));
    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
    expect((await sendDueCheckins(orgId)).sent).toBe(1);
    expect(sentBodies()).toEqual(["Merhaba Ayşe,\n\nHoş geldiniz.", "Merhaba Ayşe, kapı kodu 1234."]);
  });
});
