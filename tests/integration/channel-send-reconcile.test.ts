import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { FakeOutboundProvider } from "../helpers/fake-channel";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// BELİRSİZ GÖNDERİMİ LİXUS KENDİSİ DOĞRULAR (kurucu 11-19 AK-1 / KU-1: "adamların mesajlarını görebiliyoruz ki … varsa gitmiştir" ·
// "belirsiz bir durum web sitemizde bizden kaynaklanmasın"; tasarım `docs/TASARIM-2026-11-19-belirsiz-gonderimi-lixus-kendisi-dogrular.md`).
// Gerçek worker, gerçek rota, gerçek veritabanı; sağlayıcı ortak sahte (kanal konuşmasını da okur). Kanıt sağlayıcı tarafının gerçeğidir:
// misafire kaç mesaj ULAŞTI (`deliveries`) ve sağlayıcıya kaç istek gitti (`attempts`) — hiçbir dalda kör yeniden gönderim yok.
// Codex'in istediği üç durum ayrı: iptal kazandı (K1, `outbox-dispatch-cancel.test.ts`) · hazırlıkta çöktü (K2, aynı dosya) · kanal KABUL
// ETTİ, YANIT KAYBOLDU (bu dosya).
// ---------------------------------------------------------------------------

const { tokenFor } = vi.hoisted(() => ({
  tokenFor: vi.fn<(orgId: string) => Promise<string | null>>(async () => "tok-A"),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: tokenFor,
  handleProviderAuthFailure: vi.fn(async () => {}),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { __setOutboundAdapterForTest } from "@/lib/channels";
import { enqueueOutbound } from "@/lib/outbox/enqueue";
import { drainOutboxOnce } from "@/lib/outbox/worker";
import { OUTBOX_MAX_ATTEMPTS } from "@/lib/outbox/state";
import { RECONCILE_CODES } from "@/lib/outbox/reconcile-match";
import { __resetRateLimit } from "@/lib/rate-limit";
import { POST as replyRoute } from "@/app/api/conversations/[id]/reply/route";
import { DELETE as deleteConversation } from "@/app/api/conversations/[id]/route";

const fake = new FakeOutboundProvider();
const RES = "res-reconcile-1";
const BODY = "Havluları getiriyoruz.";
const rowOf = (id: string) => prisma.messageOutbox.findUniqueOrThrow({ where: { id } });

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  session = { userId: "u1", organizationId: orgId, role: "owner", email: "o@t.com", name: "Owner", sessionEpoch: 0 } as SessionPayload;
  const conversation = await prisma.conversation.create({
    data: { propertyId, channel: "airbnb", guestIdentifier: "Alex", status: "waiting", externalReservationId: RES },
  });
  fake.registerReservation(RES, "tok-A");
  return { orgId, conversationId: conversation.id };
}
const enqueue = (orgId: string, conversationId: string, key: string, body = BODY) =>
  enqueueOutbound({
    organizationId: orgId,
    conversationId,
    channel: "airbnb",
    externalReservationId: RES,
    reservationId: null,
    body,
    senderName: "Host",
    authorType: "host",
    messageType: "manual",
    idempotencyKey: key,
  });
const reply = (conversationId: string, body = BODY) =>
  replyRoute(
    new NextRequest(`http://localhost/api/conversations/${conversationId}/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body, senderName: "Owner" }),
    }),
    { params: Promise.resolve({ id: conversationId }) },
  );

/** Kuyruğu saat ilerleterek bütün uzlaştırma bakışları bitene kadar çalıştır. */
async function drainUntilSettled(clock: { t: number }) {
  const now = () => new Date(clock.t);
  for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 3; i++) {
    await drainOutboxOnce({ now });
    clock.t += 60 * 60_000;
  }
}

describe("kuyruk — belirsiz gönderimde Lixus kanalı okur", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    fake.reset();
    tokenFor.mockResolvedValue("tok-A");
    __setOutboundAdapterForTest("hospitable", fake.adapter());
    vi.stubEnv("CHANNEL_SEND_RECONCILE_ENABLED", "1");
  });
  afterEach(() => {
    __setOutboundAdapterForTest("hospitable", null);
    vi.unstubAllEnvs();
  });

  it("🚨 kanal KABUL ETTİ, yanıt kayboldu → uzlaştırma kanalda metni görür: 'gönderildi' (kanıt: kanalda görüldü), yerel mesaj kanal kimliğini alır; ikinci istek YOK", async () => {
    const { orgId, conversationId } = await seed();
    const { outboxId, messageId } = await enqueue(orgId, conversationId, "k1");
    fake.behave({ mode: "timeout", delivered: true });
    const clock = { t: Date.now() };
    await drainOutboxOnce({ now: () => new Date(clock.t) });
    expect(await rowOf(outboxId)).toMatchObject({ status: "ambiguous" });
    fake.behave({ mode: "succeed" });
    await drainUntilSettled(clock);
    const row = await rowOf(outboxId);
    expect(row).toMatchObject({ status: "sent", providerMessageId: fake.deliveries[0]!.providerMessageId, lastErrorCode: RECONCILE_CODES.seenByContent });
    expect(row.reconciledAt).not.toBeNull();
    expect((await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).externalId).toBe(fake.deliveries[0]!.providerMessageId);
    expect(fake.attempts).toHaveLength(1); // ⬅️ kör tekrar YOK
    expect(fake.deliveries).toHaveLength(1);
    expect(fake.threadReads).toBeGreaterThan(0);
  });

  it("🚨 istek ULAŞMADI → Lixus baktı, görmedi: bütün bakışlar bitince inceleme sebebi 'kanalda görünmüyor'; yeniden gönderim YOK", async () => {
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueue(orgId, conversationId, "k2");
    fake.behave({ mode: "timeout", delivered: false });
    const clock = { t: Date.now() };
    await drainOutboxOnce({ now: () => new Date(clock.t) });
    fake.behave({ mode: "succeed" });
    await drainUntilSettled(clock);
    expect(await rowOf(outboxId)).toMatchObject({ status: "review", lastErrorCode: RECONCILE_CODES.notSeen });
    expect(fake.attempts).toHaveLength(1);
    expect(fake.deliveries).toHaveLength(0);
  });

  it("kanal OKUNAMIYOR → karar yok; bakışlar bitince sebep 'kanal okunamadı' (yalnız burada 'ulaşmış olabilir' dürüst)", async () => {
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueue(orgId, conversationId, "k3");
    fake.behave({ mode: "timeout", delivered: true });
    fake.threadDown = true;
    const clock = { t: Date.now() };
    await drainOutboxOnce({ now: () => new Date(clock.t) });
    await drainUntilSettled(clock);
    expect(await rowOf(outboxId)).toMatchObject({ status: "review", lastErrorCode: RECONCILE_CODES.unreadable });
    expect(fake.attempts).toHaveLength(1);
  });

  it("🚨 aynı metin kanalda ama BAŞKA bir kayda ait (ev sahibinin önceki aynı cevabı yerelde başka mesaja bağlı) → doğrulamaz", async () => {
    const { orgId, conversationId } = await seed();
    // Ev sahibi aynı metni daha önce de göndermişti: kanalda görünüyor ve yerelde o mesaja bağlı.
    fake.threadExtra.set(RES, [{ externalId: "host-old-1", direction: "outbound", body: BODY, createdAt: new Date() }]);
    await prisma.message.create({ data: { conversationId, direction: "outbound", authorType: "host", senderName: "Owner", body: BODY, externalId: "host-old-1", deliveryPath: "direct" } });
    const { outboxId } = await enqueue(orgId, conversationId, "k4");
    fake.behave({ mode: "timeout", delivered: false });
    const clock = { t: Date.now() };
    await drainOutboxOnce({ now: () => new Date(clock.t) });
    await drainUntilSettled(clock);
    expect(await rowOf(outboxId)).toMatchObject({ status: "review", lastErrorCode: RECONCILE_CODES.notSeen });
  });

  it("🚨 aynı metin kanalda ama BAŞKA BİR KUYRUK SATIRININ kimliği (yerelde mesaja bağlanmamış) → doğrulamaz (mutasyon 11-19)", async () => {
    const { orgId, conversationId } = await seed();
    // Önceki gönderim kuyruktan gitti ve kimliği kendi satırında; yerel mesajına henüz yazılmadı.
    const other = await enqueue(orgId, conversationId, "k7-other");
    await prisma.messageOutbox.update({ where: { id: other.outboxId }, data: { status: "sent", providerMessageId: "host-other-1" } });
    fake.threadExtra.set(RES, [{ externalId: "host-other-1", direction: "outbound", body: BODY, createdAt: new Date() }]);
    const { outboxId } = await enqueue(orgId, conversationId, "k7");
    fake.behave({ mode: "timeout", delivered: false });
    const clock = { t: Date.now() };
    await drainOutboxOnce({ now: () => new Date(clock.t) });
    await drainUntilSettled(clock);
    expect(await rowOf(outboxId)).toMatchObject({ status: "review", lastErrorCode: RECONCILE_CODES.notSeen });
    expect(fake.attempts.filter((x) => x.body === BODY).length).toBeLessThanOrEqual(1);
  });

  it("🚨 senkron kanaldaki mesajı bu satırın KENDİ yerel mesajına bağlamışsa (kimlik yerelde ona yazılı) yine doğrulanır — kendi kimliği 'başka kayıt' sayılmaz (mutasyon 11-19)", async () => {
    const { orgId, conversationId } = await seed();
    const { outboxId, messageId } = await enqueue(orgId, conversationId, "k8");
    fake.behave({ mode: "timeout", delivered: true });
    const clock = { t: Date.now() };
    await drainOutboxOnce({ now: () => new Date(clock.t) });
    expect(await rowOf(outboxId)).toMatchObject({ status: "ambiguous" });
    // Senkron yankıyı kendi satırına bağladı (adopt-and-heal).
    await prisma.message.update({ where: { id: messageId! }, data: { externalId: fake.deliveries[0]!.providerMessageId } });
    await drainUntilSettled(clock);
    expect(await rowOf(outboxId)).toMatchObject({ status: "sent", providerMessageId: fake.deliveries[0]!.providerMessageId });
    expect(fake.attempts).toHaveLength(1);
  });

  it("🚨 zaman çapası KUYRUĞA GİRİŞ değil DIŞ GÖNDERİM BAŞLANGICI: arada ev sahibinin kanaldan elle yazdığı aynı metin bu gönderimi doğrulamaz (mutasyon 11-19)", async () => {
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueue(orgId, conversationId, "k9");
    const now = Date.now();
    // Satır bir saat önce kuyruğa girmiş; ev sahibi yarım saat önce aynı metni kanaldan elle yazmış; gönderim ŞİMDİ başlıyor ve ulaşmıyor.
    await prisma.messageOutbox.update({ where: { id: outboxId }, data: { createdAt: new Date(now - 60 * 60_000) } });
    fake.threadExtra.set(RES, [{ externalId: "host-manual-1", direction: "outbound", body: BODY, createdAt: new Date(now - 30 * 60_000) }]);
    fake.behave({ mode: "timeout", delivered: false });
    const clock = { t: now };
    await drainOutboxOnce({ now: () => new Date(clock.t) });
    expect((await rowOf(outboxId)).dispatchStartedAt).not.toBeNull();
    await drainUntilSettled(clock);
    expect(await rowOf(outboxId)).toMatchObject({ status: "review", lastErrorCode: RECONCILE_CODES.notSeen });
  });

  it("🚨 KU-1: gönderim yoldayken konuşma silindi, kanal kabul etti, yanıt kayboldu → satır yine kanaldan doğrulanır (konuşmaya bağlı değil)", async () => {
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueue(orgId, conversationId, "k5");
    let deleted = false;
    fake.behave({ mode: "timeout", delivered: true });
    const real = fake.adapter();
    __setOutboundAdapterForTest("hospitable", {
      ...real,
      send: async (...args) => {
        // İstek sağlayıcıya çıkarken ev sahibi konuşmayı siliyor.
        if (!deleted) {
          deleted = true;
          await deleteConversation(new NextRequest(`http://localhost/api/conversations/${conversationId}`, { method: "DELETE" }), {
            params: Promise.resolve({ id: conversationId }),
          });
        }
        return real.send(...args);
      },
    });
    const clock = { t: Date.now() };
    await drainOutboxOnce({ now: () => new Date(clock.t) });
    expect(await prisma.conversation.count({ where: { id: conversationId } })).toBe(0);
    await drainUntilSettled(clock);
    expect(await rowOf(outboxId)).toMatchObject({ status: "sent", lastErrorCode: RECONCILE_CODES.seenByContent });
    expect(fake.deliveries).toHaveLength(1);
    expect(fake.attempts).toHaveLength(1);
  });

  it("KONTROL: anahtar KAPALI → bugünkü davranış: kanal OKUNMAZ, inceleme kanıt kodu taşımaz", async () => {
    vi.stubEnv("CHANNEL_SEND_RECONCILE_ENABLED", "");
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueue(orgId, conversationId, "k6");
    fake.behave({ mode: "timeout", delivered: true });
    const clock = { t: Date.now() };
    await drainOutboxOnce({ now: () => new Date(clock.t) });
    await drainUntilSettled(clock);
    const row = await rowOf(outboxId);
    expect(row.status).toBe("review");
    // Satırda belirsiz gönderimin kendi hata kodu kalır (bugünkü gibi); uzlaştırma kanıt kodu YAZILMAZ.
    expect(Object.values(RECONCILE_CODES)).not.toContain(row.lastErrorCode);
    expect(fake.threadReads).toBe(0);
  });
});

