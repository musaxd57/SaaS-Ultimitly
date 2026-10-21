import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, enableAutoMessages } from "../helpers/db";
import { seedAutoMessage } from "../helpers/auto-message";

// ---------------------------------------------------------------------------
// ABONELİK ERİŞİMİ KAPANINCA KUYRUKTAKİ OTOMATİK MESAJ (Codex 10-16, ölçüldü). Kurucu kararı: "Geçerli ödenmiş dönem bitince ücretli
// otomatik işler dursun." Yeni otomasyon duruyordu ama kuyruk işçisi gönderim anında erişime bakmıyordu → `premiumAllowed()` false iken
// bekleyen yapay zekâ cevabı gönderilip "sent" oluyordu.
// 🚨 N1 (kurucu 10-17, AYNEN: "ödeme geldikten sonra çalışmaya başlasın kesinlikle bayat mesaj gitmememeli tek gösterimlik uyarı çıkabilir"):
//  · erişimi kapalı işletmenin YAPAY ZEKÂ cevabı (ai / holding_ack) İPTAL edilir (`billing_paused`), gelen kutusunda not görünür — ödeme
//    gelince bayat cevap GİTMEZ (eskiden 10-16 sürümü bekletiyordu, ödeme sonrası gidiyordu);
//  · YAŞAM DÖNGÜSÜ satırı (welcome / checkin / checkout) TALEP EDİLMEZ, bekler (deneme sayısı artmaz); ödeme gelince yalnız penceresi hâlâ
//    geçerliyse gider (gönderim anı vetosu);
//  · elle yazılmış ev sahibi cevabı etkilenmez ve bekleyen otomatik satırın ARKASINDA sıra kuralıyla tıkanmaz;
//  · erişim kapalıyken GELEN misafir mesajı damgalanır: ödeme sonrası ona otomatik cevap üretilmez (`markBillingPausedConversations`).
// ---------------------------------------------------------------------------

const override = vi.hoisted(() => ({ premium: null as null | ((orgId: string) => Promise<boolean>) }));
vi.mock("@/lib/billing/subscription", async (orig) => {
  const actual = await orig<typeof import("@/lib/billing/subscription")>();
  return { ...actual, premiumAllowed: (orgId: string) => (override.premium ? override.premium(orgId) : actual.premiumAllowed(orgId)) };
});

import { enqueueOutbound } from "@/lib/outbox/enqueue";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";
import { strictQueueState, __resetStrictQueueState, QUEUE_STALL_MS } from "@/lib/outbox/health";
import { currentHourInTimeZone, markBillingPausedConversations, runDueChannelAutoReplies } from "@/lib/automation";
import { noteBillingBlockedSeen } from "@/lib/outbox/billing-hold";

const DAY = 86_400_000;
const atMidnight = (offset: number) => new Date(`${new Date(Date.now() + offset * DAY).toISOString().slice(0, 10)}T00:00:00.000Z`);

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  // T4 (migration 80): yaşam döngüsü satırının metni dairenin otomatik mesaj kaydından gönderim anında yeniden kurulur.
  for (const kind of ["welcome", "checkin", "checkout"] as const) await seedAutoMessage(propertyId, kind, "x");
  await enableAutoMessages(orgId);
  // Yaşam döngüsü vetosu satırın rezervasyonunu okur (iptal / pencere / zaten gönderildi).
  await prisma.reservation.create({
    data: {
      propertyId, guestName: "Ayşe", channel: "airbnb", status: "confirmed", sourceReference: "res-bh",
      arrivalDate: atMidnight(2), departureDate: atMidnight(5),
    },
  });
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

