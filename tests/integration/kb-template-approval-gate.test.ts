import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";

// ---------------------------------------------------------------------------
// A1 — ONAYSIZ ŞABLON MİSAFİRE GÖNDERİLMEZ (09-08).
//
// `fetchKnowledgeBaseForPrompt` kapısı yalnız MODELE giden yolu kapatır. Ama
// karşılama / giriş / çıkış şablonları modelden GEÇMEZ: içerikleri misafire
// AYNEN gönderilir (`buildGuestMessageBody`). Yani onay kapısı oraya
// konmasaydı, kurucunun "host onayından önce aktifleşmesin" şartı ürünün en
// doğrudan yüzeyinde açık kalırdı — çıkarılmış bir taslak, host hiç görmeden
// misafirin telefonuna düşerdi.
//
// PARİTE ŞART: gönderici ile ÖNİZLEME aynı fragmenti kullanır
// (`GUEST_DELIVERABLE_KB_WHERE`). Ayrışsalardı host önizlemede "gönderilecek"
// görüp gerçekte gönderilmeyen (ya da tersi) bir şablonla karşılaşırdı.
//
// Bugün taslak ÜRETEN bir yol yok (A5 henüz yazılmadı) → bu test canlı davranışı
// DEĞİŞTİRMEZ, gelecekteki kaçışı kapatır.
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

describe("A1 — onaysız şablon gönderilmez (gönderici ↔ önizleme paritesi)", () => {
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

  async function seedWelcome(reviewState: string) {
    await prisma.knowledgeBaseItem.create({
      data: {
        propertyId,
        category: "welcome",
        title: "Karşılama",
        content: "Hoş geldiniz {isim}.",
        isActive: true,
        source: reviewState === "draft" ? "extracted_draft" : "host_manual",
        reviewState,
        approvedAt: reviewState === "approved" ? new Date() : null,
      },
    });
  }

  it("ONAYLI karşılama şablonu gönderilir (davranış korunur)", async () => {
    await seedWelcome("approved");
    const preview = await previewWelcomes(orgId);
    expect(preview[0]?.hasEntry).toBe(true);
    const res = await sendDueWelcomes(orgId);
    expect(res.sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("LEGACY (sözleşme öncesi) şablon gönderilmeye DEVAM eder", async () => {
    await seedWelcome("legacy");
    const preview = await previewWelcomes(orgId);
    expect(preview[0]?.hasEntry).toBe(true);
    const res = await sendDueWelcomes(orgId);
    expect(res.sent).toBe(1);
  });

  it("TASLAK şablon GÖNDERİLMEZ ve önizleme de 'şablon yok' der (parite)", async () => {
    await seedWelcome("draft");
    const preview = await previewWelcomes(orgId);
    // Host önizlemede taslağı "gönderilecek" diye GÖRMEZ.
    expect(preview[0]?.hasEntry).toBe(false);
    const res = await sendDueWelcomes(orgId);
    expect(res.sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
    // Rezervasyon damgalanmaz → şablon onaylanınca normal akış devam eder.
    const row = await prisma.reservation.findFirstOrThrow({ where: { propertyId } });
    expect(row.welcomeSentAt).toBeNull();
  });

  it("taslak varken ONAYLI ikinci şablon varsa onaylı olan gider", async () => {
    await seedWelcome("approved");
    await seedWelcome("draft");
    const res = await sendDueWelcomes(orgId);
    expect(res.sent).toBe(1);
    // `sendOnChannel(target, body, token)` — gövde ikinci argüman.
    expect(String(mockSend.mock.calls[0]?.[1])).toContain("Hoş geldiniz");
  });
});
