import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, enableAutoMessages } from "../helpers/db";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { enqueueOutbound } from "@/lib/outbox/enqueue";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";
import { OUTBOX_MAX_ATTEMPTS } from "@/lib/outbox/state";
import { settleItemsTurn } from "@/lib/conversation-items/flow";
import { ANON_BODY } from "@/lib/data-retention";

// ---------------------------------------------------------------------------
// Codex 10-23: kalıcı kuyrukta öğe kuyruğa GİRİŞTE "cevaplandı" oluyordu; teslim kalıcı düşerse (kesin hata · kanal engeli · gönderim anı
// vetosuyla iptal) ihtiyaç kapanmış görünüyordu. Şimdi cevabı taşıyan mesaj öğeye yazılır ve kalıcı "gitmedi"de YALNIZ o mesajın kapattığı,
// hâlâ "cevaplandı" olan öğeler ev sahibinde yeniden açık olur. Belirsiz teslim (gitmiş olabilir) açmaz; başarılı teslimde öğe kapalı kalır.
// ---------------------------------------------------------------------------

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await enableAutoMessages(orgId);
  const c = await prisma.conversation.create({
    data: { propertyId, channel: "airbnb", guestIdentifier: "Misafir", status: "new", externalReservationId: "res-r" },
  });
  const inbound = await prisma.message.create({
    data: { conversationId: c.id, direction: "inbound", senderName: "Misafir", body: "Çöpler nereye? Klima çalışmıyor.", createdAt: new Date(Date.now() - 5 * 60_000) },
  });
  const trash = await prisma.conversationItem.create({
    data: { organizationId: orgId, conversationId: c.id, messageId: inbound.id, kind: "trash", sensitivity: "none", sources: "understanding" },
  });
  const r = await enqueueOutbound({
    organizationId: orgId,
    conversationId: c.id,
    channel: "airbnb",
    externalReservationId: "res-r",
    body: "Çöpleri bina girişindeki konteynere atabilirsiniz.",
    senderName: "GuestOps AI",
    authorType: "ai",
    messageType: "ai",
    aiIntent: "trash",
    idempotencyKey: `auto:${c.id}:${inbound.id}`,
  });
  // Otomasyonun kuyruk yolu gibi: karar kesin → öğe "cevaplandı", cevabı taşıyan mesaj yazılır.
  const persisted = { id: trash.id, conversationId: c.id, notifiedAt: null, messageId: inbound.id, kind: "trash" as const, sensitivity: "none" as const, riskType: null, sources: ["understanding" as const], status: "open" as const, requestIndex: 0, createdAt: trash.createdAt, updatedAt: trash.updatedAt };
  await settleItemsTurn(prisma, {
    organizationId: orgId,
    turnItems: [persisted],
    answerable: [{ ref: "R1", item: persisted }],
    now: new Date(),
    answeredRefs: ["R1"],
    answeredByMessageId: r.messageId,
  });
  return { orgId, conversationId: c.id, inboundId: inbound.id, outboxId: r.outboxId, messageId: r.messageId, itemId: trash.id };
}

const item = (id: string) => prisma.conversationItem.findUniqueOrThrow({ where: { id } });
const outbox = (id: string) => prisma.messageOutbox.findUniqueOrThrow({ where: { id } });

