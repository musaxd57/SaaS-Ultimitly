// ---------------------------------------------------------------------------
// AaaS "Bugün" ekranı (kurucu 11-13: "olabilir, kontrol ederek görerek yap") — "son 24 saatte sizin yerinize" sayımı (`getAutomationDigest`).
// Yalnız KALICI kayıtlardan; yapay zekâ cevabı Raporlar'la AYNI kuraldan (`aiReplyWhere`) ama yalnız kendiliğinden giden (ev sahibinin
// onayladığı taslak "sizin yerinize" değildir); Girişler'den ELLE gönderilen giriş mesajı düşer; teslim edilmemiş kuyruk satırı düşer;
// pencere dışı ve başka işletme sayılmaz. Raporlar'ın 30 günlük sayısı DEĞİŞMEDİ (aynı yardımcı, `autoOnly` olmadan).
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getAiOpsReport, getAutomationDigest } from "@/lib/reports";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

const HOUR = 3_600_000;
const ago = (h: number) => new Date(Date.now() - h * HOUR);

async function seedOrg() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const c = await prisma.conversation.create({ data: { propertyId, channel: "airbnb", guestIdentifier: "G", status: "answered", priority: "standard" } });
  const msg = (data: { authorType?: string | null; senderName?: string; aiAssisted?: boolean; createdAt?: Date }) =>
    prisma.message.create({ data: { conversationId: c.id, direction: "outbound", body: "x", senderName: "Ayşe", ...data } });
  const resv = (data: Record<string, unknown>) =>
    prisma.reservation.create({
      data: { propertyId, guestName: "Misafir", arrivalDate: daysFromNow(1), departureDate: daysFromNow(3), status: "confirmed", ...data },
    });
  return { orgId, propertyId, conversationId: c.id, msg, resv };
}

describe("son 24 saatte sizin yerinize — sayım", () => {
  it("🚨 yalnız kendiliğinden giden cevap; taslak onayı, ev sahibi cevabı, QR, 24 saatten eski ve teslim edilmemiş kuyruk satırı SAYILMAZ", async () => {
    const o = await seedOrg();
    await o.msg({ authorType: "ai", senderName: "GuestOps AI" }); // kendiliğinden → SAY
    await o.msg({ authorType: null, senderName: "GuestOps AI" }); // eski satır, kendiliğinden → SAY
    await o.msg({ authorType: "host", aiAssisted: true }); // ev sahibinin onayladığı taslak → SAYMA
    await o.msg({ authorType: "host" }); // ev sahibi → SAYMA
    await o.msg({ authorType: "ai", senderName: "GuestOps AI", createdAt: ago(30) }); // pencere dışı → SAYMA
    const queued = await o.msg({ authorType: "ai", senderName: "GuestOps AI" }); // kuyrukta, teslim edilmedi → SAYMA
    await prisma.messageOutbox.create({
      data: { organizationId: o.orgId, conversationId: o.conversationId, messageId: queued.id, channel: "airbnb", body: "x", idempotencyKey: `k-${queued.id}`, status: "pending" },
    });
    const qr = await prisma.conversation.create({ data: { propertyId: o.propertyId, channel: "chat", guestIdentifier: "Q", status: "answered", priority: "standard" } });
    await prisma.message.create({ data: { conversationId: qr.id, direction: "outbound", authorType: "ai", senderName: "Lixus AI", body: "x" } });

    expect((await getAutomationDigest(o.orgId)).aiReplies).toBe(2);
    // Raporlar'ın kuralı değişmedi: taslak onayı DAHİL (30 gün; pencere dışı satır 30 saat önce → dahil).
    expect((await getAiOpsReport(o.orgId)).aiReplies).toBe(4);
  });

  it("🚨 Girişler'den ELLE gönderilen giriş mesajı 'sizin yerinize' sayılmaz; otomatik olan sayılır; karşılama / çıkış / sistem görevi sayılır", async () => {
    const o = await seedOrg();
    const auto = await o.resv({ checkinSentAt: ago(2), sourceReference: "a" });
    const manual = await o.resv({ checkinSentAt: ago(1), sourceReference: "m" });
    const failedManual = await o.resv({ checkinSentAt: ago(1), sourceReference: "f" }); // elle denendi, kesin ret; sonra otomatik gitti
    await o.resv({ checkinSentAt: ago(40), sourceReference: "old" }); // pencere dışı
    await o.resv({ welcomeSentAt: ago(3), checkoutSentAt: ago(4), sourceReference: "w" });
    await prisma.auditLog.create({
      data: { organizationId: o.orgId, action: "checkin_message.manual_send", metadataJson: JSON.stringify({ reservationId: manual.id, outcome: "sent" }) },
    });
    await prisma.auditLog.create({
      data: { organizationId: o.orgId, action: "checkin_message.manual_send", metadataJson: JSON.stringify({ reservationId: failedManual.id, outcome: "definitive" }) },
    });
    await prisma.task.create({ data: { propertyId: o.propertyId, title: "Temizlik", type: "cleaning", origin: "system", status: "todo", priority: "standard" } });
    await prisma.task.create({ data: { propertyId: o.propertyId, title: "Elle", type: "cleaning", origin: "manual", status: "todo", priority: "standard" } });

    const d = await getAutomationDigest(o.orgId);
    expect(d).toEqual({ aiReplies: 0, welcomes: 1, checkins: 2, checkouts: 1, systemTasks: 1 });
    expect(auto.id).toBeTruthy();
  });

  it("başka işletmenin işi sayılmaz; boş hesapta hepsi 0", async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    await b.msg({ authorType: "ai", senderName: "GuestOps AI" });
    await b.resv({ checkinSentAt: ago(1), sourceReference: "b1" });
    expect(await getAutomationDigest(a.orgId)).toEqual({ aiReplies: 0, welcomes: 0, checkins: 0, checkouts: 0, systemTasks: 0 });
  });
});
