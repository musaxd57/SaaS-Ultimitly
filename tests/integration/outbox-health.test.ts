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

  it("Opus B6: bekleme yalnız `pending` satırdan, başarısızlık yalnız son 24 saatten sayılır (eski vadeli failed / sent sayılmaz)", async () => {
    const { orgId } = await makeOrgWithProperty();
    const now = new Date();
    const conv = await prisma.conversation.create({ data: { property: { create: { organizationId: orgId, name: "Lale 4" } }, guestIdentifier: "Misafir", channel: "airbnb" } });
    const base = { organizationId: orgId, conversationId: conv.id, channel: "airbnb", body: "x" };
    await prisma.messageOutbox.create({ data: { ...base, idempotencyKey: "p", status: "pending", availableAt: new Date(now.getTime() - 5 * 60_000) } });
    // Vadesi ÇOK eski ama bekleyen değil: bekleme süresine girmez.
    await prisma.messageOutbox.create({ data: { ...base, idempotencyKey: "f-old-due", status: "failed", availableAt: new Date(now.getTime() - 2 * 60 * 60_000) } });
    await prisma.messageOutbox.create({ data: { ...base, idempotencyKey: "s-old-due", status: "sent", availableAt: new Date(now.getTime() - 3 * 60 * 60_000), sentAt: now } });
    const stale = await prisma.messageOutbox.create({ data: { ...base, idempotencyKey: "f-stale", status: "failed" } });
    await prisma.$executeRaw`UPDATE "MessageOutbox" SET "updatedAt" = ${new Date(now.getTime() - 25 * 60 * 60_000)} WHERE "id" = ${stale.id}`;
    const m = (await queueHealth(now)).find((q) => q.queue === "message")!;
    expect(m.oldestDueMs).toBeGreaterThanOrEqual(5 * 60_000 - 1_000);
    expect(m.oldestDueMs).toBeLessThan(6 * 60_000);
    expect(m.failed24h).toBe(1); // yalnız "f-old-due" (bugün yazıldı); 25 saatlik "f-stale" dışarıda
    expect(m.byStatus).toEqual({ pending: 1, failed: 2, sent: 1 });
  });

  it("kimlik e-postası kuyruğu: durum sayıları, vadesi gelmiş en eski bekleyen, son 24 saat başarısızlığı", async () => {
    const now = new Date();
    const { orgId } = await makeOrgWithProperty();
    const user = await prisma.user.create({ data: { organizationId: orgId, name: "Sahip", email: "kuyruk@example.com", passwordHash: "x" } });
    const base = { userId: user.id, payloadEnc: "enc", expiresAt: new Date(now.getTime() + 60 * 60_000) };
    await prisma.emailOutbox.create({ data: { ...base, id: "e1", kind: "verify_email", version: 1, status: "pending", nextAttemptAt: new Date(now.getTime() - 12 * 60_000) } });
    await prisma.emailOutbox.create({ data: { ...base, id: "e2", kind: "pw_reset_code", version: 1, status: "pending", nextAttemptAt: new Date(now.getTime() + 60_000) } });
    await prisma.emailOutbox.create({ data: { ...base, id: "e3", kind: "pw_change_code", version: 1, status: "failed", nextAttemptAt: new Date(now.getTime() - 60 * 60_000) } });
    const e = (await queueHealth(now)).find((q) => q.queue === "email")!;
    expect(e.byStatus).toEqual({ pending: 2, failed: 1 });
    expect(e.oldestDueMs).toBeGreaterThanOrEqual(12 * 60_000 - 1_000);
    expect(e.oldestDueMs).toBeLessThan(13 * 60_000);
    expect(e.failed24h).toBe(1);
    expect(JSON.stringify(e)).not.toContain("kuyruk@example.com");
  });
});
