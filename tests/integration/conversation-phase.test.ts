import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { loadConversationPhase } from "@/lib/operator-replies";

// ---------------------------------------------------------------------------
// Talimat 09-07 §6 — yetkili konuşma durumu konuşmanın TAMAMINDAN, gerçek PostgreSQL. Talimatın kırmızı-önce şartı: "ilk selamı son
// pencerenin DIŞINDA kalmış konuşma phase=ongoing kalır" + "ilk temas yine ilk temastır".
// ---------------------------------------------------------------------------

async function conversationWith(rows: { dir: "inbound" | "outbound"; body: string; system?: boolean }[]) {
  const { propertyId } = await makeOrgWithProperty();
  const start = Date.now() - rows.length * 60_000;
  const c = await prisma.conversation.create({
    data: {
      propertyId,
      channel: "airbnb",
      guestIdentifier: "Misafir",
      lastMessageAt: new Date(),
      messages: {
        create: rows.map((r, i) => ({
          direction: r.dir,
          senderName: r.dir === "inbound" ? "Misafir" : "Ev sahibi",
          authorType: r.system ? "system" : r.dir === "inbound" ? "guest" : "host",
          systemEventType: r.system ? "guest_chat_ai_resumed" : null,
          body: r.body,
          createdAt: new Date(start + i * 60_000),
        })),
      },
    },
  });
  return c.id;
}

describe("loadConversationPhase", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 ilk selam 60 mesaj önce (her pencerenin dışında) → ongoing, ilk cevap DEĞİL", async () => {
    const rows = [
      { dir: "inbound" as const, body: "Merhaba" },
      { dir: "outbound" as const, body: "Merhaba, hoş geldiniz!" },
      ...Array.from({ length: 60 }, (_, i) => ({ dir: "inbound" as const, body: `Soru ${i}?` })),
    ];
    const s = await loadConversationPhase(await conversationWith(rows));
    expect(s).toMatchObject({ phase: "ongoing", isFirstOperatorReply: false, deliveredReplyCount: 1, unansweredCapped: true });
  });

  it("KONTROL: ilk temas → first_contact", async () => {
    const s = await loadConversationPhase(await conversationWith([{ dir: "inbound", body: "Merhaba, Wi-Fi şifresi?" }]));
    expect(s).toMatchObject({ phase: "first_contact", isFirstOperatorReply: true, deliveredReplyCount: 0, unansweredGuestMessageCount: 1 });
  });

  it("sistem olayı ve gövdesiz giden satır cevap değildir; kapanış yalnız teşekkürde", async () => {
    const id = await conversationWith([
      { dir: "inbound", body: "Wi-Fi?" },
      { dir: "outbound", body: "x", system: true },
      { dir: "outbound", body: "" },
    ]);
    expect((await loadConversationPhase(id))?.phase).toBe("first_contact");
    const id2 = await conversationWith([
      { dir: "inbound", body: "Wi-Fi?" },
      { dir: "outbound", body: "Kartta yazıyor." },
      { dir: "inbound", body: "Teşekkürler" },
    ]);
    const s = await loadConversationPhase(id2);
    expect(s).toMatchObject({ phase: "closing", unansweredGuestMessageCount: 1 });
    expect(s?.lastInteractionAt).toBeInstanceOf(Date);
  });

  it("🚨 otomatik şablon mesajı (K7) cevapsız penceresini SIFIRLAMAZ ve kapanış saymaz: acil → giriş otomasyonu → 'Tamam teşekkürler'", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const t = Date.now() - 10 * 60_000;
    const c = await prisma.conversation.create({
      data: {
        propertyId,
        channel: "airbnb",
        guestIdentifier: "M",
        lastMessageAt: new Date(),
        messages: {
          create: [
            { direction: "inbound", senderName: "M", authorType: "guest", body: "Merhaba", createdAt: new Date(t) },
            { direction: "outbound", senderName: "Ev sahibi", authorType: "host", body: "Hoş geldiniz.", createdAt: new Date(t + 60_000) },
            { direction: "inbound", senderName: "M", authorType: "guest", body: "Su taşıyor, acil!", createdAt: new Date(t + 120_000) },
            { direction: "outbound", senderName: "Lixus", authorType: "automation", body: "Giriş bilgileriniz: …", createdAt: new Date(t + 180_000) },
            { direction: "inbound", senderName: "M", authorType: "guest", body: "Tamam teşekkürler", createdAt: new Date(t + 240_000) },
          ],
        },
      },
    });
    const s = await loadConversationPhase(c.id);
    expect(s).toMatchObject({ phase: "ongoing", deliveredReplyCount: 2, unansweredGuestMessageCount: 2 });
  });

  it("🚨 yapay zekânın son cevabı TEKLİF ise 'Olur, teşekkürler' kapanış DEĞİL", async () => {
    const id = await conversationWith([
      { dir: "inbound", body: "Yol nasıl?" },
      { dir: "outbound", body: "Yol tarifini de gönderebilirim, ister misiniz?" },
      { dir: "inbound", body: "Olur, teşekkürler" },
    ]);
    await prisma.message.updateMany({ where: { conversationId: id, direction: "outbound" }, data: { authorType: "ai", senderName: "GuestOps AI" } });
    expect((await loadConversationPhase(id))?.phase).toBe("ongoing");
  });

  it("aynı zaman damgasında cevaptan SONRA yazılan misafir mesajı kaybolmaz (eşitlik id ile)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const same = new Date(Date.now() - 60_000);
    const c = await prisma.conversation.create({ data: { propertyId, channel: "airbnb", guestIdentifier: "M", lastMessageAt: new Date() } });
    await prisma.message.create({ data: { conversationId: c.id, direction: "inbound", senderName: "M", authorType: "guest", body: "Wi-Fi?", createdAt: new Date(same.getTime() - 60_000) } });
    await prisma.message.create({ data: { conversationId: c.id, direction: "outbound", senderName: "H", authorType: "host", body: "Kartta.", createdAt: same } });
    await prisma.message.create({ data: { conversationId: c.id, direction: "inbound", senderName: "M", authorType: "guest", body: "Ya otopark?", createdAt: same } });
    expect(await loadConversationPhase(c.id)).toMatchObject({ phase: "ongoing", unansweredGuestMessageCount: 1 });
  });

  it("🚨 kuyrukta misafire ulaşmamış giden mesaj (kuyruk açık) cevap sayılmaz", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    const id = await conversationWith([
      { dir: "inbound", body: "Wi-Fi?" },
      { dir: "outbound", body: "Kartta yazıyor." },
    ]);
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id }, include: { property: true, messages: true } });
    const out = conv.messages.find((m) => m.direction === "outbound")!;
    await prisma.messageOutbox.create({
      data: { organizationId: conv.property.organizationId, conversationId: id, messageId: out.id, channel: "airbnb", body: out.body, idempotencyKey: "k1", status: "canceled" },
    });
    expect(await loadConversationPhase(id)).toMatchObject({ phase: "first_contact", deliveredReplyCount: 0, unansweredGuestMessageCount: 1 });
  });
});
