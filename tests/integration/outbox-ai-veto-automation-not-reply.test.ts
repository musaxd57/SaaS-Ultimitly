import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { drainOutboxOnce } from "@/lib/outbox/worker";

// ---------------------------------------------------------------------------
// Tur 7 T7-OB-1 (kurucu onayı 11-05, adım 1) — kuyruktaki yapay zekâ cevabının gönderim anı vetosu "daha yeni mesaj"ı ürünün "cevap mı"
// kuralıyla sayar. Eskiden yazar süzgeci yoktu: teslim bir geçiş gecikince (hız sınırı, 429, bağlantı park, teslim duraklatma) arada
// gelen BİZİM otomatik giriş mesajımız satırı "superseded" yapıyordu → misafirin sorusu hiç cevaplanmıyordu. Ev sahibinin cevabı ve
// misafirin yeni mesajı eskisi gibi durdurur.
// ---------------------------------------------------------------------------

async function seed(newer: { direction: "inbound" | "outbound"; authorType: string; body?: string } | null) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await prisma.organization.update({ where: { id: orgId }, data: { autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0 } });
  const conv = await prisma.conversation.create({
    data: {
      propertyId,
      channel: "airbnb",
      guestIdentifier: "Deniz",
      status: "answered",
      externalReservationId: "res-ob1",
      messages: {
        create: [{ direction: "inbound", authorType: "guest", senderName: "Deniz", body: "Otopark var mı?", createdAt: new Date(Date.now() - 180_000) }],
      },
    },
  });
  const ai = await prisma.message.create({
    data: { conversationId: conv.id, direction: "outbound", authorType: "ai", senderName: "GuestOps AI", body: "Evet, binanın önünde ücretsiz otopark var.", createdAt: new Date(Date.now() - 120_000) },
  });
  if (newer) {
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: newer.direction,
        authorType: newer.authorType,
        senderName: newer.authorType === "guest" ? "Deniz" : "Ev sahibi",
        body: newer.body ?? "Bugün girişiniz 15:00'te. Kapı kodu ayrıca iletilecek.",
        createdAt: new Date(Date.now() - 60_000),
      },
    });
  }
  const row = await prisma.messageOutbox.create({
    data: {
      availableAt: new Date(),
      organizationId: orgId,
      conversationId: conv.id,
      messageId: ai.id,
      channel: "airbnb",
      externalReservationId: "res-ob1",
      messageType: "ai",
      body: ai.body,
      idempotencyKey: `ai-ob1-${conv.id}`,
      status: "pending",
    },
  });
  return { row };
}

const send = vi.fn();
const drain = () => drainOutboxOnce({ send, reconcile: vi.fn().mockResolvedValue({ found: false }), tokenFor: async () => "t" });
const rowOf = (id: string) => prisma.messageOutbox.findUniqueOrThrow({ where: { id } });

describe("kuyruktaki yapay zekâ cevabı — otomatik mesaj cevap sayılmaz (T7-OB-1)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    send.mockReset();
    send.mockResolvedValue({ ok: true, providerMessageId: "pm-ob1" });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 arada gelen otomatik giriş mesajımız: misafir cevabı BİR KEZ alır (iki geçişte tek gönderim)", async () => {
    const { row } = await seed({ direction: "outbound", authorType: "automation" });
    await drain();
    await drain();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ body: expect.stringContaining("ücretsiz otopark") });
    expect((await rowOf(row.id)).status).toBe("sent");
  });

  it("🚨 arada yazılan sistem olayı da cevap değildir → gönderilir", async () => {
    const { row } = await seed({ direction: "outbound", authorType: "system", body: "Lixus AI yeniden etkinleştirildi" });
    await drain();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await rowOf(row.id)).status).toBe("sent");
  });

  for (const c of [
    { name: "ev sahibinin elle cevabı", newer: { direction: "outbound" as const, authorType: "host" } },
    { name: "misafirin yeni mesajı", newer: { direction: "inbound" as const, authorType: "guest", body: "Bir de havlu lazım." } },
  ]) {
    it(`KONTROL — ${c.name} bayat cevabı eskisi gibi durdurur (gönderim yok)`, async () => {
      const { row } = await seed(c.newer);
      await drain();
      expect(send).not.toHaveBeenCalled();
      const r = await rowOf(row.id);
      expect(r.status).toBe("canceled");
      expect(r.lastErrorCode).toBe("superseded_by_newer_message");
    });
  }

  it("KONTROL — arada mesaj yoksa gönderilir", async () => {
    const { row } = await seed(null);
    await drain();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await rowOf(row.id)).status).toBe("sent");
  });
});
