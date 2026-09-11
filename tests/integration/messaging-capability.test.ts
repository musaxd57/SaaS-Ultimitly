import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";

// ---------------------------------------------------------------------------
// V0.5 — mesajlaşma yeteneği DAVRANIŞSAL: önizleme == gerçek (aynı fikstürde
// `previewWelcomes` ile `sendDueWelcomes` AYNI kümeyi seçer), dışarıda kalanlar
// (iCal/elle/feed-bağlı/referanssız) iki yüzeyde de dışarıda; env fallback org
// (DB token'ı yok, PRIMARY_ORG_ID + HOSPITABLE_API_TOKEN) gönderir (V0.3/V0.7
// arası korunan yol); QR iç thread'i kanal oto-yanıt önizlemesine girmez.
// ---------------------------------------------------------------------------

vi.mock("@/lib/messaging", () => ({
  sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: "pm-1" })),
  isDefinitiveSendFailure: () => false,
}));
vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));

import { sendOnChannel } from "@/lib/messaging";
import { previewWelcomes, sendDueWelcomes, previewChannelAutoReplies } from "@/lib/automation";
import { setOrgHospitableToken, resetPrimaryOrgCache } from "@/lib/hospitable-credentials";

const mockSend = vi.mocked(sendOnChannel);
const ORIGINAL_ENV = {
  AUTO_REPLY_ENABLED: process.env.AUTO_REPLY_ENABLED,
  PRIMARY_ORG_ID: process.env.PRIMARY_ORG_ID,
  HOSPITABLE_API_TOKEN: process.env.HOSPITABLE_API_TOKEN,
  DURABLE_OUTBOX_ENABLED: process.env.DURABLE_OUTBOX_ENABLED,
};
function restoreEnv() {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetPrimaryOrgCache();
}

/** Beş satır: yalnız `hosp` sağlayıcı üzerinden mesajlanabilir. */
async function seedFixtures(propertyId: string) {
  const source = await prisma.calendarSource.create({
    data: { propertyId, label: "Airbnb", url: "https://example.com/f.ics" },
  });
  const base = {
    propertyId,
    status: "confirmed",
    arrivalDate: daysFromNow(3),
    departureDate: daysFromNow(6),
  };
  const mk = (guestName: string, extra: Record<string, unknown>) =>
    prisma.reservation.create({ data: { ...base, guestName, ...extra } as never });
  await mk("Hosp", { sourceReference: "hosp-1", channel: "airbnb", calendarSourceId: null });
  await mk("Ics", { sourceReference: "ics-1", channel: "ics", calendarSourceId: null });
  await mk("Csv", { sourceReference: "csv-1", channel: "manual", calendarSourceId: null });
  await mk("Feed", { sourceReference: "feed-1", channel: "airbnb", calendarSourceId: source.id });
  await mk("NoRef", { sourceReference: null, channel: "airbnb", calendarSourceId: null });
  await prisma.knowledgeBaseItem.create({
    data: { propertyId, category: "welcome", title: "Karşılama", content: "Hoş geldiniz!", isActive: true },
  });
}

async function enableWelcome(orgId: string) {
  await prisma.organization.update({
    where: { id: orgId },
    data: { autoWelcome: true, autoWelcomeEnabledAt: new Date(Date.now() - 60_000) },
  });
}

describe("V0.5 messaging capability — davranışsal", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    restoreEnv();
    process.env.AUTO_REPLY_ENABLED = "1";
    delete process.env.DURABLE_OUTBOX_ENABLED;
  });
  afterEach(restoreEnv);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("önizleme == gerçek: aynı fikstürde previewWelcomes ve sendDueWelcomes yalnız sağlayıcı satırını seçer", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await setOrgHospitableToken(orgId, "pat-1", "Lale");
    await enableWelcome(orgId);
    await seedFixtures(propertyId);

    const preview = await previewWelcomes(orgId);
    expect(preview.map((p) => p.guest).sort()).toEqual(["Hosp"]);

    const sent = await sendDueWelcomes(orgId);
    expect(sent.sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const stamped = await prisma.reservation.findMany({ where: { propertyId, welcomeSentAt: { not: null } }, select: { guestName: true } });
    expect(stamped.map((r) => r.guestName)).toEqual(["Hosp"]);
  });

  it("env fallback org (DB token yok): yetenek korunur, gönderim olur", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    process.env.PRIMARY_ORG_ID = orgId;
    process.env.HOSPITABLE_API_TOKEN = "env-token";
    resetPrimaryOrgCache();
    await enableWelcome(orgId);
    await seedFixtures(propertyId);

    expect((await previewWelcomes(orgId)).map((p) => p.guest)).toEqual(["Hosp"]);
    const sent = await sendDueWelcomes(orgId);
    expect(sent.sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][2]).toBe("env-token"); // kimlik env'den çözüldü
  });

  it("bağlantısız org (token yok, env yok): önizleme listeler ama gönderim YOK (bugünkü davranış — kapı kimlik çözümünde)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    delete process.env.HOSPITABLE_API_TOKEN;
    process.env.PRIMARY_ORG_ID = "another-org";
    resetPrimaryOrgCache();
    await enableWelcome(orgId);
    await seedFixtures(propertyId);

    expect((await previewWelcomes(orgId)).map((p) => p.guest)).toEqual(["Hosp"]);
    const sent = await sendDueWelcomes(orgId);
    expect(sent).toEqual({ sent: 0, considered: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("QR iç thread'i kanal oto-yanıt önizlemesine girmez; sağlayıcı thread'i girer", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await setOrgHospitableToken(orgId, "pat-1", "Lale");
    const mk = (externalReservationId: string, channel: string) =>
      prisma.conversation.create({
        data: {
          propertyId,
          channel,
          guestIdentifier: "Misafir",
          status: "new",
          externalReservationId,
          messages: { create: { direction: "inbound", authorType: "guest", senderName: "Misafir", body: "Merhaba?" } },
        },
      });
    await mk(`qr-chat:${propertyId}:r1`, "chat");
    await mk("6f1c-hosp-uuid", "airbnb");

    const preview = await previewChannelAutoReplies(orgId);
    const ids = preview.map((p) => (p as { externalReservationId?: string | null; guest?: string }).externalReservationId ?? "?");
    expect(preview.length).toBe(1);
    expect(JSON.stringify(preview)).not.toContain("qr-chat:");
    expect(ids.length).toBe(1);
  });
});
