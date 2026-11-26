// ---------------------------------------------------------------------------
// GM-1 (kurucu 11-26: "gece 3'de gitmesin, 4 gün önceden alınmışsa saat tam 10'da gitmiş olsun").
//
// Giriş bilgisi mesajının penceresi ANLIKTI ("varış ânı ≤ şimdi + 4 gün"). Sağlayıcı tarihi gece yarısı (UTC) sakladığı için pencere
// İstanbul'da gece 03:00'te açılıyor ve mesaj ilk turda (2 dakikada bir) o saatte gidiyordu. Pencere artık GÜNE göre: varıştan 4 gün önceki
// günün işletme saatiyle 10:00'ında açılır. Son dakika rezervasyonu eskisi gibi hemen gider. Kural tek kaynak (`checkin-window.ts`):
// doğrudan gönderici, son talep ve kuyruk işçisi aynı işlevi okur. Saat testte SABİT (kapı günün hangi saatinde koşarsa koşsun aynı).
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";

vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));

import { sendOnChannel } from "@/lib/messaging";
import { sendDueCheckins } from "@/lib/automation";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";
import { createKbWithAutoMessage } from "../helpers/auto-message";

const mockSend = vi.mocked(sendOnChannel);
const midnight = (d: string) => new Date(`${d}T00:00:00.000Z`);

async function seed(timezone: string, arrival: Date, departure: Date) {
  const org = await prisma.organization.create({
    data: { name: "Saat Kuralı Org", timezone, autoCheckin: true, autoCheckinEnabledAt: new Date("2026-01-01T00:00:00Z") },
  });
  const property = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale" } });
  await createKbWithAutoMessage({ data: { propertyId: property.id, category: "checkin", title: "checkin", content: "Giriş bilgisi metni", isActive: true } });
  await prisma.reservation.create({
    data: { propertyId: property.id, guestName: "Ayşe Yılmaz", arrivalDate: arrival, departureDate: departure, channel: "airbnb", status: "confirmed", sourceReference: "res-saat" },
  });
  return org.id;
}

describe("giriş bilgisi mesajı — pencere işletme saatiyle 10:00'da açılır (doğrudan yol)", () => {
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

  it("🚨 İstanbul: varış 21 Haziran → 17 Haziran gece 03:30'da ve 09:59'da GİTMEZ, 10:00'da gider (tek mesaj)", async () => {
    const orgId = await seed("Europe/Istanbul", midnight("2026-06-21"), midnight("2026-06-24"));
    vi.setSystemTime(new Date("2026-06-17T00:30:00Z")); // 03:30 yerel — eski kuralda pencere 03:00'te açılmıştı
    expect((await sendDueCheckins(orgId)).sent).toBe(0);
    vi.setSystemTime(new Date("2026-06-17T06:59:00Z")); // 09:59 yerel
    expect((await sendDueCheckins(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2026-06-17T07:00:00Z")); // 10:00 yerel
    expect((await sendDueCheckins(orgId)).sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-06-17T07:02:00Z"));
    expect((await sendDueCheckins(orgId)).sent).toBe(0); // bir kez
  });

  it("KONTROL (aşırı uygulama yok): son dakika rezervasyonu — varış YARIN — gece 03:30'da da hemen gider", async () => {
    const orgId = await seed("Europe/Istanbul", midnight("2026-06-18"), midnight("2026-06-20"));
    vi.setSystemTime(new Date("2026-06-17T00:30:00Z"));
    expect((await sendDueCheckins(orgId)).sent).toBe(1);
  });

  it("KONTROL: varışa 3 gün kala (pencere dün 10:00'da açıldı) gece de gider — yalnız AÇILIŞ saati kuraldır", async () => {
    const orgId = await seed("Europe/Istanbul", midnight("2026-06-20"), midnight("2026-06-22"));
    vi.setSystemTime(new Date("2026-06-17T00:30:00Z"));
    expect((await sendDueCheckins(orgId)).sent).toBe(1);
  });

  it("varışa 5 gün varken gündüz de gitmez (pencere açılmadı)", async () => {
    const orgId = await seed("Europe/Istanbul", midnight("2026-06-22"), midnight("2026-06-24"));
    vi.setSystemTime(new Date("2026-06-17T12:00:00Z")); // 15:00 yerel
    expect((await sendDueCheckins(orgId)).sent).toBe(0);
  });

  it("New York: varış 21 Haziran → 17 Haziran yerel 09:30'da gitmez, 10:00'da gider", async () => {
    const orgId = await seed("America/New_York", midnight("2026-06-21"), midnight("2026-06-24"));
    vi.setSystemTime(new Date("2026-06-17T13:30:00Z")); // 09:30 EDT
    expect((await sendDueCheckins(orgId)).sent).toBe(0);
    vi.setSystemTime(new Date("2026-06-17T14:00:00Z")); // 10:00 EDT
    expect((await sendDueCheckins(orgId)).sent).toBe(1);
  });
});

describe("giriş bilgisi mesajı — kuyruk işçisi ertelenen satırı 10:00'a kurar", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("🚨 kuyruğa girdikten sonra 4 gün ileri taşınan varış: satır yeni pencerenin açıldığı güne, İstanbul 10:00'a ertelenir (03:00'e değil)", async () => {
    const orgId = await seed("Europe/Istanbul", midnight("2026-06-21"), midnight("2026-06-24"));
    vi.setSystemTime(new Date("2026-06-17T08:00:00Z")); // 11:00 yerel — pencere açık
    expect((await sendDueCheckins(orgId)).sent).toBe(1); // kuyruğa girdi
    await prisma.reservation.updateMany({ where: { sourceReference: "res-saat" }, data: { arrivalDate: midnight("2026-06-25"), departureDate: midnight("2026-06-28") } });
    let posts = 0;
    const send: OutboxSendFn = async () => ({ ok: true, providerMessageId: `p${++posts}` });
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(posts).toBe(0);
    const row = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(row.status).toBe("pending");
    expect(row.availableAt.toISOString()).toBe("2026-06-21T07:00:00.000Z"); // 21 Haziran 10:00 İstanbul
  });
});