describe("doğrudan yol — belirsiz sonuçtan hemen sonra tek bakış", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    fake.reset();
    tokenFor.mockResolvedValue("tok-A");
    __setOutboundAdapterForTest("hospitable", fake.adapter());
    vi.stubEnv("CHANNEL_SEND_RECONCILE_ENABLED", "1");
  });
  afterEach(() => {
    __setOutboundAdapterForTest("hospitable", null);
    vi.unstubAllEnvs();
  });

  it("🚨 kanal kabul etti, yanıt kayboldu → cevap rotası 'gönderildi' (201) der; mesaj kanal kimliğiyle kaydedilir; ikinci istek YOK", async () => {
    const { conversationId } = await seed();
    fake.behave({ mode: "timeout", delivered: true });
    const res = await reply(conversationId);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ delivery: "channel_accepted", externalId: fake.deliveries[0]!.providerMessageId });
    expect(fake.attempts).toHaveLength(1);
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound" } })).toBe(1);
  });

  it("🚨 istek ulaşmadı → bugünkü belirsiz yanıt (502, 'doğrulanamadı'); ikinci istek YOK", async () => {
    const { conversationId } = await seed();
    fake.behave({ mode: "timeout", delivered: false });
    const res = await reply(conversationId);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ambiguous: true });
    expect(fake.attempts).toHaveLength(1);
  });

  it("🚨 aynı metin kanalda ama gönder'e basılmadan ÖNCE yazılmış (ev sahibinin kanaldan elle gönderdiği eski mesaj) → doğrulamaz, 502", async () => {
    const { conversationId } = await seed();
    fake.threadExtra.set(RES, [{ externalId: "host-typed-1", direction: "outbound", body: BODY, createdAt: new Date(Date.now() - 10 * 60_000) }]);
    fake.behave({ mode: "timeout", delivered: false });
    expect((await reply(conversationId)).status).toBe(502);
  });

  it("KONTROL: anahtar KAPALI → bugünkü belirsiz yanıt, kanal okunmaz", async () => {
    vi.stubEnv("CHANNEL_SEND_RECONCILE_ENABLED", "");
    const { conversationId } = await seed();
    fake.behave({ mode: "timeout", delivered: true });
    expect((await reply(conversationId)).status).toBe(502);
    expect(fake.threadReads).toBe(0);
  });

  it("KONTROL: kesin ret (422) bakışa girmez — kanal okunmaz, 'gönderilemedi'", async () => {
    const { conversationId } = await seed();
    fake.behave({ mode: "reject", status: 422 });
    expect((await reply(conversationId)).status).toBe(502);
    expect(fake.threadReads).toBe(0);
  });
});
