import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { subMonths } from "date-fns";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// Misafir sözü saklaması AYRI saatlik iş (10-10 gece, Haiku KVKK incelemesi): eskiden konuşma öğesi süpürgesiyle AYNI blokta,
// ondan sonra koşuyordu — öğe süpürgesi patlarsa söz süpürgesi o geçişte hiç koşmuyordu (kalıcı arızada hiç). Bu dosya BAĞLANTIYI
// sınar: öğe süpürgesi fırlatsa da söz süpürgesi koşar ve kendi alarm anahtarı temiz kalır.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable", () => ({
  isHospitableConfigured: () => true,
  listProperties: vi.fn().mockResolvedValue([]),
  listReservations: vi.fn().mockResolvedValue([]),
  listMessages: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })),
}));
vi.mock("@/lib/conversation-items/store", async (orig) => ({
  ...(await orig<typeof import("@/lib/conversation-items/store")>()),
  purgeExpiredConversationItems: vi.fn(async () => {
    throw new Error("öğe süpürgesi arızası (test)");
  }),
}));

import { runScheduledSync } from "@/lib/scheduled-sync";
import { purgeExpiredConversationItems } from "@/lib/conversation-items/store";

describe("runScheduledSync × misafir sözü saklaması", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("🚨 konuşma öğesi süpürgesi fırlatsa da süresi dolmuş söz silinir; yeni söz kalır", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const conversation = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "g", channel: "airbnb" } });
    const old = await prisma.guestCommitment.create({
      data: { organizationId: orgId, conversationId: conversation.id, kind: "towels", dueAt: subMonths(new Date(), 30), createdAt: subMonths(new Date(), 30) },
    });
    const fresh = await prisma.guestCommitment.create({
      data: { organizationId: orgId, conversationId: conversation.id, kind: "cleaning", dueAt: new Date(Date.now() + 86_400_000) },
    });

    expect((await runScheduledSync()).ok).toBe(true);
    expect(vi.mocked(purgeExpiredConversationItems)).toHaveBeenCalled(); // saatlik blok gerçekten koştu
    expect(await prisma.guestCommitment.count({ where: { id: old.id } })).toBe(0);
    expect(await prisma.guestCommitment.count({ where: { id: fresh.id } })).toBe(1);
  });
});
