import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { enqueueOutbound, enqueueProactive } from "@/lib/outbox/enqueue";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";

// ---------------------------------------------------------------------------
// Y5 (10-14 dış inceleme): GENEL KAPATMA (`AUTO_REPLY_ENABLED` "1" değil) kuyruktaki OTOMATİK mesajı da durdurur.
// Eskiden anahtar yalnız kuyruğa girişte okunuyordu; kalıcı kuyruk açıkken bekleyen yapay zekâ cevabı ve karşılama mesajı
// anahtar kapatıldıktan sonra yine gidiyordu. Sözleşme:
//  · otomatik satır (ai / holding_ack / welcome / checkin / checkout) TALEP EDİLMEZ — iptal de edilmez, deneme sayısı artmaz;
//  · elle yazılan ev sahibi cevabı ("manual") etkilenmez ve aynı konuşmadaki bekleyen otomatik satırın ARKASINDA tıkanmaz;
//  · anahtar açılınca bekleyen otomatik satır normal işlenir (kontrol).
// ---------------------------------------------------------------------------

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const conversation = await prisma.conversation.create({
    data: {
      propertyId,
      channel: "airbnb",
      guestIdentifier: "Ayşe",
      status: "new",
      externalReservationId: "res-ks",
      lastMessageAt: new Date(Date.now() - 60_000),
      messages: { create: [{ direction: "inbound", senderName: "Ayşe", body: "Wifi?", createdAt: new Date(Date.now() - 60_000) }] },
    },
  });
  return { orgId, propertyId, conversationId: conversation.id };
}

const enqueue = (orgId: string, conversationId: string, author: "host" | "ai", key: string) =>
  enqueueOutbound({
    organizationId: orgId,
    conversationId,
    channel: "airbnb",
    externalReservationId: "res-ks",
    reservationId: null,
    body: author === "host" ? "Merhaba, hemen bakıyorum." : "Wi-Fi bilgisi kartta.",
    senderName: author === "host" ? "Host" : "Lixus AI",
    authorType: author,
    messageType: author === "host" ? "manual" : "ai",
    idempotencyKey: key,
  });

function counter() {
  const sent: string[] = [];
  const send: OutboxSendFn = async (row) => {
    sent.push(row.messageType ?? "null");
    return { ok: true, providerMessageId: `p${sent.length}` };
  };
  return { send, sent };
}

describe("Y5 — genel kapatma kuyruktaki otomatik mesajı durdurur", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(async () => {
    await resetDb();
  });

  it("🚨 anahtar KAPALI: yapay zekâ cevabı İPTAL (sonra da gitmez); karşılama POST EDİLMEZ ve bekler (deneme sayısı 0)", async () => {
    vi.stubEnv("AUTO_REPLY_ENABLED", "0");
    const { orgId, propertyId, conversationId } = await seed();
    const reservation = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Burak",
        arrivalDate: new Date(Date.now() + 2 * 86_400_000),
        departureDate: new Date(Date.now() + 4 * 86_400_000),
        channel: "airbnb",
        status: "confirmed",
        sourceReference: "res-welcome",
      },
    });
    await enqueue(orgId, conversationId, "ai", "ai-1");
    await enqueueProactive({
      organizationId: orgId,
      reservationId: reservation.id,
      externalReservationId: "res-welcome",
      channel: "airbnb",
      messageType: "welcome",
      body: "Hoş geldiniz",
      idempotencyKey: "welcome-1",
    });
    const { send, sent } = counter();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(sent).toEqual([]);
    const ai = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId, messageType: "ai" } });
    expect(ai.status).toBe("canceled");
    expect(ai.lastErrorCode).toBe("auto_reply_disabled");
    const welcome = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId, messageType: "welcome" } });
    expect(welcome.status).toBe("pending");
    expect(welcome.attemptCount).toBe(0);

    // Anahtar açıldı: bayat yapay zekâ cevabı GİTMEZ (iptal), karşılama gider.
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(sent).toEqual(["welcome"]);
  });

  it("🚨 anahtar KAPALI: elle yazılan cevap gider ve aynı konuşmadaki bekleyen yapay zekâ satırının ARKASINDA tıkanmaz", async () => {
    vi.stubEnv("AUTO_REPLY_ENABLED", "0");
    const { orgId, conversationId } = await seed();
    await enqueue(orgId, conversationId, "ai", "ai-1");
    await enqueue(orgId, conversationId, "host", "host-1");
    const { send, sent } = counter();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(sent).toEqual(["manual"]);
  });

  it("KONTROL: anahtar AÇIK → aynı satırlar gider", async () => {
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    const { orgId, conversationId } = await seed();
    await enqueue(orgId, conversationId, "ai", "ai-1");
    const { send, sent } = counter();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(sent).toEqual(["ai"]);
  });

});
