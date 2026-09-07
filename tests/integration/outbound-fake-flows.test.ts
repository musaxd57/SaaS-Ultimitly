import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { FakeOutboundProvider } from "../helpers/fake-channel";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// ÇEKİRDEK AKIŞLARI × ORTAK FAKE (V0.2) — sağlayıcı-tarafı gerçeğiyle ölçüm.
//
// Fake, misafire GERÇEKTEN ulaşan mesajları sayar (`deliveries`). Bu dosyanın
// iddiaları durum kodları değil, o sayıdır: yinelenen istek → 1 teslim; belirsiz
// gönderim (POST ulaştı, yanıt kayboldu) → 1 teslim ve ASLA kör tekrar; bağlantı
// kesik → 0 deneme; kiracı sınırı → 0 teslim. Gerçek worker, gerçek rotalar,
// gerçek DB; yalnız sağlayıcı (fake), org token'ı, e-posta ve oturum sahte.
// ---------------------------------------------------------------------------
const { tokenFor } = vi.hoisted(() => ({
  tokenFor: vi.fn<(orgId: string) => Promise<string | null>>(async () => "tok-A"),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: tokenFor }));
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
import { drainOutboxOnce, reactivateBlockedOutbox } from "@/lib/outbox/worker";
import { OUTBOX_MAX_ATTEMPTS } from "@/lib/outbox/state";
import { __resetRateLimit } from "@/lib/rate-limit";
import { POST as replyRoute } from "@/app/api/conversations/[id]/reply/route";

const fake = new FakeOutboundProvider();
const RES = "res-flow-1";
const row = (id: string) => prisma.messageOutbox.findUniqueOrThrow({ where: { id } });

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  session = { userId: "u1", organizationId: orgId, role: "owner", email: "o@t.com", name: "Owner", sessionEpoch: 0 } as SessionPayload;
  const conversation = await prisma.conversation.create({
    data: { propertyId, channel: "airbnb", guestIdentifier: "Alex", status: "waiting", externalReservationId: RES },
  });
  fake.registerReservation(RES, "tok-A");
  return { orgId, conversationId: conversation.id };
}
const enqueue = (orgId: string, conversationId: string, key: string, body = "Merhaba!") =>
  enqueueOutbound({
    organizationId: orgId, conversationId, channel: "airbnb", externalReservationId: RES, reservationId: null,
    body, senderName: "Host", authorType: "host", messageType: "manual", idempotencyKey: key,
  });
const replyReq = (id: string, body: string) =>
  new NextRequest(`http://localhost/api/conversations/${id}/reply`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body, senderName: "Owner" }),
  });

