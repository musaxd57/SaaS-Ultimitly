import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { getTopTopics } from "@/lib/reports";
import { CLOSING_COURTESY_INTENT } from "@/lib/ai-intent-markers";

// ---------------------------------------------------------------------------
// Tur 5 (11-05, ölçüldü, çürütücüyle yeniden üretildi): "En Çok Sorulanlar" kartı kapanış nezaket cevabının döngü koruması işaretini
// (`aiIntent = closing_courtesy`) KONU gibi sayıp ham kodla listenin başına koyuyordu: 3 teşekküre giden "Rica ederiz" + 2 Wi-Fi + 1 erken
// giriş → "closing_courtesy 3 · Wi-Fi 2 · Erken giriş 1". Giden yapay zekâ cevaplarının KONUSU bilinçli sayılır (otomatik cevaplanan
// sorunun tek kaydı) — yalnız kod işareti dışarıda. Süzgeç `take`ten ÖNCE: işaret en sıksa bile liste kısalmaz.
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function messagesWithIntents(propertyId: string, intents: string[]) {
  const convo = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "Misafir", status: "answered", lastMessageAt: new Date() } });
  await prisma.message.createMany({
    data: intents.map((aiIntent, i) => ({
      conversationId: convo.id,
      direction: "outbound",
      senderName: "GuestOps AI",
      body: `cevap ${i}`,
      aiIntent,
      createdAt: new Date(Date.now() - (i + 1) * 60_000),
    })),
  });
}

describe("En Çok Sorulanlar — kod işareti konu değildir", () => {
  it("🚨 kapanış nezaket işareti sayılmaz; gerçek konular aynen", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await messagesWithIntents(propertyId, [CLOSING_COURTESY_INTENT, CLOSING_COURTESY_INTENT, CLOSING_COURTESY_INTENT, "wifi", "wifi", "early_checkin"]);
    expect(await getTopTopics(orgId)).toEqual([
      { intent: "wifi", count: 2 },
      { intent: "early_checkin", count: 1 },
    ]);
  });

  it("🚨 işaret en sık olan olsa da liste kısalmaz (süzgeç sınırdan ÖNCE)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await messagesWithIntents(propertyId, [...Array(5).fill(CLOSING_COURTESY_INTENT), "wifi", "wifi", "parking"]);
    expect(await getTopTopics(orgId, 2)).toEqual([
      { intent: "wifi", count: 2 },
      { intent: "parking", count: 1 },
    ]);
  });
});