/** Yaşam döngüsü satırı (karşılama) — kuyruğa doğrudan yazılır (proaktif kuyruğa giriş yolu bu dosyanın konusu değil). */
const enqueueWelcome = (orgId: string, conversationId: string, key: string) =>
  prisma.messageOutbox.create({
    data: {
      organizationId: orgId, conversationId, channel: "airbnb", externalReservationId: "res-bh", body: "Hoş geldiniz!",
      idempotencyKey: key, status: "pending", messageType: "welcome",
    },
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

  it("🚨 N1: erişim kapalı → yapay zekâ cevabı İPTAL (billing_paused) + gelen kutusu notu; elle cevap gider ve arkasında tıkanmaz", async () => {
    const { orgId, conversationId } = await seed();
    await expireAccess(orgId);
    await enqueue(orgId, conversationId, "ai", "ai-1");
    await enqueue(orgId, conversationId, "host", "host-1");
    const { send, sent } = counter();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(sent).toEqual(["manual"]); // ⬅️ 10-16 öncesi ["ai", "manual"]
    const ai = await prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId, messageType: "ai" } });
    expect(ai).toMatchObject({ status: "canceled", lastErrorCode: "billing_paused" }); // ⬅️ 10-16 sürümü "pending" bırakıyordu
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(convo.skippedReason).toBe("billing_paused");
  });

  it("🚨 N1: ödeme gelince iptal edilmiş bayat cevap GİTMEZ (eskiden bekleyip ödeme sonrası gidiyordu)", async () => {
    const { orgId, conversationId } = await seed();
    await expireAccess(orgId);
    await enqueue(orgId, conversationId, "ai", "ai-stale");
    const { send, sent } = counter();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    await prisma.subscription.update({ where: { organizationId: orgId }, data: { provider: "paddle", status: "active", trialEndsAt: null } });
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(sent).toEqual([]);
  });

  it("🚨 N1: yaşam döngüsü satırı erişim kapalıyken TALEP EDİLMEZ (deneme 0); ödeme gelince penceresi geçerliyse gider", async () => {
    const { orgId, conversationId } = await seed();
    await expireAccess(orgId);
    await enqueueWelcome(orgId, conversationId, "welcome-1");
    const { send, sent } = counter();
    const first = await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(first.claimed).toBe(0);
    expect(await prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: "welcome-1" } })).toMatchObject({ status: "pending", attemptCount: 0 });
    await prisma.subscription.update({ where: { organizationId: orgId }, data: { provider: "paddle", status: "active", trialEndsAt: null } });
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(sent).toEqual(["welcome"]);
  });

  it("N1 aşırı uygulama yok: ödeme geldiğinde rezervasyon İPTAL edilmişse bekleyen karşılama GİTMEZ (gönderim anı vetosu)", async () => {
    const { orgId, conversationId } = await seed();
    await expireAccess(orgId);
    await enqueueWelcome(orgId, conversationId, "welcome-2");
    const { send, sent } = counter();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    await prisma.reservation.updateMany({ where: { sourceReference: "res-bh" }, data: { status: "cancelled" } });
    await prisma.subscription.update({ where: { organizationId: orgId }, data: { provider: "paddle", status: "active", trialEndsAt: null } });
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(sent).toEqual([]);
    expect(await prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: "welcome-2" } })).toMatchObject({
      status: "canceled",
      lastErrorCode: "reservation_cancelled",
    });
  });

  it("🚨 Opus 10-17: kapalı dönemde HİÇ talep edilmemiş (ileri vadeli) yapay zekâ cevabı ödemeden SONRA da gitmez (oluşma ≤ son kapalı görülme)", async () => {
    const { orgId, conversationId } = await seed();
    await enqueue(orgId, conversationId, "ai", "ai-deferred-stale");
    // Satır kapalı dönemde vadesi gelmediği için talep edilmedi; senkron o dönemde "kapalı" gördü (işaret satırdan SONRA).
    await noteBillingBlockedSeen(orgId, new Date(Date.now() + 1_000));
    const { send, sent } = counter();
    await drainOutboxOnce({ send, tokenFor: async () => "t", now: () => new Date(Date.now() + 2_000) });
    expect(sent).toEqual([]); // ⬅️ işaretsiz: ["ai"] (bayat cevap)
    expect(await prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: "ai-deferred-stale" } })).toMatchObject({
      status: "canceled",
      lastErrorCode: "billing_paused",
    });
  });

  it("KONTROL: kapalı dönemden SONRA kuyruğa giren yapay zekâ cevabı normal gider", async () => {
    const { orgId, conversationId } = await seed();
    await noteBillingBlockedSeen(orgId, new Date(Date.now() - 60_000));
    await enqueue(orgId, conversationId, "ai", "ai-fresh");
    const { send, sent } = counter();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(sent).toEqual(["ai"]);
  });

  it("🚨 Opus 10-17: kapalı dönemde bekleyen karşılama, ödeme geldiğinde varış günü GEÇMİŞSE gitmez (konaklama ortasında 'hoş geldiniz' yok)", async () => {
    const { orgId, conversationId } = await seed();
    await prisma.reservation.updateMany({ where: { sourceReference: "res-bh" }, data: { arrivalDate: atMidnight(-1), departureDate: atMidnight(3) } });
    await enqueueWelcome(orgId, conversationId, "welcome-stale");
    await noteBillingBlockedSeen(orgId, new Date(Date.now() + 1_000)); // satır kapalı dönemi kapsadı
    const { send, sent } = counter();
    await drainOutboxOnce({ send, tokenFor: async () => "t", now: () => new Date(Date.now() + 2_000) });
    expect(sent).toEqual([]);
    expect(await prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: "welcome-stale" } })).toMatchObject({
      status: "canceled",
      lastErrorCode: "window_passed",
    });
  });

  it("KONTROL: kapalı dönemi KAPSAMAYAN aynı karşılama (normal kuyruk gecikmesi) eski pencereyle gider", async () => {
    const { orgId, conversationId } = await seed();
    await prisma.reservation.updateMany({ where: { sourceReference: "res-bh" }, data: { arrivalDate: atMidnight(-1), departureDate: atMidnight(3) } });
    await enqueueWelcome(orgId, conversationId, "welcome-normal");
    const { send, sent } = counter();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(sent).toEqual(["welcome"]);
  });

  it("🚨 eski NULL türlü satır (elle cevap sayılır) erişim kapalıyken de gider; ertelenmiş otomatik satır elle cevabı TIKAMAZ (Haiku 10-16)", async () => {
    const { orgId, conversationId } = await seed();
    await expireAccess(orgId);
    // Ertelenmiş (vadesi gelmemiş) yaşam döngüsü satırı önde, ardından eski NULL türlü bir cevap satırı.
    await enqueueWelcome(orgId, conversationId, "welcome-deferred");
    await prisma.messageOutbox.updateMany({ where: { idempotencyKey: "welcome-deferred" }, data: { availableAt: new Date(Date.now() + 5 * 60_000) } });
    await prisma.messageOutbox.create({
      data: { organizationId: orgId, conversationId, channel: "airbnb", externalReservationId: "res-bh", body: "Eski cevap", idempotencyKey: "legacy-null", status: "pending", messageType: null },
    });
    const { send, sent } = counter();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(sent).toEqual(["null"]); // ⬅️ NULL IN (…) süzgeci satırı yanlışlıkla eliyordu / ertelenmiş satır sırayı tıkıyordu
  });

  it("🚨 kuyruk sağlığı bekletilen yaşam döngüsü satırını 'takılı' saymaz; KONTROL: erişim açıkken aynı satır takılıdır", async () => {
    const { orgId, conversationId } = await seed();
    await expireAccess(orgId);
    await enqueueWelcome(orgId, conversationId, "welcome-old");
    const old = new Date(Date.now() - QUEUE_STALL_MS - 60_000);
    await prisma.messageOutbox.updateMany({ where: { idempotencyKey: "welcome-old" }, data: { availableAt: old, createdAt: old } });
    __resetStrictQueueState();
    expect(await strictQueueState()).toBe("ok"); // ⬅️ yanlış "ilerlemiyor" alarmı yok
    await prisma.subscription.update({ where: { organizationId: orgId }, data: { provider: "paddle", status: "active", trialEndsAt: null } });
    __resetStrictQueueState();
    expect(await strictQueueState()).toBe("stalled");
  });

  it("🚨 talepten SONRA erişim kapandı: yaşam döngüsü satırı POST edilmez, ertelenir (deneme sayılmaz); yapay zekâ cevabı iptal edilir", async () => {
    const { orgId, conversationId } = await seed();
    await enqueueWelcome(orgId, conversationId, "welcome-3");
    // Talep öncesi okuma "açık", gönderim anı okuması "kapalı" (iki okuma arasında dönem bitti).
    let calls = 0;
    override.premium = async () => ++calls === 1;
    await expireAccess(orgId);
    const { send, sent } = counter();
    const before = Date.now();
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(sent).toEqual([]);
    const welcome = await prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: "welcome-3" } });
    expect(welcome.status).toBe("pending");
    expect(welcome.attemptCount).toBe(0);
    expect(welcome.availableAt.getTime()).toBeGreaterThan(before);
    // Yapay zekâ cevabı aynı durumda POST edilmez, iptal edilir.
    override.premium = async () => false;
    await enqueue(orgId, conversationId, "ai", "ai-2");
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(sent).toEqual([]);
    expect(await prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: "ai-2" } })).toMatchObject({ status: "canceled" });
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

