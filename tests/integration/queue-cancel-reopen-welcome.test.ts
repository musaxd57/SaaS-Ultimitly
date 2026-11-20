import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { createKbWithAutoMessage } from "../helpers/auto-message";
import { stayDay } from "../helpers/stay-dates";

// ---------------------------------------------------------------------------
// KUYRUK YOLU (G1 tur 3 bulgusu) — otomatik mesaj zinciri: İPTAL SONRASI YENİDEN AÇMA (konu 6).
//
// Kalıcı kuyruk açıkken karşılama satırı kuyrukta beklerken rezervasyon iptal edilir → işçi satırı `reservation_cancelled` ile İPTAL eder
// (kalıcı). Ev sahibi rezervasyonu "Gerçekten etkin — yeniden aç" ile geri açar (`reopenCancelledReservation`; kanal son 3 günde etkin
// göstermiş). Gönderici yeniden aday görür ama kuyruğa veremez: anahtar `welcome:<işletme>:<rezervasyon>` iptal satırında duruyor →
// `enqueueProactive` "zaten var" der, ön eleme (`lifecycleUnusableIds`, kuyruk açık: aynı anahtarlı, `pending` olmayan satır) adayı
// her geçişte düşürür. Misafire karşılama HİÇ gitmez. Kuyruk KAPALIYKEN aynı akış (satır yok) mesajı gönderir (kontrol).
// D1'de (onaylı → bekliyor) aynı tuzak bilerek önlenmişti ("satır iptal edilseydi rezervasyon başına tek anahtar mesajı kalıcı yutardı");
// iptal → yeniden açma yolu bu korumanın dışında.
// DÜZELTİLDİ (11-20, `reservations/reopen.ts`): yeniden açma, YALNIZ `reservation_cancelled` ile iptal edilmiş yaşam döngüsü satırlarını
// bekleyen yapar (gönderim anı vetosunda sağlayıcıya hiç gitmeden iptal edildiler); işçi gönderim anında bütün kuralları yeniden uygular.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/messaging", async (orig) => ({ ...(await orig<typeof import("@/lib/messaging")>()), sendOnChannel: vi.fn() }));

import { sendOnChannel } from "@/lib/messaging";
import { sendDueWelcomes } from "@/lib/automation";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";
import { reopenCancelledReservation } from "@/lib/reservations/reopen";
import { REACTIVATION_BLOCKED_FIELD } from "@/lib/ingest/reactivation";

const REF = "res-reopen-1";

async function seed() {
  const org = await prisma.organization.create({
    data: { name: "Org", autoWelcome: true, autoWelcomeEnabledAt: new Date(0), aiSignature: "Lale", autoReplyHospitable: true },
  });
  const owner = await prisma.user.create({ data: { organizationId: org.id, name: "Sahip", email: `s-${org.id}@x.test`, passwordHash: "x", role: "owner" } });
  const property = await prisma.property.create({ data: { createdAt: PROPERTY_EXISTED_BEFORE, organizationId: org.id, name: "Lale 3" } });
  await createKbWithAutoMessage({ data: { propertyId: property.id, category: "welcome", title: "K", content: "Merhaba {isim}, hoş geldiniz." } });
  const r = await prisma.reservation.create({
    data: { propertyId: property.id, guestName: "Bircan", arrivalDate: stayDay(3), departureDate: stayDay(5), channel: "airbnb", status: "confirmed", sourceReference: REF },
  });
  return { orgId: org.id, ownerId: owner.id, reservationId: r.id };
}

/** Kanal rezervasyonu yeniden etkin gösterdi (satır iptal tutuldu) — yeniden açmanın şartı (`reopen.ts`). */
async function channelShowedActive(orgId: string, reservationId: string) {
  await prisma.ingestEvent.create({
    data: { organizationId: orgId, provider: "hospitable", entityType: "reservation", entityId: reservationId, kind: "reservation.updated", changedFieldsJson: JSON.stringify([REACTIVATION_BLOCKED_FIELD]) },
  });
}

