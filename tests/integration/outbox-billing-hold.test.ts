import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// ABONELİK ERİŞİMİ KAPANINCA KUYRUKTAKİ OTOMATİK MESAJ (Codex 10-16, ölçüldü). Kurucu kararı: "Geçerli ödenmiş dönem bitince ücretli
// otomatik işler dursun." Yeni otomasyon duruyordu ama kuyruk işçisi gönderim anında erişime bakmıyordu → `premiumAllowed()` false iken
// bekleyen yapay zekâ cevabı gönderilip "sent" oluyordu. Sözleşme:
//  · erişimi kapalı işletmenin OTOMATİK satırı (ai / holding_ack / welcome / checkin / checkout) gönderilmez — iptal de EDİLMEZ, deneme
//    sayısı artmaz (bekleyen mesajın ödeme sonrası kaderi kurucu kararı);
//  · elle yazılmış ev sahibi cevabı etkilenmez ve bekleyen otomatik satırın ARKASINDA sıra kuralıyla tıkanmaz;
//  · talepten sonra erişim kapanırsa gönderim anı kemeri POST'u durdurur;
//  · erişim açılınca (kontrol) satır normal işlenir.
// ---------------------------------------------------------------------------

const override = vi.hoisted(() => ({ premium: null as null | ((orgId: string) => Promise<boolean>) }));
vi.mock("@/lib/billing/subscription", async (orig) => {
  const actual = await orig<typeof import("@/lib/billing/subscription")>();
  return { ...actual, premiumAllowed: (orgId: string) => (override.premium ? override.premium(orgId) : actual.premiumAllowed(orgId)) };
});

import { enqueueOutbound } from "@/lib/outbox/enqueue";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";
import { strictQueueState, __resetStrictQueueState, QUEUE_STALL_MS } from "@/lib/outbox/health";

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const conversation = await prisma.conversation.create({
    data: {
      propertyId,
      channel: "airbnb",
      guestIdentifier: "Ayşe",
      status: "new",
      externalReservationId: "res-bh",
      lastMessageAt: new Date(Date.now() - 60_000),
      messages: { create: [{ direction: "inbound", senderName: "Ayşe", body: "Wifi?", createdAt: new Date(Date.now() - 60_000) }] },
    },
  });
  return { orgId, conversationId: conversation.id };
}

