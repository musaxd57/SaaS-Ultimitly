// ---------------------------------------------------------------------------
// G1 YENİDEN ÜRETME (hata ayıklama turu 11-19) — YARIŞ: "iki dairede kayıtlı" rezervasyonda Girişler'den elle giriş mesajı gönderimi
// (`sendCheckinNow` → `requestOutboxCancel`) ile kuyruk işçisinin AYNI satırı tutup ertelemesi (her 20 dakikada bir) çakışırsa.
//
// `requestOutboxCancel` üç ayrı adım: (1) iptal isteği yaz, (2) talepsiz satırları iptal et, (3) say. İşçi satırı (1) sırasında ELİNDE
// tutuyorsa istek yazılır; işçi satırı (2) ile (3) ARASINDA ertelerse (bekleyene geri bırakır) sayım `requested = 0, canceled = 0` görür →
// `released = false` → "zaten var olan satır" hükmüne düşülür: satır bekleyen + vadesi ileride + hata bilgisi boş → vadesi öne çekilir →
// ev sahibine "sıraya alındı" (ok: true, queued) denir. Oysa satır iptal İSTEĞİ taşır: bir sonraki geçişin temizliği onu iptal eder; mesaj
// hiçbir yoldan gitmez.
//
// Araya girme gerçek işçiyle kurulur: işçi satırı talep eder ve belirteç okumasında bekletilir; (2)'den sonraki sayım çağrısında işçi
// serbest bırakılıp bitmesi beklenir. Sayım casusu özgün işlevi bağlayarak kurulur (temsilci Proxy'dir).
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
  getConnectionInfo: vi.fn().mockResolvedValue({ connected: true }),
}));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { sendOnChannel } from "@/lib/messaging";
import { getConnectionInfo, getOrgHospitableToken } from "@/lib/hospitable-credentials";
import { previewCheckinNow, sendCheckinNow } from "@/lib/automation";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";
import { createKbWithAutoMessage } from "../helpers/auto-message";

const mockSend = vi.mocked(sendOnChannel);
const DAY = 86_400_000;

async function seedTwoProperties() {
  const org = await prisma.organization.create({
    data: { name: "Org", timezone: "Europe/Istanbul", autoCheckin: true, autoCheckinEnabledAt: new Date(Date.now() - 30 * DAY) },
  });
  const owner = await prisma.user.create({ data: { organizationId: org.id, name: "Sahip", email: `sahip-${org.id}@example.test`, passwordHash: "x", role: "owner" } });
  const p1 = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 1" } });
  const p2 = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 2" } });
  await createKbWithAutoMessage({ data: { propertyId: p1.id, category: "checkin", title: "Giriş", content: "Kapı kodumuz 4821.", isActive: true } });
  await createKbWithAutoMessage({ data: { propertyId: p2.id, category: "checkin", title: "Giriş", content: "Kapı kodumuz 9999.", isActive: true } });
  const ref = `res-${org.id}`;
  const arrivalDate = new Date(Date.now() + 1 * DAY);
  const departureDate = new Date(Date.now() + 4 * DAY);
  const r1 = await prisma.reservation.create({
    data: { propertyId: p1.id, guestName: "Ayşe Yılmaz", arrivalDate, departureDate, channel: "airbnb", status: "confirmed", sourceReference: ref },
  });
  await prisma.reservation.create({
    data: { propertyId: p2.id, guestName: "Ayşe Yılmaz", arrivalDate, departureDate, channel: "airbnb", status: "confirmed", sourceReference: ref },
  });
  // Kuyrukta (anahtar açıkken) bu rezervasyonun tutulan giriş satırı; işçinin 20 dakikalık yeniden bakışı GELDİ (vade şimdi).
  const row = await prisma.messageOutbox.create({
    data: {
      organizationId: org.id,
      reservationId: r1.id,
      channel: "airbnb",
      externalReservationId: ref,
      messageType: "checkin",
      body: "x",
      idempotencyKey: `checkin:${org.id}:${ref}`,
      status: "pending",
      availableAt: new Date(Date.now() - 1_000),
    },
  });
  const tpl = await prisma.autoMessageTemplate.findUniqueOrThrow({ where: { propertyId_kind: { propertyId: p1.id, kind: "checkin" } } });
  return { orgId: org.id, ownerId: owner.id, reservationId: r1.id, revision: tpl.revision, rowId: row.id };
}

describe("(G1 11-19) sendCheckinNow — gönderimi başlamış satır iptal isteği taşısa da serbest sayılmaz", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    mockSend.mockResolvedValue({ ok: true, providerMessageId: "p1" } as never);
    // Önceki testin `vi.restoreAllMocks()`ı fabrika taklitlerinin dönüşünü de siler → belirteç yoksa sonuç "no_connection" olur ve test
    // ölçmek istediği hükmü HİÇ sınamadan yeşil kalır (mutasyon 11-19 bunu gösterdi). Her testten önce yeniden kurulur.
    vi.mocked(getOrgHospitableToken).mockResolvedValue("test-token" as never);
    vi.mocked(getConnectionInfo).mockResolvedValue({ connected: true } as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("🚨 gönderimi BAŞLAMIŞ satır iptal isteği taşısa da 'serbest' sayılmaz: doğrudan yoldan İKİNCİ mesaj gitmez (mutasyon 11-19)", async () => {
    const s = await seedTwoProperties();
    const p = await previewCheckinNow(s.orgId, s.reservationId);
    const digest = p.ok ? p.digest : "";
    // İstek sağlayıcıya çıkmış, sonuç belirsiz; satırda (önceden yazılmış) iptal isteği de var.
    await prisma.messageOutbox.update({
      where: { id: s.rowId },
      data: { status: "ambiguous", dispatchStartedAt: new Date(), cancelRequestedAt: new Date(), cancelReason: "conversation_deleted" },
    });
    const result = await sendCheckinNow({ organizationId: s.orgId, reservationId: s.reservationId, revision: s.revision, digest, actorUserId: s.ownerId });
    // Hüküm kuyruğa bırakır ("zaten gönderim sırasında") — bağlantı / belirteç eksikliği gibi BAŞKA bir sebeple durmuş olmamalı.
    expect(result).toEqual({ ok: false, kind: "queue_owns" });
    expect(mockSend).not.toHaveBeenCalled();
  });
});
