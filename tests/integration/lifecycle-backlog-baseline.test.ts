import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { createKbWithAutoMessage } from "../helpers/auto-message";

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
vi.mock("@/lib/messaging", async (orig) => ({ ...(await orig<typeof import("@/lib/messaging")>()), sendOnChannel: vi.fn() }));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) } }));

import { sendOnChannel } from "@/lib/messaging";
import { sendDueWelcomes, sendDueCheckins, sendDueCheckouts, LIFECYCLE_BACKLOG_GRACE_MS } from "@/lib/automation";

// ---------------------------------------------------------------------------
// Tur 7 S7-4 (kurucu önceliği 11-05) — Ayarlar "açıldıktan sonra yapılan rezervasyonlara gider; eskilere gönderilmez" diyor. Taban yalnız
// anahtarın açıldığı andı ve `Reservation.createdAt` Lixus'a ilk geliş anıdır → anahtar bağlantıdan ÖNCE açılmışsa ya da ilan sonradan
// eklendiyse, ilk senkronla gelen ESKİ rezervasyonlar karşılama / giriş / çıkış mesajı alıyordu. Taban artık daire başına.
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const mockSend = vi.mocked(sendOnChannel);

const istToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** Anahtarlar 10 gün önce açılmış işletme; daire `propertyAgeMs` önce Lixus'a gelmiş; rezervasyon ŞİMDİ içe alınıyor. */
async function seed(propertyAgeMs: number, stay: { arrival: Date; departure: Date }) {
  const enabledAt = new Date(Date.now() - 10 * DAY);
  const org = await prisma.organization.create({
    data: {
      name: "Org",
      autoWelcome: true,
      autoWelcomeEnabledAt: enabledAt,
      autoCheckin: true,
      autoCheckinEnabledAt: enabledAt,
      autoCheckout: true,
      autoCheckoutEnabledAt: enabledAt,
    },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale", createdAt: new Date(Date.now() - propertyAgeMs) } });
  for (const category of ["welcome", "checkin", "checkout"] as const) {
    await createKbWithAutoMessage({ data: { propertyId: property.id, category, title: category, content: `Mesaj ${category}` } });
  }
  await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Ayşe Yılmaz",
      arrivalDate: stay.arrival,
      departureDate: stay.departure,
      channel: "airbnb",
      status: "confirmed",
      sourceReference: "res-backlog-1",
    },
  });
  return org.id;
}

describe("yaşam döngüsü mesajları — eski rezervasyon 'yeni' sayılmaz (S7-4)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  const futureStay = () => ({ arrival: new Date(Date.now() + 2 * DAY), departure: new Date(Date.now() + 5 * DAY) });

  it("🚨 ilan / bağlantı 1 saat önce geldi, ilk senkronla gelen rezervasyon: karşılama ve giriş mesajı GİTMEZ", async () => {
    const orgId = await seed(1 * HOUR, futureStay());
    expect((await sendDueWelcomes(orgId)).sent).toBe(0);
    expect((await sendDueCheckins(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("🚨 çıkış mesajı da aynı taban: bugün çıkan eski rezervasyon (ilk senkron) mesaj ALMAZ", async () => {
    const today = istToday();
    const orgId = await seed(1 * HOUR, { arrival: new Date(Date.now() - 3 * DAY), departure: new Date(`${today}T00:00:00Z`) });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(`${today}T07:00:00Z`)); // İstanbul 10:00 — çıkış penceresi
    try {
      expect((await sendDueCheckouts(orgId)).sent).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("KONTROL — dairenin gelişinden pay süresi SONRA içe alınan rezervasyon yenidir: karşılama + giriş gider", async () => {
    const orgId = await seed(LIFECYCLE_BACKLOG_GRACE_MS + HOUR, futureStay());
    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
    expect((await sendDueCheckins(orgId)).sent).toBe(1);
  });

  it("KONTROL — eskiden beri var olan daire: anahtar açıldıktan sonra gelen rezervasyon bugünkü gibi mesaj alır", async () => {
    const orgId = await seed(30 * DAY, futureStay());
    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
  });
});
