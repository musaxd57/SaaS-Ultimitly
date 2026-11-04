import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { drainOutboxOnce } from "@/lib/outbox/worker";

// ---------------------------------------------------------------------------
// Codex 11-04 P1 — kuyrukta bekleyen YAPAY ZEKÂ cevabı, rezervasyon kuyruğa girdikten SONRA iptal edildiyse ya da konaklama bittiyse gönderim
// anında İPTAL edilir (üretimdeki `applyChannelAutoReply` kontrolünün eşi). Eskiden gönderim anı vetosu yalnız konuşmayı / yeni mesajları
// okuyordu: iptal edilen misafire (içinde giriş bilgisi olabilecek) eski cevap gidiyordu. Bağlı rezervasyonu olmayan konuşma geçer.
// ---------------------------------------------------------------------------

async function seedQueuedAiReply(opts: { reservation: "confirmed" | "cancelled-later" | "ended" | "none" }) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  // Gönderim anı vetosunun ÖNCEKİ katmanları (genel / işletme yapay zekâ anahtarı) açık — sınanan yalnız rezervasyon kuralı.
  await prisma.organization.update({ where: { id: orgId }, data: { autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0 } });
  const reservation =
    opts.reservation === "none"
      ? null
      : await prisma.reservation.create({
          data: {
            propertyId,
            guestName: "Deniz",
            arrivalDate: opts.reservation === "ended" ? daysFromNow(-6) : daysFromNow(-1),
            departureDate: opts.reservation === "ended" ? daysFromNow(-3) : daysFromNow(3),
            status: "confirmed",
            channel: "airbnb",
            sourceReference: "res-veto",
          },
        });
  const conv = await prisma.conversation.create({
    data: {
      propertyId,
      channel: "airbnb",
      guestIdentifier: "Deniz",
      status: "answered",
      externalReservationId: "res-veto",
      reservationId: reservation?.id ?? null,
      messages: {
        create: [{ direction: "inbound", authorType: "guest", senderName: "Deniz", body: "Kapı kodu neydi?", createdAt: new Date(Date.now() - 120_000) }],
      },
    },
  });
  const msg = await prisma.message.create({
    data: { conversationId: conv.id, direction: "outbound", authorType: "ai", senderName: "GuestOps AI", body: "Kapı kodu 4471#.", createdAt: new Date(Date.now() - 60_000) },
  });
  const row = await prisma.messageOutbox.create({
    data: {
      availableAt: new Date(),
      organizationId: orgId,
      conversationId: conv.id,
      messageId: msg.id,
      channel: "airbnb",
      externalReservationId: "res-veto",
      messageType: "ai",
      body: "Kapı kodu 4471#.",
      idempotencyKey: `ai-veto-${conv.id}`,
      status: "pending",
    },
  });
  if (opts.reservation === "cancelled-later") {
    // Ev sahibi kuyruğa girişten SONRA iptal etti (PATCH /api/reservations/[id]).
    await prisma.reservation.update({ where: { id: reservation!.id }, data: { status: "cancelled" } });
  }
  return { row };
}

const drain = () => {
  const send = vi.fn().mockResolvedValue({ ok: true, providerMessageId: "pm-1" });
  return drainOutboxOnce({ send, reconcile: vi.fn().mockResolvedValue({ found: false }), tokenFor: async () => "t" }).then(() => send);
};
const rowOf = (id: string) => prisma.messageOutbox.findUniqueOrThrow({ where: { id } });

describe("kuyruktaki yapay zekâ cevabı — rezervasyon gönderim anında yeniden okunur", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 rezervasyon kuyruğa girdikten SONRA iptal edildi → sağlayıcıya HİÇBİR ŞEY gitmez, satır iptal (reservation_cancelled)", async () => {
    const { row } = await seedQueuedAiReply({ reservation: "cancelled-later" });
    const send = await drain();
    expect(send).not.toHaveBeenCalled();
    expect(await rowOf(row.id)).toMatchObject({ status: "canceled", lastErrorCode: "reservation_cancelled" });
  });

  it("🚨 konaklama bitti (çıkış günü geçti) → gitmez (reservation_ended)", async () => {
    const { row } = await seedQueuedAiReply({ reservation: "ended" });
    const send = await drain();
    expect(send).not.toHaveBeenCalled();
    expect(await rowOf(row.id)).toMatchObject({ status: "canceled", lastErrorCode: "reservation_ended" });
  });

  it("KONTROL: onaylı ve süren konaklama → bir kez gönderilir", async () => {
    const { row } = await seedQueuedAiReply({ reservation: "confirmed" });
    const send = await drain();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await rowOf(row.id)).status).toBe("sent");
  });

  it("KONTROL: bağlı rezervasyonu OLMAYAN konuşma (rezervasyon öncesi soru) bugünkü gibi gönderilir", async () => {
    const { row } = await seedQueuedAiReply({ reservation: "none" });
    const send = await drain();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await rowOf(row.id)).status).toBe("sent");
  });
});