describe("worker × fake sağlayıcı", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    fake.reset();
    tokenFor.mockResolvedValue("tok-A");
    __setOutboundAdapterForTest("hospitable", fake.adapter());
  });
  afterEach(() => __setOutboundAdapterForTest("hospitable", null));

  it("başarı: satır sent, Message.externalId sağlayıcı id'si, teslim 1", async () => {
    const { orgId, conversationId } = await seed();
    const { outboxId, messageId } = await enqueue(orgId, conversationId, "k1");
    await drainOutboxOnce({});
    expect(fake.deliveries).toHaveLength(1);
    expect(await row(outboxId)).toMatchObject({ status: "sent", providerMessageId: fake.deliveries[0].providerMessageId });
    expect((await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).externalId).toBe(fake.deliveries[0].providerMessageId);
  });

  it("🚨 yinelenen istek: aynı idempotencyKey iki kez enqueue → sağlayıcıya 1 teslim (sağlayıcı dedupe yapmadığı hâlde)", async () => {
    const { orgId, conversationId } = await seed();
    const a = await enqueue(orgId, conversationId, "same-key");
    const b = await enqueue(orgId, conversationId, "same-key");
    expect(b.deduped).toBe(true);
    expect(b.outboxId).toBe(a.outboxId);
    await drainOutboxOnce({});
    await drainOutboxOnce({});
    expect(fake.deliveries).toHaveLength(1);
  });

  it("🚨 belirsiz gönderim (POST ulaştı, yanıt kayboldu): satır ambiguous → review; sağlayıcıya ASLA ikinci POST yok", async () => {
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueue(orgId, conversationId, "k-amb");
    fake.behave({ mode: "timeout", delivered: true });
    let clock = Date.now();
    const now = () => new Date(clock);
    await drainOutboxOnce({ now });
    expect(await row(outboxId)).toMatchObject({ status: "ambiguous" });
    expect(fake.deliveries).toHaveLength(1); // misafir mesajı ALDI
    // Sonraki geçişler reconcile eder (varsayılan: sağlayıcı geçmişinden doğrulanamaz) → review.
    fake.behave({ mode: "succeed" }); // sağlayıcı düzelse bile...
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 2; i++) {
      clock += 60 * 60_000;
      await drainOutboxOnce({ now });
    }
    expect(await row(outboxId)).toMatchObject({ status: "review" });
    expect(fake.attempts).toHaveLength(1); // ⬅️ kör tekrar olsaydı 2+ olurdu
    expect(fake.deliveries).toHaveLength(1);
  });

  it("zaman aşımı (POST ulaşmadı) da aynı sözleşme: ambiguous, kör tekrar yok — kayıp insana gider (review)", async () => {
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueue(orgId, conversationId, "k-lost");
    fake.behave({ mode: "timeout", delivered: false });
    let clock = Date.now();
    const now = () => new Date(clock);
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 3; i++) {
      await drainOutboxOnce({ now });
      clock += 60 * 60_000;
    }
    expect(await row(outboxId)).toMatchObject({ status: "review" });
    expect(fake.attempts).toHaveLength(1);
    expect(fake.deliveries).toHaveLength(0);
  });

  it("429: Retry-After'a ertelenir, deneme tüketilmez; pencere geçince TEK teslim", async () => {
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueue(orgId, conversationId, "k-429");
    fake.behave({ mode: "rate_limit", retryAfterSec: 30 });
    let clock = Date.now();
    const now = () => new Date(clock);
    await drainOutboxOnce({ now });
    const r1 = await row(outboxId);
    expect(r1).toMatchObject({ status: "pending", lastErrorKind: "rate_limited", attemptCount: 0 });
    expect(r1.availableAt.getTime()).toBeGreaterThanOrEqual(clock + 29_000);
    fake.behave({ mode: "succeed" });
    clock += 31_000;
    await drainOutboxOnce({ now });
    expect(await row(outboxId)).toMatchObject({ status: "sent" });
    expect(fake.deliveries).toHaveLength(1);
  });

  it("402: blocked'a park; abonelik dönünce (reactivate) TEK teslim", async () => {
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueue(orgId, conversationId, "k-402");
    fake.behave({ mode: "blocked" });
    await drainOutboxOnce({});
    expect(await row(outboxId)).toMatchObject({ status: "blocked" });
    await drainOutboxOnce({}); // blocked satır yeniden claim edilmez
    expect(fake.attempts).toHaveLength(1);
    fake.behave({ mode: "succeed" });
    expect(await reactivateBlockedOutbox(orgId)).toBe(1);
    await drainOutboxOnce({});
    expect(await row(outboxId)).toMatchObject({ status: "sent" });
    expect(fake.deliveries).toHaveLength(1);
  });

  it("🚨 bağlantı kesildi (org token'ı yok): sağlayıcıya SIFIR deneme, satır bekler; bağlanınca teslim", async () => {
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueue(orgId, conversationId, "k-disc");
    tokenFor.mockResolvedValue(null);
    let clock = Date.now();
    const now = () => new Date(clock);
    await drainOutboxOnce({ now });
    expect(fake.attempts).toHaveLength(0);
    expect(await row(outboxId)).toMatchObject({ status: "pending", lastErrorKind: "disconnected", attemptCount: 0 });
    tokenFor.mockResolvedValue("tok-A");
    clock += 60 * 60_000;
    await drainOutboxOnce({ now });
    expect(await row(outboxId)).toMatchObject({ status: "sent" });
    expect(fake.deliveries).toHaveLength(1);
  });

  it("sağlayıcıda yetki iptali (401): definitive → backoff → failed; teslim 0 (V0.3: auth_revoked sınıfı)", async () => {
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueue(orgId, conversationId, "k-401");
    fake.behave({ mode: "reject", status: 401 });
    let clock = Date.now();
    const now = () => new Date(clock);
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 2; i++) {
      await drainOutboxOnce({ now });
      clock += 60 * 60_000;
    }
    expect(await row(outboxId)).toMatchObject({ status: "failed", lastErrorKind: "definitive_failure" });
    expect(fake.deliveries).toHaveLength(0);
  });

  it("🚨 kiracı sınırı: hedef rezervasyon BAŞKA hesabın → sağlayıcı reddeder, teslim 0", async () => {
    const { orgId, conversationId } = await seed();
    fake.registerReservation(RES, "tok-of-tenant-B"); // sahiplik B'de; bizim token tok-A
    const { outboxId } = await enqueue(orgId, conversationId, "k-tenant");
    await drainOutboxOnce({});
    expect(fake.deliveries).toHaveLength(0);
    expect(await row(outboxId)).toMatchObject({ status: "pending", lastErrorKind: "definitive_failure", lastErrorCode: "HTTP 404" });
  });
});

