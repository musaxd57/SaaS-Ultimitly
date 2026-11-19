// ---------------------------------------------------------------------------
// G1 TUR 2 YENİDEN ÜRETME — B2 DÜZELTMESİNİN TERS SINAMASI (`sendCheckinNow`, dev/gates `cec3c7d1`).
//
// Yeni hüküm: `released = live === null || (live.dispatchStartedAt === null && (canceled || cancelRequestedAt))`. Ama "dış gönderim başladı"
// işareti bir ÖNCEKİ denemeden kalabilir: işçi isteği attı, sağlayıcı kesin reddetti / 429 dedi → satır geri çekilmeyle `pending`e döner ve
// işaret TEMİZLENMEZ (yalnız bir sonraki talep sıfırlar — `claimBatchLocked` CASE). Bu bekleme sırasında rezervasyon iki dairede kayıtlı
// hâle gelirse (örn. ilan yeniden eşlendi) ev sahibi Girişler'den gönderir: `requestOutboxCancel` bekleyen satırı İPTAL EDER, ama eski işaret
// yüzünden `released = false` → `existingCheckinOutboxVerdict` → satır `canceled` → "queue_owns" ("zaten gönderim sırasında"). Satır iptal,
// doğrudan gönderim yapılmadı → misafire giriş bilgisi hiç gitmez. Düzeltmeden önceki sayım hükmü bu durumda `canceled = 1, dispatching = 0`
// görüp doğrudan gönderiyordu (gerileme).
// Satır durumu GERÇEK işçiyle kurulur (sağlayıcı 422 → geri çekilme), elle yazılmaz.
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
import { previewCheckinNow, sendCheckinNow } from "@/lib/automation";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";
import { createKbWithAutoMessage } from "../helpers/auto-message";

const mockSend = vi.mocked(sendOnChannel);
const DAY = 86_400_000;

async function seed() {
  const org = await prisma.organization.create({
    data: { name: "Org", timezone: "Europe/Istanbul", autoCheckin: true, autoCheckinEnabledAt: new Date(Date.now() - 30 * DAY), aiSignature: "Lale" },
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
  return { orgId: org.id, ownerId: owner.id, p2Id: p2.id, ref, arrivalDate, departureDate, reservationId: r1.id, revision: tpl.revision, rowId: row.id };
}

describe("(G1 11-19 T2-B4) elle giriş gönderimi — önceki denemeden kalan gönderim işareti 'uçuşta' sayılmaz", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    mockSend.mockResolvedValue({ ok: true, providerMessageId: "p1" } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 sağlayıcı reddedip beklemeye dönen satır + sonradan iki daire → satır iptal, mesaj doğrudan yoldan GİDER (eski: 'zaten gönderim sırasında', hiçbir şey gitmiyordu)", async () => {
    const s = await seed();
    // 1) Gerçek işçi isteği atar, sağlayıcı kesin reddeder (422) → satır geri çekilmeyle bekleyene döner, işaret kalır.
    const attempts: string[] = [];
    const reject: OutboxSendFn = async (row) => {
      attempts.push(row.id);
      return { ok: false, error: 'Hospitable API hatası (HTTP 422): {"message":"rejected"}', providerMessageId: null, kind: "definitive_failure" };
    };
    await drainOutboxOnce({ send: reject, tokenFor: async () => "test-token" });
    expect(attempts).toHaveLength(1);
    const afterReject = await prisma.messageOutbox.findUniqueOrThrow({ where: { id: s.rowId } });
    expect(afterReject.status).toBe("pending");
    expect(afterReject.dispatchStartedAt).not.toBeNull(); // önceki denemenin işareti duruyor
    expect(afterReject.availableAt.getTime()).toBeGreaterThan(Date.now()); // geri çekilme

    // 2) Bu arada rezervasyon ikinci dairede de kaydedildi (ilan yeniden eşlendi).
    await prisma.reservation.create({
      data: { propertyId: s.p2Id, guestName: "Ayşe Yılmaz", arrivalDate: s.arrivalDate, departureDate: s.departureDate, channel: "airbnb", status: "confirmed", sourceReference: s.ref },
    });

    // 3) Ev sahibi Girişler'den doğru dairenin satırından "Gönder"e basar.
    const p = await previewCheckinNow(s.orgId, s.reservationId);
    expect(p.ok).toBe(true);
    const result = await sendCheckinNow({ organizationId: s.orgId, reservationId: s.reservationId, revision: s.revision, digest: p.ok ? p.digest : "", actorUserId: s.ownerId });
    const after = await prisma.messageOutbox.findUniqueOrThrow({ where: { id: s.rowId } });

    // Beklenen (düzeltmeden önceki davranış da buydu): satır iptal + mesaj doğrudan gider. Gerçek: queue_owns + satır iptal + 0 gönderim.
    expect({ result, rowStatus: after.status, directSends: mockSend.mock.calls.length }).toEqual({
      result: { ok: true, kind: "sent" },
      rowStatus: "canceled",
      directSends: 1,
    });
  });
});
