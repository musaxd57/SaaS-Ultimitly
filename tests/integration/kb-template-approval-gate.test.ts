import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";

// ---------------------------------------------------------------------------
// KURUCU T4 (10-21, migration 80) — OTOMATİK MESAJ BİLGİ TABANINDAN AYRI. Eskiden (A1, 09-08) karşılama / giriş / çıkış metni bilgi
// tabanının en son onaylı kalemiydi; bu dosya onaylı / legacy / taslak ayrımını pinliyordu. Kurucu: "KB ekleme, düzenleme ve öğrenilen
// taslağı onaylama otomatik mesajlara dokunmasın" → artık metin YALNIZ dairenin "Otomatik mesajlar" kaydından gelir; bilgi tabanı kalemi
// hangi durumda olursa olsun (onaylı, taslak, sonradan düzenlenmiş) gönderilen metni değiştirmez. Boş ya da doldurulamayan metin gönderilmez,
// ev sahibi kartta uyarı görür (son atlama sebebi). PARİTE korunur: önizleme ile gönderici AYNI kaydı ve AYNI kapıyı okur.
// ---------------------------------------------------------------------------

vi.mock("@/lib/messaging", () => ({
  sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: "pm-1" })),
  isDefinitiveSendFailure: () => false,
}));
vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));

import { sendOnChannel } from "@/lib/messaging";
import { previewWelcomes, sendDueWelcomes } from "@/lib/automation";
import { setOrgHospitableToken, resetPrimaryOrgCache } from "@/lib/hospitable-credentials";
import { seedAutoMessage } from "../helpers/auto-message";

const mockSend = vi.mocked(sendOnChannel);
const ORIGINAL_AUTO_REPLY = process.env.AUTO_REPLY_ENABLED;

async function seedArrival(propertyId: string) {
  await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Misafir",
      status: "confirmed",
      channel: "airbnb",
      sourceReference: "res-1",
      arrivalDate: daysFromNow(1),
      departureDate: daysFromNow(3),
    },
  });
}

describe("kurucu T4 — otomatik mesaj yalnız 'Otomatik mesajlar' kaydından (bilgi tabanı değiştirmez)", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    process.env.AUTO_REPLY_ENABLED = "1";
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
    await setOrgHospitableToken(orgId, "pat-1", "Lale");
    await prisma.organization.update({
      where: { id: orgId },
      data: { autoWelcome: true, autoWelcomeEnabledAt: new Date(Date.now() - 60_000) },
    });
    await seedArrival(propertyId);
  });
  afterEach(() => {
    if (ORIGINAL_AUTO_REPLY === undefined) delete process.env.AUTO_REPLY_ENABLED;
    else process.env.AUTO_REPLY_ENABLED = ORIGINAL_AUTO_REPLY;
    resetPrimaryOrgCache();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedKbWelcome(reviewState: string, content: string) {
    await prisma.knowledgeBaseItem.create({
      data: {
        propertyId,
        category: "welcome",
        title: "Karşılama",
        content,
        isActive: true,
        source: reviewState === "draft" ? "extracted_draft" : "host_manual",
        reviewState,
        approvedAt: reviewState === "approved" ? new Date() : null,
      },
    });
  }
  const sentBody = () => String(mockSend.mock.calls[0]?.[1]);

  it("🚨 bilgi tabanında ONAYLI karşılama kalemi var ama otomatik mesaj kaydı YOK → gönderilmez, önizleme 'metin yok' der", async () => {
    await seedKbWelcome("approved", "Hoş geldiniz {isim}.");
    const preview = await previewWelcomes(orgId);
    expect(preview[0]?.hasEntry).toBe(false);
    const res = await sendDueWelcomes(orgId);
    expect(res.sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
    const row = await prisma.reservation.findFirstOrThrow({ where: { propertyId } });
    expect(row.welcomeSentAt).toBeNull();
  });

  it("🚨 otomatik mesaj kaydı gider; bilgi tabanına sonradan eklenen / düzenlenen / onaylanan kalem metni DEĞİŞTİRMEZ", async () => {
    await seedAutoMessage(propertyId, "welcome", "Hoş geldiniz {isim}, kapı kodu 4821.");
    await seedKbWelcome("approved", "YENİ KALEM — kapı kodu 9999.");
    await seedKbWelcome("draft", "TASLAK — kapı kodu 7777.");
    const kb = await prisma.knowledgeBaseItem.findFirstOrThrow({ where: { propertyId, reviewState: "approved" } });
    await prisma.knowledgeBaseItem.update({ where: { id: kb.id }, data: { content: "DÜZENLENDİ — kapı kodu 1111." } });
    const preview = await previewWelcomes(orgId);
    expect(preview[0]?.body).toContain("4821");
    const res = await sendDueWelcomes(orgId);
    expect(res.sent).toBe(1);
    expect(sentBody()).toContain("4821");
    expect(sentBody()).not.toMatch(/9999|7777|1111/);
  });

  it("boş otomatik mesaj GÖNDERİLMEZ (bilgi tabanında kalem olsa da); damga yok → metin yazılınca normal akış", async () => {
    await seedAutoMessage(propertyId, "welcome", "   ");
    await seedKbWelcome("approved", "Hoş geldiniz.");
    expect((await previewWelcomes(orgId))[0]?.hasEntry).toBe(false);
    expect((await sendDueWelcomes(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
    await seedAutoMessage(propertyId, "welcome", "Hoş geldiniz {isim}.");
    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
  });

  it("🚨 doldurulmamış alanlı otomatik mesaj GÖNDERİLMEZ; önizleme sebebi söyler; ev sahibine kartta son atlama sebebi yazılır", async () => {
    await seedAutoMessage(propertyId, "welcome", "Adres: [AÇIK ADRES]");
    const preview = await previewWelcomes(orgId);
    expect(preview[0]).toMatchObject({ hasEntry: true, blocked: "unfilled" });
    const res = await sendDueWelcomes(orgId);
    expect(res).toMatchObject({ sent: 0, unfilled: 1 });
    expect(mockSend).not.toHaveBeenCalled();
    await vi.waitFor(async () => {
      const tpl = await prisma.autoMessageTemplate.findFirstOrThrow({ where: { propertyId, kind: "welcome" } });
      expect(tpl.lastSkipReason).toBe("unfilled");
    });
  });

  it("daire numarası okunamayan mülkte {daire} kullanan mesaj → sebep 'apartment_unresolved'", async () => {
    await seedAutoMessage(propertyId, "welcome", "Daire {daire} sizi bekliyor.");
    const preview = await previewWelcomes(orgId);
    expect(preview[0]).toMatchObject({ hasEntry: true, blocked: "apartment_unresolved" });
    expect((await sendDueWelcomes(orgId)).sent).toBe(0);
    await vi.waitFor(async () => {
      const tpl = await prisma.autoMessageTemplate.findFirstOrThrow({ where: { propertyId, kind: "welcome" } });
      expect(tpl.lastSkipReason).toBe("apartment_unresolved");
    });
  });
});