describe("N1: erişim kapalıyken gelen misafir mesajı — ödeme sonrası bayat otomatik cevap üretilmez", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("BILLING_ENFORCED", "true");
    vi.stubEnv("PRIMARY_ORG_ID", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  async function seedAuto() {
    const { orgId, conversationId } = await seed();
    await prisma.organization.update({
      where: { id: orgId },
      data: { autoReplyHospitable: true, autoReplyEnabledAt: new Date(Date.now() - 7 * DAY), autoReplyStartHour: 0, autoReplyEndHour: 0 },
    });
    return { orgId, conversationId };
  }

  it("🚨 erişim kapalıyken gelen mesaj damgalanır (not + deneme damgası); ödeme gelince oto-yanıt ona cevap ÜRETMEZ", async () => {
    const { orgId, conversationId } = await seedAuto();
    await expireAccess(orgId);
    expect(await markBillingPausedConversations(orgId)).toBe(1);
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(convo.skippedReason).toBe("billing_paused");
    expect(convo.autoReplyAttemptedAt?.getTime()).toBe(convo.lastMessageAt.getTime());
    await prisma.subscription.update({ where: { organizationId: orgId }, data: { provider: "paddle", status: "active", trialEndsAt: null } });
    expect((await runDueChannelAutoReplies(orgId)).considered).toBe(0); // ⬅️ ESKİDE 1 (günler önceki soruya cevap üretilirdi)
    // Tekrar çağrı aynı satırı yeniden yazmaz.
    expect(await markBillingPausedConversations(orgId)).toBe(0);
  });

  it("KONTROL: misafir ödemeden SONRA yeniden yazarsa yeni mesaj normal aday olur", async () => {
    const { orgId, conversationId } = await seedAuto();
    await expireAccess(orgId);
    await markBillingPausedConversations(orgId);
    await prisma.subscription.update({ where: { organizationId: orgId }, data: { provider: "paddle", status: "active", trialEndsAt: null } });
    const later = new Date(Date.now() + 1_000);
    await prisma.message.create({ data: { conversationId, direction: "inbound", senderName: "Ayşe", body: "Merhaba?", createdAt: later } });
    await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: later, status: "new" } });
    expect((await runDueChannelAutoReplies(orgId)).considered).toBe(1);
  });

  it("🚨 Haiku 10-17: senkron kapalı dönemde düştü, mesaj ödemeden SONRA eski zamanla içeri alındı → 'son kapalı görülme' işareti cevabı ENGELLER", async () => {
    const { orgId, conversationId } = await seedAuto();
    // Kapalı dönemde senkron düşüyordu: damga hiç çalışmadı, yalnız işaret yazıldı (scheduled-sync, syncOk'tan bağımsız).
    await noteBillingBlockedSeen(orgId, new Date(Date.now() - 1_000));
    // Ödeme geldi; eski mesaj (60 sn önce) şimdi içeri alınmış durumda, damgasız.
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).autoReplyAttemptedAt).toBeNull();
    expect((await runDueChannelAutoReplies(orgId)).considered).toBe(0); // ⬅️ işaretsiz: 1 (günler önceki soruya cevap)
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(convo.skippedReason).toBe("billing_paused"); // not da yazıldı
    expect(convo.autoReplyAttemptedAt?.getTime()).toBe(convo.lastMessageAt.getTime());
  });

  it("KONTROL: işaretten SONRA gelen mesaj (ödemeden sonra) normal adaydır", async () => {
    const { orgId, conversationId } = await seedAuto();
    await noteBillingBlockedSeen(orgId, new Date(Date.now() - 120_000)); // mesaj (60 sn önce) işaretten yeni
    expect((await runDueChannelAutoReplies(orgId)).considered).toBe(1);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).skippedReason).not.toBe("billing_paused");
  });

  it("🚨 Haiku 10-17: kalıcı sebep ('misafir insan istedi') notla EZİLMEZ, damga yine yazılır; geçici sebep ('mesai dışı') güncellenir", async () => {
    const { orgId, conversationId } = await seedAuto();
    await expireAccess(orgId);
    await prisma.conversation.update({ where: { id: conversationId }, data: { skippedReason: "human_hold" } });
    expect(await markBillingPausedConversations(orgId)).toBe(1);
    const held = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(held.skippedReason).toBe("human_hold"); // ⬅️ eskiden "billing_paused"
    expect(held.autoReplyAttemptedAt?.getTime()).toBe(held.lastMessageAt.getTime());
    // Geçici sebep: yeni mesaj geldi, mesai dışı notu yazılmıştı → abonelik notu onu günceller.
    const later = new Date(Date.now() + 1_000);
    await prisma.message.create({ data: { conversationId, direction: "inbound", senderName: "Ayşe", body: "?", createdAt: later } });
    await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: later, skippedReason: "outside_hours" } });
    expect(await markBillingPausedConversations(orgId)).toBe(1);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).skippedReason).toBe("billing_paused");
  });

  it("Haiku 10-17: ödemeden sonra gelen yeni mesaj mesai dışındaysa eski abonelik notu güncel sebeple değişir", async () => {
    const { orgId, conversationId } = await seedAuto();
    await expireAccess(orgId);
    await markBillingPausedConversations(orgId);
    await prisma.subscription.update({ where: { organizationId: orgId }, data: { provider: "paddle", status: "active", trialEndsAt: null } });
    const later = new Date(Date.now() + 1_000);
    await prisma.message.create({ data: { conversationId, direction: "inbound", senderName: "Ayşe", body: "?", createdAt: later } });
    await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: later } });
    // Şimdiki saati dışarıda bırakan aralık (başlangıç = şimdi + 1 sa, bitiş = şimdi + 2 sa; org saat dilimi varsayılan).
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { timezone: true } });
    const hour = currentHourInTimeZone(org.timezone);
    await prisma.organization.update({ where: { id: orgId }, data: { autoReplyStartHour: (hour + 1) % 24, autoReplyEndHour: (hour + 2) % 24 } });
    await runDueChannelAutoReplies(orgId);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).skippedReason).toBe("outside_hours");
  });

  it("aşırı uygulama yok: oto-yanıtı kapalı işletme / genel anahtar kapalı → damga yok", async () => {
    const { orgId, conversationId } = await seed();
    await expireAccess(orgId);
    // Kurulum otomatik mesaj anahtarlarını açar (S3-01); bu durum oto-yanıtı KAPALI işletmeyi sınar.
    await prisma.organization.update({ where: { id: orgId }, data: { autoReplyHospitable: false } });
    expect(await markBillingPausedConversations(orgId)).toBe(0); // oto-yanıt kapalı
    await prisma.organization.update({ where: { id: orgId }, data: { autoReplyHospitable: true, autoReplyEnabledAt: new Date(Date.now() - DAY) } });
    vi.stubEnv("AUTO_REPLY_ENABLED", "");
    expect(await markBillingPausedConversations(orgId)).toBe(0);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).skippedReason).toBeNull();
  });
});
