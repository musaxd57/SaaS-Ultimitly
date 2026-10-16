import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { queueHealth } from "@/lib/outbox/health";

// Kuyruk sağlığı (10-16, kurucu: "görseldeki sistem tarzında bir sistemimiz var mı"): iki kalıcı kuyruğun durum sayıları, vadesi gelmiş en eski
// bekleyen satırın bekleme süresi ve son 24 saatin kalıcı başarısızlıkları. Salt okuma; metin / alıcı taşımaz.

beforeEach(async () => {
  await resetDb();
});

describe("queueHealth", () => {
  it("boş kuyruk: sayı yok, bekleyen yok", async () => {
    const h = await queueHealth(new Date());
    expect(h).toEqual([
      { queue: "message", byStatus: {}, oldestDueMs: null, failed24h: 0 },
      { queue: "email", byStatus: {}, oldestDueMs: null, failed24h: 0 },
    ]);
  });

  it("vadesi gelmiş en eski bekleyen satır; vadesi gelmemiş satır bekleme sayılmaz; son 24 saat başarısızlığı; metin yanıta girmez", async () => {
    const { orgId } = await makeOrgWithProperty();
    const now = new Date();
    const conv = await prisma.conversation.create({ data: { property: { create: { organizationId: orgId, name: "Lale 2" } }, guestIdentifier: "Misafir", channel: "airbnb" } });
    const base = { organizationId: orgId, conversationId: conv.id, channel: "airbnb", body: "Merhaba, gizli metin" };
    await prisma.messageOutbox.create({ data: { ...base, idempotencyKey: "a", status: "pending", availableAt: new Date(now.getTime() - 30 * 60_000) } });
    await prisma.messageOutbox.create({ data: { ...base, idempotencyKey: "b", status: "pending", availableAt: new Date(now.getTime() + 30 * 60_000) } });
    await prisma.messageOutbox.create({ data: { ...base, idempotencyKey: "c", status: "failed" } });
    await prisma.messageOutbox.create({ data: { ...base, idempotencyKey: "d", status: "sent", sentAt: now } });
    const h = await queueHealth(now);
    const m = h.find((q) => q.queue === "message")!;
    expect(m.byStatus).toEqual({ pending: 2, failed: 1, sent: 1 });
    expect(m.oldestDueMs).toBeGreaterThanOrEqual(30 * 60_000 - 1_000);
    expect(m.oldestDueMs).toBeLessThan(31 * 60_000);
    expect(m.failed24h).toBe(1);
    expect(JSON.stringify(h)).not.toContain("gizli");
  });

  it("yalnız vadesi GELMEMİŞ bekleyen satır varsa bekleme yok (backoff'taki satır yoklayıcı gecikmesi değildir)", async () => {
    const { orgId } = await makeOrgWithProperty();
    const now = new Date();
    const conv = await prisma.conversation.create({ data: { property: { create: { organizationId: orgId, name: "Lale 3" } }, guestIdentifier: "Misafir", channel: "airbnb" } });
    await prisma.messageOutbox.create({
      data: { organizationId: orgId, conversationId: conv.id, channel: "airbnb", body: "x", idempotencyKey: "e", status: "pending", availableAt: new Date(now.getTime() + 60_000) },
    });
    expect((await queueHealth(now)).find((q) => q.queue === "message")!.oldestDueMs).toBeNull();
  });
});