const enqueue = (orgId: string, conversationId: string, author: "host" | "ai", key: string) =>
  enqueueOutbound({
    organizationId: orgId,
    conversationId,
    channel: "airbnb",
    externalReservationId: "res-bh",
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

/** Erişimi kapalı işletme: süresi dolmuş deneme (faturalandırma uygulanırken). */
const expireAccess = (orgId: string) =>
  prisma.subscription.create({
    data: { organizationId: orgId, provider: "trial", status: "trialing", planCode: "pro", trialEndsAt: new Date(Date.now() - 86_400_000) },
  });

describe("abonelik erişimi kapalı işletmenin kuyruktaki otomatik mesajı", () => {
  beforeEach(async () => {
    await resetDb();
    override.premium = null;
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("BILLING_ENFORCED", "true");
    vi.stubEnv("PRIMARY_ORG_ID", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    override.premium = null;
  });

  it("🚨 erişim kapalı: yapay zekâ cevabı GÖNDERİLMEZ ve iptal EDİLMEZ (deneme 0); elle cevap gider ve arkasında tıkanmaz", async () => {
    const { orgId, conversationId } = await seed();
    await expireAccess(orgId);
    await enqueue(orgId, conversationId, "ai", "ai-1");
    await enqueue(orgId, conversationId, "host", "host-1");
    const { send, sent } = counter();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(sent).toEqual(["manual"]); // ⬅️ ESKİDE ["ai", "manual"]
    const ai = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId, messageType: "ai" } });
    expect(ai).toMatchObject({ status: "pending", attemptCount: 0 });
  });

  it("KONTROL: erişim açılınca (ödeme doğrulandı) bekleyen otomatik satır normal işlenir", async () => {
    const { orgId, conversationId } = await seed();
    await expireAccess(orgId);
    await enqueue(orgId, conversationId, "ai", "ai-ctl");
    const { send, sent } = counter();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(sent).toEqual([]);
    await prisma.subscription.update({ where: { organizationId: orgId }, data: { provider: "paddle", status: "active", trialEndsAt: null } });
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(sent).toEqual(["ai"]);
  });

  it("🚨 eski NULL türlü satır (elle cevap sayılır) erişim kapalıyken de gider; ertelenmiş otomatik satır elle cevabı TIKAMAZ (Haiku 10-16)", async () => {
    const { orgId, conversationId } = await seed();
    await expireAccess(orgId);
    // Ertelenmiş (vadesi gelmemiş) otomatik satır önde, ardından eski NULL türlü bir cevap satırı.
    await enqueue(orgId, conversationId, "ai", "ai-deferred");
    await prisma.messageOutbox.updateMany({ where: { idempotencyKey: "ai-deferred" }, data: { availableAt: new Date(Date.now() + 5 * 60_000) } });
    await prisma.messageOutbox.create({
      data: { organizationId: orgId, conversationId, channel: "airbnb", externalReservationId: "res-bh", body: "Eski cevap", idempotencyKey: "legacy-null", status: "pending", messageType: null },
    });
    const { send, sent } = counter();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(sent).toEqual(["null"]); // ⬅️ NULL IN (…) süzgeci satırı yanlışlıkla eliyordu / ertelenmiş satır sırayı tıkıyordu
  });

  it("🚨 kuyruk sağlığı bekletilen otomatik satırı 'takılı' saymaz; KONTROL: erişim açıkken aynı satır takılıdır", async () => {
    const { orgId, conversationId } = await seed();
    await expireAccess(orgId);
    await enqueue(orgId, conversationId, "ai", "ai-old");
    const old = new Date(Date.now() - QUEUE_STALL_MS - 60_000);
    await prisma.messageOutbox.updateMany({ where: { idempotencyKey: "ai-old" }, data: { availableAt: old, createdAt: old } });
    __resetStrictQueueState();
    expect(await strictQueueState()).toBe("ok"); // ⬅️ yanlış "ilerlemiyor" alarmı yok
    await prisma.subscription.update({ where: { organizationId: orgId }, data: { provider: "paddle", status: "active", trialEndsAt: null } });
    __resetStrictQueueState();
    expect(await strictQueueState()).toBe("stalled");
  });

  it("🚨 talepten SONRA erişim kapandı: gönderim anı kemeri POST etmez, satır ertelenir (deneme sayılmaz)", async () => {
    const { orgId, conversationId } = await seed();
    await enqueue(orgId, conversationId, "ai", "ai-2");
    // Talep öncesi okuma "açık", gönderim anı okuması "kapalı" (iki okuma arasında dönem bitti).
    let calls = 0;
    override.premium = async () => ++calls === 1;
    await expireAccess(orgId);
    const { send, sent } = counter();
    const before = Date.now();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(sent).toEqual([]);
    const ai = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId, messageType: "ai" } });
    expect(ai.status).toBe("pending");
    expect(ai.attemptCount).toBe(0);
    expect(ai.availableAt.getTime()).toBeGreaterThan(before);
  });

  it("KONTROL: faturalandırma uygulanmıyorsa (BILLING_ENFORCED kapalı) hiçbir şey değişmez — otomatik cevap gider", async () => {
    vi.stubEnv("BILLING_ENFORCED", "");
    const { orgId, conversationId } = await seed();
    await expireAccess(orgId);
    await enqueue(orgId, conversationId, "ai", "ai-3");
    const { send, sent } = counter();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(sent).toEqual(["ai"]);
  });
});