describe("kalıcı kuyruk: gitmeyen cevapla ihtiyaç kapanmış görünmez", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("kuyruğa girişte öğe 'cevaplandı' + cevabı taşıyan mesaj yazılı", async () => {
    const s = await seed();
    expect(await item(s.itemId)).toMatchObject({ status: "answered", answeredByMessageId: s.messageId });
  });

  it("🚨 kesin teslim hatası (tavan) → öğe ev sahibinde yeniden AÇIK (pending_host), bağ temizlenir", async () => {
    const s = await seed();
    const send: OutboxSendFn = async () => ({ ok: false, error: "Hospitable API hatası (HTTP 400)" });
    let clock = Date.now();
    const now = () => new Date(clock);
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 2; i++) {
      await drainOutboxOnce({ send, tokenFor: async () => "t", now });
      clock += 60 * 60_000;
    }
    expect((await outbox(s.outboxId)).status).toBe("failed");
    expect(await item(s.itemId)).toMatchObject({ status: "pending_host", answeredByMessageId: null, resolvedAt: null });
  });

  it("🚨 gönderim anı vetosuyla iptal (ev sahibi araya girdi) → öğe yeniden açık", async () => {
    const s = await seed();
    await prisma.message.create({
      data: { conversationId: s.conversationId, direction: "outbound", authorType: "host", senderName: "Host", body: "Ben ilgileniyorum." },
    });
    const send = vi.fn<OutboxSendFn>(async () => ({ ok: true, providerMessageId: "x" }));
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(send).not.toHaveBeenCalled();
    expect((await outbox(s.outboxId)).status).toBe("canceled");
    expect((await item(s.itemId)).status).toBe("pending_host");
  });

  it("başarılı teslimde öğe KAPALI kalır; belirsiz teslimde (gitmiş olabilir) AÇILMAZ", async () => {
    const ok = await seed();
    await drainOutboxOnce({ send: async () => ({ ok: true, providerMessageId: "p1" }), tokenFor: async () => "t" });
    expect((await outbox(ok.outboxId)).status).toBe("sent");
    expect((await item(ok.itemId)).status).toBe("answered");

    await resetDb();
    const amb = await seed();
    // Ağ kesintisi = belirsiz (gitmiş olabilir) → yeniden dene / gözden geçir; öğe kapalı kalır.
    await drainOutboxOnce({ send: async () => ({ ok: false, error: "network reset" }), reconcile: async () => ({ found: false }), tokenFor: async () => "t" });
    expect((await outbox(amb.outboxId)).status).not.toBe("failed");
    expect((await item(amb.itemId)).status).toBe("answered");
  });

  it("🚨 Opus 10-23 öğle B6: kanal engeli (402, abonelik pasif) → öğe yeniden açık; KVKK silme iptali → öğe AÇILMAZ (silinecek veri)", async () => {
    const blocked = await seed();
    await drainOutboxOnce({ send: async () => ({ ok: false, error: "Hospitable API hatası (HTTP 402)" }), tokenFor: async () => "t" });
    expect((await outbox(blocked.outboxId)).status).toBe("blocked");
    expect((await item(blocked.itemId)).status).toBe("pending_host");

    await resetDb();
    const erased = await seed();
    await prisma.messageOutbox.update({ where: { id: erased.outboxId }, data: { body: ANON_BODY } });
    const send = vi.fn<OutboxSendFn>(async () => ({ ok: true, providerMessageId: "x" }));
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(send).not.toHaveBeenCalled();
    expect(await outbox(erased.outboxId)).toMatchObject({ status: "canceled", lastErrorCode: "erased" });
    expect((await item(erased.itemId)).status).toBe("answered");
  });

  it("aradan ev sahibi kapattıysa (done) ya da öğe başka mesajla kapandıysa dokunulmaz", async () => {
    const s = await seed();
    await prisma.conversationItem.update({ where: { id: s.itemId }, data: { status: "done" } });
    const other = await prisma.conversationItem.create({
      data: { organizationId: s.orgId, conversationId: s.conversationId, messageId: s.inboundId, kind: "wifi", sensitivity: "none", sources: "understanding", status: "answered", answeredByMessageId: "baska-mesaj" },
    });
    await prisma.message.create({
      data: { conversationId: s.conversationId, direction: "outbound", authorType: "host", senderName: "Host", body: "Hallettim." },
    });
    await drainOutboxOnce({ send: async () => ({ ok: true, providerMessageId: "x" }), tokenFor: async () => "t" });
    expect((await outbox(s.outboxId)).status).toBe("canceled");
    expect((await item(s.itemId)).status).toBe("done");
    expect((await item(other.id)).status).toBe("answered");
  });
});
