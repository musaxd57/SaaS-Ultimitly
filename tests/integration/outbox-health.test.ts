import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn() }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: reportErrorMock };
});
import { checkQueueStall, queueHealth, QUEUE_STALL_MS } from "@/lib/outbox/health";
import { alertTracker } from "@/lib/alert-state";

// Kuyruk sağlığı (10-16, kurucu: "görseldeki sistem tarzında bir sistemimiz var mı"): iki kalıcı kuyruğun durum sayıları, vadesi gelmiş en eski
// bekleyen satırın bekleme süresi ve son 24 saatin kalıcı başarısızlıkları. Salt okuma; metin / alıcı taşımaz.

beforeEach(async () => {
  await resetDb();
});

describe("queueHealth", () => {
  it("boş kuyruk: sayı yok, bekleyen yok", async () => {
    const h = await queueHealth(new Date());
    expect(h).toEqual([
      { queue: "message", byStatus: {}, oldestDueMs: null, failed24h: 0, review24h: 0 },
      { queue: "email", byStatus: {}, oldestDueMs: null, failed24h: 0, review24h: null },
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
    // İnceleme (doğrulanamadı): bugün düşen sayılır, 25 saat önce düşen sayılmaz.
    await prisma.messageOutbox.create({ data: { ...base, idempotencyKey: "r-today", status: "review" } });
    const oldReview = await prisma.messageOutbox.create({ data: { ...base, idempotencyKey: "r-stale", status: "review" } });
    await prisma.$executeRaw`UPDATE "MessageOutbox" SET "updatedAt" = ${new Date(now.getTime() - 25 * 60 * 60_000)} WHERE "id" = ${oldReview.id}`;
    const m = (await queueHealth(now)).find((q) => q.queue === "message")!;
    expect(m.oldestDueMs).toBeGreaterThanOrEqual(5 * 60_000 - 1_000);
    expect(m.oldestDueMs).toBeLessThan(6 * 60_000);
    expect(m.failed24h).toBe(1); // yalnız "f-old-due" (bugün yazıldı); 25 saatlik "f-stale" dışarıda
    expect(m.review24h).toBe(1);
    expect(m.byStatus).toEqual({ pending: 1, failed: 2, sent: 1, review: 2 });
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
    expect(e.review24h).toBeNull();
    expect(JSON.stringify(e)).not.toContain("kuyruk@example.com");
  });
});

// Kurucu 10-16 O3-A: kuyruk ilerlemiyorsa GEÇİŞ TABANLI alarm — bir kez e-posta, sürerken sessiz, düzelince temizlenir, yeniden takılınca
// yeniden alarm. Alarm `reportError` (doğrudan sağlayıcı) → kimlik e-postası kuyruğundan GEÇMEZ.
describe("checkQueueStall (O3-A)", () => {
  beforeEach(() => {
    reportErrorMock.mockReset();
    reportErrorMock.mockResolvedValue({ notified: true, throttled: false, configured: true });
  });
  const stalls = () => reportErrorMock.mock.calls.filter(([context]) => String(context).startsWith("Kuyruk ilerlemiyor"));

  it("15 dk'dır bekleyen satır → bir alarm; sonraki geçişler sessiz; satır gidince temizlenir; yeniden takılınca yeniden alarm", async () => {
    const { orgId } = await makeOrgWithProperty();
    const row = await prisma.messageOutbox.create({
      data: { organizationId: orgId, channel: "airbnb", body: "gizli metin", idempotencyKey: "a", status: "pending", availableAt: new Date(Date.now() - QUEUE_STALL_MS - 60_000) },
    });
    await checkQueueStall(await alertTracker("scheduled-sync:"));
    await checkQueueStall(await alertTracker("scheduled-sync:"));
    expect(stalls()).toHaveLength(1);
    expect(stalls()[0][0]).toBe("Kuyruk ilerlemiyor (misafir mesajı)");
    const [, err] = stalls()[0];
    expect((err as Error).name).toBe("QueueStalled");
    expect(String((err as Error).message)).not.toContain("gizli");
    // Satır gönderildi (20 dk önce — yeni takılmanın "son 15 dk'da ilerleme yok" şartını sağlasın).
    await prisma.messageOutbox.update({ where: { id: row.id }, data: { status: "sent", sentAt: new Date(Date.now() - 20 * 60_000) } });
    await checkQueueStall(await alertTracker("scheduled-sync:"));
    expect(await prisma.systemLock.count({ where: { name: { startsWith: "alert-state:scheduled-sync:queue-stalled" } } })).toBe(0);
    await prisma.messageOutbox.create({
      data: { organizationId: orgId, channel: "airbnb", body: "x", idempotencyKey: "b", status: "pending", availableAt: new Date(Date.now() - QUEUE_STALL_MS - 60_000) },
    });
    await checkQueueStall(await alertTracker("scheduled-sync:"));
    expect(stalls()).toHaveLength(2);
  });

  it("14 dk bekleyen satır ve boş kuyruk alarm üretmez", async () => {
    const { orgId } = await makeOrgWithProperty();
    await checkQueueStall(await alertTracker("scheduled-sync:"));
    await prisma.messageOutbox.create({
      data: { organizationId: orgId, channel: "airbnb", body: "x", idempotencyKey: "a", status: "pending", availableAt: new Date(Date.now() - QUEUE_STALL_MS + 60_000) },
    });
    await checkQueueStall(await alertTracker("scheduled-sync:"));
    expect(stalls()).toHaveLength(0);
  });

  it("Haiku 10-16: işçinin seçmeyeceği satır sahte alarm vermez — konuşma sırasında bekleyen satır ve anahtar kapalıyken otomatik şablon", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const conv = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "Misafir", channel: "airbnb" } });
    const old = new Date(Date.now() - QUEUE_STALL_MS - 60_000);
    // Önceki satır yeniden deneme beklemesinde (vadesi ileride); sonraki satır vadesi gelmiş ama konuşma sırasında bekliyor.
    await prisma.messageOutbox.create({
      data: { organizationId: orgId, conversationId: conv.id, channel: "airbnb", body: "1", idempotencyKey: "a", status: "pending", availableAt: new Date(Date.now() + 20 * 60_000), createdAt: new Date(Date.now() - 40 * 60_000) },
    });
    await prisma.messageOutbox.create({
      data: { organizationId: orgId, conversationId: conv.id, channel: "airbnb", body: "2", idempotencyKey: "b", status: "pending", availableAt: old, createdAt: new Date(Date.now() - 30 * 60_000) },
    });
    // Genel otomatik mesaj anahtarı kapalı: karşılama şablonu bilerek bekler.
    await prisma.messageOutbox.create({
      data: { organizationId: orgId, channel: "airbnb", body: "hoş geldiniz", idempotencyKey: "c", status: "pending", availableAt: old, messageType: "welcome" },
    });
    vi.stubEnv("AUTO_REPLY_ENABLED", "");
    try {
      await checkQueueStall(await alertTracker("scheduled-sync:"));
      expect(stalls()).toHaveLength(0);
      // Anahtar açıksa karşılama şablonu da işçinin işidir → 15 dk bekleyip ilerlemiyorsa alarm.
      vi.stubEnv("AUTO_REPLY_ENABLED", "1");
      await checkQueueStall(await alertTracker("scheduled-sync:"));
      expect(stalls()).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("Haiku 10-16 ikinci tur: işçinin talep kuralıyla aynı — anahtar kapalıyken bekleyen OTOMATİK önceki satır elle cevabı tutmaz (sayılır); uzlaştırma bekleyen satır da sayılır", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const conv = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "Misafir", channel: "airbnb" } });
    const old = new Date(Date.now() - QUEUE_STALL_MS - 60_000);
    await prisma.messageOutbox.create({
      data: { organizationId: orgId, conversationId: conv.id, channel: "airbnb", body: "ai", idempotencyKey: "a", status: "pending", messageType: "ai", availableAt: new Date(Date.now() + 20 * 60_000), createdAt: new Date(Date.now() - 40 * 60_000) },
    });
    await prisma.messageOutbox.create({
      data: { organizationId: orgId, conversationId: conv.id, channel: "airbnb", body: "elle", idempotencyKey: "b", status: "pending", messageType: "manual", availableAt: old, createdAt: new Date(Date.now() - 30 * 60_000) },
    });
    vi.stubEnv("AUTO_REPLY_ENABLED", "");
    try {
      await checkQueueStall(await alertTracker("scheduled-sync:"));
      expect(stalls()).toHaveLength(1); // elle cevap işçinin alacağı satır → 15 dk ilerlemiyorsa alarm
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("Haiku 10-16 ikinci tur: uzlaştırma bekleyen (ambiguous) satır 15 dk ilerlemiyorsa alarm", async () => {
    const { orgId } = await makeOrgWithProperty();
    await prisma.messageOutbox.create({
      data: { organizationId: orgId, channel: "airbnb", body: "x", idempotencyKey: "amb", status: "ambiguous", availableAt: new Date(Date.now() - QUEUE_STALL_MS - 60_000) },
    });
    await checkQueueStall(await alertTracker("scheduled-sync:"));
    expect(stalls()).toHaveLength(1);
  });

  it("Haiku 10-16: büyük birikim İLERLİYORSA (son 15 dk'da sahiplenme / gönderim) alarm yok", async () => {
    const { orgId } = await makeOrgWithProperty();
    await prisma.messageOutbox.create({
      data: { organizationId: orgId, channel: "airbnb", body: "x", idempotencyKey: "old", status: "pending", availableAt: new Date(Date.now() - QUEUE_STALL_MS - 60_000) },
    });
    await prisma.messageOutbox.create({
      data: { organizationId: orgId, channel: "airbnb", body: "y", idempotencyKey: "sent", status: "sent", sentAt: new Date(Date.now() - 2 * 60_000), claimedAt: new Date(Date.now() - 2 * 60_000) },
    });
    await checkQueueStall(await alertTracker("scheduled-sync:"));
    expect(stalls()).toHaveLength(0);
  });

  it("iki kuyruk ayrı anahtar: e-posta kuyruğu takılınca kendi alarmı", async () => {
    const { orgId } = await makeOrgWithProperty();
    const user = await prisma.user.create({ data: { organizationId: orgId, name: "Sahip", email: "o3a@example.com", passwordHash: "x" } });
    await prisma.emailOutbox.create({
      data: { id: "e1", userId: user.id, kind: "verify_email", version: 1, payloadEnc: "enc", status: "pending", nextAttemptAt: new Date(Date.now() - QUEUE_STALL_MS - 60_000), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    await checkQueueStall(await alertTracker("scheduled-sync:"));
    expect(stalls()).toHaveLength(1);
    expect((stalls()[0][1] as { code?: string }).code).toBe("email");
    // Ayrı başlık (Haiku 10-16; yaşayan mutant O3d): e-posta kısıtı başlık başına — iki kuyruk aynı başlığı paylaşırsa biri ötekini geciktirir.
    expect(stalls()[0][0]).toBe("Kuyruk ilerlemiyor (kimlik e-postası)");
    expect(String((stalls()[0][1] as Error).message)).not.toContain("o3a@example.com");
  });
});