describe("kuyruk yolu — iptal → yeniden açma sonrası karşılama", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.mocked(sendOnChannel).mockResolvedValue({ ok: true, providerMessageId: "d1" } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("KONTROL (yeşil): kuyruk KAPALI — iptal edilip yeniden açılan rezervasyona karşılama gider", async () => {
    const s = await seed();
    await prisma.reservation.update({ where: { id: s.reservationId }, data: { status: "cancelled" } });
    expect((await sendDueWelcomes(s.orgId)).sent).toBe(0);
    await channelShowedActive(s.orgId, s.reservationId);
    expect(await reopenCancelledReservation({ organizationId: s.orgId, actorUserId: s.ownerId, reservationId: s.reservationId, via: "panel" })).toEqual({ ok: true });
    expect((await sendDueWelcomes(s.orgId)).sent).toBe(1);
    expect(vi.mocked(sendOnChannel)).toHaveBeenCalledTimes(1);
  });

  it("🚨 kuyruk AÇIK — satır iptal sırasında kuyrukta iptal edildi; yeniden açılınca karşılama gider (kuyruk kapalıyken olduğu gibi)", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    const s = await seed();
    expect((await sendDueWelcomes(s.orgId)).sent).toBe(1); // kuyruğa girdi
    await prisma.reservation.update({ where: { id: s.reservationId }, data: { status: "cancelled" } });
    const sends: string[] = [];
    const send: OutboxSendFn = async (row) => {
      sends.push(row.id);
      return { ok: true, providerMessageId: `p${sends.length}` };
    };
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: s.orgId } })).status).toBe("canceled");

    await channelShowedActive(s.orgId, s.reservationId);
    expect(await reopenCancelledReservation({ organizationId: s.orgId, actorUserId: s.ownerId, reservationId: s.reservationId, via: "panel" })).toEqual({ ok: true });
    // Gönderici + işçi birkaç geçiş.
    for (let i = 0; i < 3; i++) {
      await sendDueWelcomes(s.orgId);
      await drainOutboxOnce({ send, tokenFor: async () => "t" });
    }
    const welcomeSentAt = (await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } })).welcomeSentAt;
    // Beklenen (kuyruk kapalıyken olduğu gibi): yeniden açılan misafire karşılama gider. Gerçek: 0 gönderim, damga boş.
    expect({ sends: sends.length, stamped: welcomeSentAt !== null }).toEqual({ sends: 1, stamped: true });
  });
});

describe("kuyruğa verme YALNIZ rezervasyon durumu yüzünden iptal edilmiş yaşam döngüsü satırını diriltir (aşırı uygulama yok)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
  });
  afterEach(() => vi.unstubAllEnvs());

  /** Kuyrukta, verilen iptal sebebiyle duran karşılama satırı (yaşam döngüsü satırının yerel mesajı yoktur). */
  async function canceledWelcome(orgId: string, reservationId: string, code: string) {
    return prisma.messageOutbox.create({
      data: {
        organizationId: orgId,
        conversationId: null,
        messageId: null,
        reservationId,
        channel: "airbnb",
        externalReservationId: REF,
        messageType: "welcome",
        body: "Eski metin",
        idempotencyKey: `welcome:${orgId}:${REF}`,
        status: "canceled",
        lastErrorKind: "canceled",
        lastErrorCode: code,
      },
    });
  }

  it.each([["reservation_cancelled"], ["reservation_gone"]])(
    "🚨 '%s' ile iptal edilmiş karşılama, rezervasyon yeniden gönderilebilir olunca BEKLEYEN olur ve gider (silinip geri gelen kayıt dahil)",
    async (code) => {
      const s = await seed();
      const row = await canceledWelcome(s.orgId, s.reservationId, code);
      expect((await sendDueWelcomes(s.orgId)).sent).toBe(1);
      expect(await prisma.messageOutbox.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
        status: "pending",
        lastErrorCode: null,
        body: "Merhaba Bircan, hoş geldiniz.",
        reservationId: s.reservationId,
      });
      const sends: string[] = [];
      await drainOutboxOnce({
        send: async (r) => {
          sends.push(r.id);
          return { ok: true, providerMessageId: "p1" };
        },
        tokenFor: async () => "t",
      });
      expect(sends).toEqual([row.id]);
      // İkinci geçiş ikinci kez göndermez (damga + gönderildi).
      expect((await sendDueWelcomes(s.orgId)).sent).toBe(0);
    },
  );

  it.each([["lifecycle_disabled"], ["erased"], ["window_passed"]])(
    "KONTROL: '%s' ile iptal edilmiş karşılama DİRİLMEZ (gönderici yine 'zaten var' der)",
    async (code) => {
      const s = await seed();
      const row = await canceledWelcome(s.orgId, s.reservationId, code);
      expect((await sendDueWelcomes(s.orgId)).sent).toBe(0);
      expect(await prisma.messageOutbox.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "canceled", lastErrorCode: code });
    },
  );

  it("KONTROL: rezervasyon hâlâ iptalken satır DİRİLMEZ (gönderici iptal rezervasyonu aday yapmaz)", async () => {
    const s = await seed();
    await prisma.reservation.update({ where: { id: s.reservationId }, data: { status: "cancelled" } });
    const row = await canceledWelcome(s.orgId, s.reservationId, "reservation_cancelled");
    expect((await sendDueWelcomes(s.orgId)).sent).toBe(0);
    expect(await prisma.messageOutbox.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "canceled" });
  });
});
