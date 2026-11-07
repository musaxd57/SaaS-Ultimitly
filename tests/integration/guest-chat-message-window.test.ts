import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { generateChatToken, GUEST_CHAT_MESSAGE_WINDOW } from "@/lib/guest-chat";
import { __resetRateLimit } from "@/lib/rate-limit";

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn() }));
import { GET } from "@/app/api/chat/[token]/route";

// ---------------------------------------------------------------------------
// 🚨 MİSAFİR SOHBETİ MESAJ PENCERESİ (dış denetim 09-18, bulgu 4).
//
// ÖLÇÜLEN KUSUR: bu uç mesajları `take` OLMADAN çekiyordu ve istemci 5 saniyede
// bir çağırıyor — yani konuşmanın TAMAMI dakikada 12 kez hem sorgulanıyor hem
// tel üzerinden taşınıyordu. Ölçülen maliyet bant genişliğinden ÖTE: poll başına
// ~6 DB turu, biri YAZMA (hız-limiti sayacı).
//
// 🚨 CURSOR DEĞİL PENCERE: `createdAt` üzerinde cursor GÜVENSİZ (QR yolu misafir
// ve bot satırını aynı/1 ms damgayla yazıyor, eski satırlarda damgalar EŞİT) ve
// istemci listeyi toptan değiştirdiği için pencere sunucuda TEK BAŞINA yeter.
// Aynı desen host tarafındaki `guest-chats/[id]` sayfasında zaten yazılı.
// ---------------------------------------------------------------------------

const ORIGINAL_ENV = process.env.GUEST_CHAT_ENABLED;

async function enableChat(propertyId: string) {
  const token = generateChatToken();
  await prisma.property.update({ where: { id: propertyId }, data: { chatToken: token, chatEnabled: true } });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Misafir",
      arrivalDate: daysFromNow(-1),
      departureDate: daysFromNow(2),
      status: "confirmed",
      channel: "airbnb",
    },
  });
  return { token, reservationId: reservation.id };
}

function getReq(token: string) {
  const req = new Request(`http://localhost/api/chat/${token}`, {
    method: "GET",
    headers: { "x-forwarded-for": "203.0.113.31" },
  });
  return GET(req as never, { params: Promise.resolve({ token }) });
}

/** Konuşmayı `n` mesajla doldurur; gövdeler sıralanabilir olsun diye numaralı. */
async function seedMessages(propertyId: string, reservationId: string, n: number) {
  const convo = await prisma.conversation.create({
    data: {
      propertyId,
      guestIdentifier: `g-${reservationId}`,
      externalReservationId: `qr-chat:${propertyId}:${reservationId}`,
      status: "answered",
      lastMessageAt: new Date(),
    },
  });
  const base = Date.now() - n * 60_000;
  await prisma.message.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      conversationId: convo.id,
      direction: i % 2 === 0 ? "inbound" : "outbound",
      authorType: i % 2 === 0 ? "guest" : "ai",
      senderName: i % 2 === 0 ? "Misafir" : "Lixus AI",
      body: `mesaj-${String(i).padStart(4, "0")}`,
      createdAt: new Date(base + i * 60_000),
    })),
  });
  return convo.id;
}

describe("GET /api/chat/[token] — mesaj penceresi", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    process.env.GUEST_CHAT_ENABLED = "1";
  });
  afterAll(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.GUEST_CHAT_ENABLED;
    else process.env.GUEST_CHAT_ENABLED = ORIGINAL_ENV;
  });

  it("🚨 uzun konuşmada YALNIZ en yeni pencere döner (tavansız değil)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const { token, reservationId } = await enableChat(propertyId);
    const total = GUEST_CHAT_MESSAGE_WINDOW + 40;
    await seedMessages(propertyId, reservationId, total);

    const out = (await (await getReq(token)).json()) as { messages: { text: string }[] };
    expect(out.messages).toHaveLength(GUEST_CHAT_MESSAGE_WINDOW);
    // EN YENİLER döner — en eski 40 mesaj pencerenin dışında kalır.
    expect(out.messages.at(-1)!.text).toBe(`mesaj-${String(total - 1).padStart(4, "0")}`);
    expect(out.messages[0].text).toBe(`mesaj-${String(total - GUEST_CHAT_MESSAGE_WINDOW).padStart(4, "0")}`);
    expect(JSON.stringify(out), "pencere dışındaki en eski mesaj sızmamalı").not.toContain("mesaj-0000");
  });

  it("🚨 SIRA KRONOLOJİK KALIR (pencere `desc` çekip geri çevirir)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const { token, reservationId } = await enableChat(propertyId);
    await seedMessages(propertyId, reservationId, 6);

    const out = (await (await getReq(token)).json()) as { messages: { text: string }[] };
    expect(out.messages.map((m) => m.text)).toEqual([
      "mesaj-0000",
      "mesaj-0001",
      "mesaj-0002",
      "mesaj-0003",
      "mesaj-0004",
      "mesaj-0005",
    ]);
  });

  it("pencerenin ALTINDAKİ konuşma BİREBİR eski davranış (sessiz daralma yok)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const { token, reservationId } = await enableChat(propertyId);
    await seedMessages(propertyId, reservationId, GUEST_CHAT_MESSAGE_WINDOW);

    const out = (await (await getReq(token)).json()) as { messages: unknown[] };
    expect(out.messages).toHaveLength(GUEST_CHAT_MESSAGE_WINDOW);
  });
});
