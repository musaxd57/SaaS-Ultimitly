import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { seedAutoMessage } from "../helpers/auto-message";

// ---------------------------------------------------------------------------
// KURUCU T4 (10-21) — KUYRUK KAPALI YOL, SEÇİM → TALEP YARIŞI: gönderici metni okuduktan sonra ev sahibi metni değiştirir / boşaltırsa eski
// metin GİTMEZ (talep işlemi içinde sürüm yeniden okunur — `autoMessageStillAt`). Yarışı kurmak için okuma ESKİ sürümü döndürür (modül
// taklidi bütün dosyayı etkiler → ayrı dosya); veritabanında metin o an güncel sürümdedir.
// ---------------------------------------------------------------------------

const stale = vi.hoisted(() => ({
  value: null as null | { id: string; revision: number; content: string },
  /** Okumanın hemen ardından çalışan kanca (yarışı kurmak için: ör. silme işlemi gövdeyi `[ANON]` yapar). */
  onLoad: null as null | (() => Promise<void>),
}));
vi.mock("@/lib/auto-messages/store", async (orig) => {
  const actual = await orig<typeof import("@/lib/auto-messages/store")>();
  return {
    ...actual,
    loadAutoMessage: vi.fn(async (...args: Parameters<typeof actual.loadAutoMessage>) => {
      const out = stale.value ?? (await actual.loadAutoMessage(...args));
      if (stale.onLoad) await stale.onLoad();
      return out;
    }),
  };
});
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: "pm-1" })),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { sendDueWelcomes } from "@/lib/automation";
import { sendOnChannel } from "@/lib/messaging";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";
import { ANON_BODY } from "@/lib/data-retention";

const mockSend = vi.mocked(sendOnChannel);

async function seed() {
  const org = await prisma.organization.create({ data: { name: "Org", autoWelcome: true, autoWelcomeEnabledAt: new Date(0) } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 3" } });
  const arrival = new Date(Date.now() + 3 * 86_400_000);
  await prisma.reservation.create({
    data: {
      propertyId: property.id, guestName: "Bircan", arrivalDate: arrival, departureDate: new Date(arrival.getTime() + 2 * 86_400_000),
      channel: "airbnb", status: "confirmed", sourceReference: "res-1",
    },
  });
  return { orgId: org.id, propertyId: property.id };
}

describe("kurucu T4 — kuyruk kapalı: seçimden sonra değişen metin", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    stale.value = null;
    stale.onLoad = null;
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 okunan sürüm eskidi (ev sahibi arada kaydetti) → bu geçişte GÖNDERİLMEZ, damga yok; sonraki geçiş güncel metni gönderir", async () => {
    const { orgId, propertyId } = await seed();
    const v1 = await seedAutoMessage(propertyId, "welcome", "Eski kod 4821");
    await seedAutoMessage(propertyId, "welcome", "Yeni kod 7310");
    stale.value = { id: v1.id, revision: v1.revision, content: "Eski kod 4821" };
    const first = await sendDueWelcomes(orgId);
    expect(first.sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "res-1" } })).welcomeSentAt).toBeNull();

    stale.value = null;
    expect((await sendDueWelcomes(orgId)).sent).toBe(1);
    expect(String(mockSend.mock.calls[0]?.[1])).toContain("7310");
  });

  it("🚨 okunduktan sonra metin BOŞALTILDI → gönderilmez", async () => {
    const { orgId, propertyId } = await seed();
    const v1 = await seedAutoMessage(propertyId, "welcome", "Kod 4821");
    await prisma.autoMessageTemplate.update({ where: { id: v1.id }, data: { body: "" } });
    stale.value = { id: v1.id, revision: v1.revision, content: "Kod 4821" };
    expect((await sendDueWelcomes(orgId)).sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("🚨 kalıcı kuyruk: işçi metni yeniden kurarken misafir SİLİNDİ (gövde [ANON]) → yeniden kurma silinmiş gövdenin üstüne yazmaz, satır iptal", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    const { orgId, propertyId } = await seed();
    await seedAutoMessage(propertyId, "welcome", "Merhaba {isim}, kod 4821.");
    await sendDueWelcomes(orgId);
    await seedAutoMessage(propertyId, "welcome", "Merhaba {isim}, kod 7310."); // sürüm farkı → işçi yeniden kuracak
    stale.onLoad = async () => {
      await prisma.messageOutbox.updateMany({ where: { organizationId: orgId }, data: { body: ANON_BODY } });
    };
    const bodies: string[] = [];
    const send: OutboxSendFn = async (row) => {
      bodies.push(row.body);
      return { ok: true, providerMessageId: "p1" };
    };
    const res = await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(bodies).toEqual([]);
    expect(res.canceled).toBe(1);
    const row = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(row).toMatchObject({ status: "canceled", body: ANON_BODY });
  });

  it("🚨 kalıcı kuyruk: yeniden kurma sırasında talep BAŞKA işçiye geçti → bu işçi ne yazar ne gönderir", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    const { orgId, propertyId } = await seed();
    await seedAutoMessage(propertyId, "welcome", "Merhaba {isim}, kod 4821.");
    await sendDueWelcomes(orgId);
    await seedAutoMessage(propertyId, "welcome", "Merhaba {isim}, kod 7310.");
    stale.onLoad = async () => {
      await prisma.messageOutbox.updateMany({ where: { organizationId: orgId }, data: { claimedBy: "baska-isci" } });
    };
    const bodies: string[] = [];
    const send: OutboxSendFn = async (row) => {
      bodies.push(row.body);
      return { ok: true, providerMessageId: "p1" };
    };
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(bodies).toEqual([]);
    const row = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(row.body).toContain("4821"); // kaybeden işçi gövdeye dokunmadı
    expect(row.claimedBy).toBe("baska-isci");
  });
});
