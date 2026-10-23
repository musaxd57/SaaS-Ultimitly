import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// Y3 (Codex 10-07, 15c8663): KUYRUK ONARICISI YENİ SORUYU "YANITLANDI" YAPMAZ — gerçek PostgreSQL.
//
// Normal teslim yolu konuşmayı cevabın KENDİ mesajının `createdAt`'ine çapalı kapatır: cevap yazıldıktan sonra gelen misafir
// mesajı varsa konuşma açık kalır. Onarıcı ise `sentAt`'e çapalıydı → cevap yazılıp gönderilene kadar gelen soru "teslimden önce"
// sayıldı ve AYNI turda konuşma "answered" oldu (yeni soru gizlendi). Doğru: onarıcı da cevabın mesajına çapalı; mesaj yoksa
// `sentAt`.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { drainOutboxOnce } from "@/lib/outbox/worker";
import type { OutboxSendFn } from "@/lib/outbox/worker";

const MIN = 60 * 1000;

async function seed(gid: string) {
  const org = await prisma.organization.create({ data: { name: "Org" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "D1" } });
  const conv = await prisma.conversation.create({
    data: { propertyId: property.id, guestIdentifier: gid, channel: "airbnb", status: "new", externalReservationId: `res-${gid}` },
  });
  return { orgId: org.id, convId: conv.id };
}

async function replyRow(p: { orgId: string; convId: string; gid: string; replyAt: Date; status: "sent" | "pending"; sentAt?: Date }) {
  const reply = await prisma.message.create({
    data: { conversationId: p.convId, direction: "outbound", senderName: "Host", body: "Cevap", authorType: "host", createdAt: p.replyAt },
  });
  await prisma.messageOutbox.create({
    data: {
      availableAt: new Date(Date.now() - MIN),
      organizationId: p.orgId,
      conversationId: p.convId,
      messageId: reply.id,
      channel: "airbnb",
      externalReservationId: `res-${p.gid}`,
      messageType: "manual",
      body: "Cevap",
      idempotencyKey: `y3-${p.gid}`,
      status: p.status,
      ...(p.sentAt ? { sentAt: p.sentAt } : {}),
    },
  });
}
const inbound = (convId: string, at: Date) =>
  prisma.message.create({ data: { conversationId: convId, direction: "inbound", senderName: "Guest", body: "Yeni soru", createdAt: at } });
const statusOf = async (id: string) => (await prisma.conversation.findUniqueOrThrow({ where: { id } })).status;

describe("Y3 — onarıcı cevabın mesajına çapalı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("🚨 cevap yazıldı (T0) → misafir yazdı (T0+1dk) → teslim (T0+2dk) kayıtlı: onarıcı konuşmayı AÇIK bırakır", async () => {
    const t0 = new Date(Date.now() - 60 * MIN);
    const { orgId, convId } = await seed("g1");
    await replyRow({ orgId, convId, gid: "g1", replyAt: t0, status: "sent", sentAt: new Date(t0.getTime() + 2 * MIN) });
    await inbound(convId, new Date(t0.getTime() + MIN));
    await drainOutboxOnce({ send: vi.fn(async () => ({ ok: true, providerMessageId: "x" })), tokenFor: async () => "t" });
    expect(await statusOf(convId)).toBe("new"); // ⬅️ ARIZADA "answered" (sentAt çapası)
  });

  it("🚨 AYNI TUR: normal teslim açık bıraktı → onarıcı geri ALMAZ", async () => {
    const t0 = new Date(Date.now() - 10 * MIN);
    const { orgId, convId } = await seed("g2");
    await replyRow({ orgId, convId, gid: "g2", replyAt: t0, status: "pending" });
    await inbound(convId, new Date(t0.getTime() + MIN));
    const send: OutboxSendFn = vi.fn(async () => ({ ok: true, providerMessageId: "pm-1" }));
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: "y3-g2" } })).status).toBe("sent");
    expect(await statusOf(convId)).toBe("new"); // ⬅️ ARIZADA "answered"
  });

  it("KONTROL: misafir mesajı cevaptan ÖNCE ise kaçan etki onarılır (answered)", async () => {
    const t0 = new Date(Date.now() - 60 * MIN);
    const { orgId, convId } = await seed("g3");
    await inbound(convId, new Date(t0.getTime() - MIN));
    await replyRow({ orgId, convId, gid: "g3", replyAt: t0, status: "sent", sentAt: new Date(t0.getTime() + 2 * MIN) });
    await drainOutboxOnce({ send: vi.fn(async () => ({ ok: true, providerMessageId: "x" })), tokenFor: async () => "t" });
    expect(await statusOf(convId)).toBe("answered");
  });

  it("KONTROL: mesajsız satırda çapa sentAt (eski kural) — sentAt'ten sonraki soru açık kalır, önceki kapanır", async () => {
    const t0 = new Date(Date.now() - 60 * MIN);
    const a = await seed("g4");
    const b = await seed("g5");
    for (const [x, gid, inboundAt] of [
      [a, "g4", new Date(t0.getTime() + MIN)],
      [b, "g5", new Date(t0.getTime() - MIN)],
    ] as const) {
      await inbound(x.convId, inboundAt);
      await prisma.messageOutbox.create({
        data: {
          availableAt: new Date(Date.now() - MIN), organizationId: x.orgId, conversationId: x.convId, messageId: null, channel: "airbnb",
          externalReservationId: `res-${gid}`, messageType: "manual", body: "x", idempotencyKey: `y3-${gid}`, status: "sent", sentAt: t0,
        },
      });
    }
    await drainOutboxOnce({ send: vi.fn(async () => ({ ok: true, providerMessageId: "x" })), tokenFor: async () => "t" });
    expect(await statusOf(a.convId)).toBe("new");
    expect(await statusOf(b.convId)).toBe("answered");
  });
});