describe("elle yanıt rotası × fake sağlayıcı (bayrak KAPALI, claim-then-send)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    fake.reset();
    tokenFor.mockResolvedValue("tok-A");
    __setOutboundAdapterForTest("hospitable", fake.adapter());
  });
  afterEach(() => __setOutboundAdapterForTest("hospitable", null));

  it("başarı → 2xx, teslim 1; AYNI metin hemen tekrar (çift tık) → 409, teslim hâlâ 1", async () => {
    const { conversationId } = await seed();
    const r1 = await replyRoute(replyReq(conversationId, "Selam"), { params: Promise.resolve({ id: conversationId }) });
    expect(r1.status).toBeLessThan(300);
    const r2 = await replyRoute(replyReq(conversationId, "Selam"), { params: Promise.resolve({ id: conversationId }) });
    expect(r2.status).toBe(409);
    expect(fake.deliveries).toHaveLength(1);
  });

  it("🚨 belirsiz gönderim (POST ulaştı, yanıt kayboldu) → 502 'doğrulanmadı', claim TUTULUR; tekrar denemesi 409 → teslim 1", async () => {
    const { conversationId } = await seed();
    fake.behave({ mode: "timeout", delivered: true });
    const r1 = await replyRoute(replyReq(conversationId, "Selam"), { params: Promise.resolve({ id: conversationId }) });
    expect(r1.status).toBe(502);
    expect(fake.deliveries).toHaveLength(1);
    fake.behave({ mode: "succeed" });
    const r2 = await replyRoute(replyReq(conversationId, "Selam"), { params: Promise.resolve({ id: conversationId }) });
    expect(r2.status).toBe(409); // claim hâlâ tutuluyor → kör tekrar yok
    expect(fake.deliveries).toHaveLength(1);
  });

  it("KONTROL: kesin ret (422) → claim serbest, aynı metin hemen tekrar denenebilir", async () => {
    const { conversationId } = await seed();
    fake.behave({ mode: "reject", status: 422 });
    const r1 = await replyRoute(replyReq(conversationId, "Selam"), { params: Promise.resolve({ id: conversationId }) });
    expect(r1.status).toBeGreaterThanOrEqual(400);
    fake.behave({ mode: "succeed" });
    const r2 = await replyRoute(replyReq(conversationId, "Selam"), { params: Promise.resolve({ id: conversationId }) });
    expect(r2.status).toBeLessThan(300);
    expect(fake.deliveries).toHaveLength(1);
  });
});
