import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// V0.1 KABUL — ÜÇ ÜRETİM YOLU DA AYNI DISPATCH SINIRINDAN GEÇER
//
// Envanter şartı: "mevcut çalışan üretim yollarından en az biri gerçekten yeni
// sınırdan geçmeli". Burada ÜÇÜ birden ölçülür: (1) durable outbox worker'ı
// VARSAYILAN bağımlılıklarıyla, (2) satır içi `sendOnChannel` (oto-yanıt /
// holding-ack / lifecycle bunu çağırır — lifecycle welcome gerçek fonksiyonla),
// (3) elle yanıt rotası (bayrak KAPALI, claim-then-send). Hepsi Hospitable
// istemcisine DEĞİL, kayıtlı adaptöre gider.
//
// Sızıntı dedektörü: `@/lib/hospitable` mock'lu — sahte adaptör kayıtlıyken
// istemciye ulaşan HER çağrı görünür. Shadow-compare: gerçek adaptörle istemci
// ESKİ argüman sözleşmesiyle çağrılır (`(id, body, token, { retries: 0 })`).
//
// Kimlik bilgisi çözümü (`getOrgHospitableToken`) V0.1'de değişmedi → mock'lu;
// V0.3 (ChannelConnection) o sınırı taşıyacak.
// ---------------------------------------------------------------------------
vi.mock("@/lib/hospitable", () => ({
  sendMessage: vi.fn(async () => ({ ok: false, error: "LEAK: real provider client reached" })),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn(async () => "tok-org"),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { sendMessage } from "@/lib/hospitable";
import { __setOutboundAdapterForTest, type OutboundAdapter, type OutboundSendResult } from "@/lib/channels";
import { sendOnChannel } from "@/lib/messaging";
import { enqueueOutbound } from "@/lib/outbox/enqueue";
import { drainOutboxOnce } from "@/lib/outbox/worker";
import { sendDueWelcomes } from "@/lib/automation";
import { __resetRateLimit } from "@/lib/rate-limit";
import { POST as replyRoute } from "@/app/api/conversations/[id]/reply/route";

const mockClient = vi.mocked(sendMessage);

function fakeAdapter(result: Partial<OutboundSendResult> = {}) {
  const send = vi.fn<OutboundAdapter["send"]>(async () => ({
    ok: true,
    kind: "definitive_success",
    providerMessageId: "FAKE-1",
    ...result,
  }));
  const adapter: OutboundAdapter = { provider: "hospitable", capabilities: new Set(["messages.send"]), send };
  __setOutboundAdapterForTest("hospitable", adapter);
  return send;
}

async function seedConversation(externalReservationId: string | null = "res-uuid-1") {
  const { orgId, propertyId } = await makeOrgWithProperty();
  session = { userId: "u1", organizationId: orgId, role: "owner", email: "o@t.com", name: "Owner", sessionEpoch: 0 } as SessionPayload;
  const conversation = await prisma.conversation.create({
    data: { propertyId, channel: "airbnb", guestIdentifier: "Alex", status: "waiting", externalReservationId },
  });
  return { orgId, propertyId, conversationId: conversation.id };
}

describe("V0.1 outbound dispatch — üç üretim yolu", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetRateLimit();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    __setOutboundAdapterForTest("hospitable", null);
    vi.unstubAllEnvs();
  });

  it("🚨 (1) worker — VARSAYILAN bağımlılıklarla adaptöre gider, istemciye değil", async () => {
    const send = fakeAdapter();
    const { orgId, conversationId } = await seedConversation();
    const { outboxId, messageId } = await enqueueOutbound({
      organizationId: orgId, conversationId, channel: "airbnb", externalReservationId: "res-uuid-1",
      reservationId: null, body: "Merhaba!", senderName: "Host", authorType: "host", messageType: "manual", idempotencyKey: "k1",
    });

    const out = await drainOutboxOnce({}); // send/tokenFor override YOK

    expect(mockClient).not.toHaveBeenCalled(); // ⬅️ ARIZADA: defaultSend doğrudan istemciyi çağırıyordu
    expect(send).toHaveBeenCalledTimes(1);
    const [dest, body, cred] = send.mock.calls[0];
    expect(dest).toEqual({ provider: "hospitable", externalReservationId: "res-uuid-1" });
    expect(body).toBe("Merhaba!");
    expect(cred).toEqual({ provider: "hospitable", token: "tok-org" }); // varsayılan tokenFor → org token'ı
    expect(out.sent).toBe(1);
    expect(await prisma.messageOutbox.findUniqueOrThrow({ where: { id: outboxId } })).toMatchObject({ status: "sent", providerMessageId: "FAKE-1" });
    expect((await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).externalId).toBe("FAKE-1");
  });

  it("🚨 (2) sendOnChannel — dış hedef adaptöre; qr-chat ve boş hedef LOCAL (adaptör çağrılmaz)", async () => {
    const send = fakeAdapter();
    const ext = await sendOnChannel({ channel: "airbnb", guestIdentifier: "Alex", externalReservationId: "res-9" }, "Selam", "tok-x");
    expect(ext).toMatchObject({ ok: true, providerMessageId: "FAKE-1" });
    expect(send).toHaveBeenCalledWith(
      { provider: "hospitable", externalReservationId: "res-9" },
      "Selam",
      { provider: "hospitable", token: "tok-x" },
    );
    expect(mockClient).not.toHaveBeenCalled();

    send.mockClear();
    const qr = await sendOnChannel({ channel: "chat", guestIdentifier: "QR", externalReservationId: "qr-chat:prop-1" }, "Yardım", "tok-x");
    expect(qr).toEqual({ ok: true, skipped: true });
    const none = await sendOnChannel({ channel: "manual", guestIdentifier: "Ali" }, "Not");
    expect(none).toEqual({ ok: true, skipped: true });
    expect(send).not.toHaveBeenCalled();
  });

  it("🚨 (2b) lifecycle welcome (gerçek sendDueWelcomes, bayrak KAPALI) adaptörden geçer", async () => {
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    const send = fakeAdapter();
    const org = await prisma.organization.create({
      data: { name: "Org", autoWelcome: true, autoWelcomeEnabledAt: new Date(0), aiSignature: "Sevgiler,\nİsa" },
    });
    const property = await prisma.property.create({ data: { organizationId: org.id, name: "nuve 3" } });
    await prisma.knowledgeBaseItem.create({
      data: { propertyId: property.id, category: "welcome", title: "Karşılama", content: "Daire 3 — Wifi: NUVE/1234" },
    });
    const istToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const arrival = new Date(`${istToday}T12:00:00Z`);
    await prisma.reservation.create({
      data: {
        propertyId: property.id, guestName: "Bircan Yılmaz", arrivalDate: arrival,
        departureDate: new Date(arrival.getTime() + 2 * 86_400_000), channel: "airbnb", status: "confirmed", sourceReference: "res-w-1",
      },
    });

    const out = await sendDueWelcomes(org.id);

    expect(out.sent).toBe(1);
    expect(mockClient).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual({ provider: "hospitable", externalReservationId: "res-w-1" });
    expect(send.mock.calls[0][1]).toContain("Merhaba Bircan");
    expect(send.mock.calls[0][2]).toEqual({ provider: "hospitable", token: "tok-org" });
  });

  it("🚨 (3) elle yanıt rotası (bayrak KAPALI, claim-then-send) adaptörden geçer", async () => {
    const send = fakeAdapter();
    const { conversationId } = await seedConversation();
    const req = new NextRequest(`http://localhost/api/conversations/${conversationId}/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Elle yanıt", senderName: "Owner" }),
    });
    const res = await replyRoute(req, { params: Promise.resolve({ id: conversationId }) });
    expect(res.status).toBeLessThan(300);
    expect(mockClient).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual({ provider: "hospitable", externalReservationId: "res-uuid-1" });
    expect(send.mock.calls[0][2]).toEqual({ provider: "hospitable", token: "tok-org" });
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound", externalId: "FAKE-1" } })).toBe(1);
  });

  it("worker: iç thread (qr-chat) satırı LOCAL — adaptör de istemci de çağrılmaz, satır sent (id yok)", async () => {
    // Tek semantik sıkılaştırma (belgeli): eski defaultSend bu öneke BAKMIYORDU ve
    // sentetik id'yi POST ederdi (ulaşılmaz — enqueue yolları iç thread'i almaz).
    const send = fakeAdapter();
    const { orgId, conversationId } = await seedConversation("qr-chat:prop-1");
    const { outboxId } = await enqueueOutbound({
      organizationId: orgId, conversationId, channel: "chat", externalReservationId: "qr-chat:prop-1",
      reservationId: null, body: "İç", senderName: "Host", authorType: "host", messageType: "manual", idempotencyKey: "kq",
    });
    await drainOutboxOnce({});
    expect(send).not.toHaveBeenCalled();
    expect(mockClient).not.toHaveBeenCalled();
    expect(await prisma.messageOutbox.findUniqueOrThrow({ where: { id: outboxId } })).toMatchObject({ status: "sent", providerMessageId: null });
  });

  it("🚨 tipli sonuç worker'a ulaşır — `kind` METİNSİZ de sınıflandırır (rate_limited / blocked)", async () => {
    // Gelecek adaptörün argümanı: hata metni Hospitable biçiminde OLMAYACAK; worker
    // `kind`e güvenmeli, regex'e değil.
    const send = fakeAdapter({ ok: false, kind: "rate_limited", retryAfterSec: 30, error: null, providerMessageId: null });
    const { orgId, conversationId } = await seedConversation();
    const { outboxId } = await enqueueOutbound({
      organizationId: orgId, conversationId, channel: "airbnb", externalReservationId: "res-uuid-1",
      reservationId: null, body: "M", senderName: "Host", authorType: "host", messageType: "manual", idempotencyKey: "kr",
    });
    const t0 = Date.now();
    await drainOutboxOnce({});
    const row = await prisma.messageOutbox.findUniqueOrThrow({ where: { id: outboxId } });
    expect(row.status).toBe("pending");
    expect(row.lastErrorKind).toBe("rate_limited"); // ⬅️ regex'e kalsaydı: "ambiguous"
    expect(row.attemptCount).toBe(0); // 429 deneme tüketmez
    expect(row.availableAt.getTime()).toBeGreaterThanOrEqual(t0 + 29_000); // Retry-After'a ertelendi

    send.mockImplementation(async () => ({ ok: false, kind: "blocked", error: null, providerMessageId: null }));
    await prisma.messageOutbox.update({ where: { id: outboxId }, data: { availableAt: new Date(0) } });
    await drainOutboxOnce({});
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: outboxId } })).status).toBe("blocked");
  });
});

describe("V0.1 shadow-compare — gerçek adaptör istemciyi ESKİ argüman sözleşmesiyle çağırır", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __setOutboundAdapterForTest("hospitable", null); // gerçek (kayıtlı) adaptör
    mockClient.mockResolvedValue({ ok: true, id: "PROV-7" });
  });

  it("worker varsayılan yolu: sendMessage(id, body, token, { retries: 0 }) — birebir eski", async () => {
    const { orgId, conversationId } = await seedConversation();
    const { outboxId } = await enqueueOutbound({
      organizationId: orgId, conversationId, channel: "airbnb", externalReservationId: "res-uuid-1",
      reservationId: null, body: "Merhaba!", senderName: "Host", authorType: "host", messageType: "manual", idempotencyKey: "ks",
    });
    await drainOutboxOnce({});
    expect(mockClient).toHaveBeenCalledTimes(1);
    expect(mockClient).toHaveBeenCalledWith("res-uuid-1", "Merhaba!", "tok-org", { retries: 0 });
    expect(await prisma.messageOutbox.findUniqueOrThrow({ where: { id: outboxId } })).toMatchObject({ status: "sent", providerMessageId: "PROV-7" });
  });

  it("sendOnChannel: aynı sözleşme; token undefined OLDUĞU GİBİ iletilir (env fallback VARKEN — kurucu legacy yolu)", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "env-tok");
    const out = await sendOnChannel({ channel: "airbnb", guestIdentifier: "Alex", externalReservationId: "res-1" }, "Merhaba");
    expect(out).toMatchObject({ ok: true, providerMessageId: "PROV-7" });
    expect(mockClient).toHaveBeenCalledWith("res-1", "Merhaba", undefined, { retries: 0 });
  });

  it("sendOnChannel: token da env de YOKSA istemci çağrılmaz — definitive_failure (V0.2 uyum kiti bulgusu)", async () => {
    vi.stubEnv("HOSPITABLE_API_TOKEN", "");
    const out = await sendOnChannel({ channel: "airbnb", guestIdentifier: "Alex", externalReservationId: "res-1" }, "Merhaba");
    expect(out).toMatchObject({ ok: false, kind: "definitive_failure" });
    expect(mockClient).not.toHaveBeenCalled();
  });

  it("gerçek adaptör 429'u tipler: HTTP durumu → rate_limited, Retry-After worker'a taşınır", async () => {
    mockClient.mockResolvedValueOnce({ ok: false, error: "Hospitable API hatası (HTTP 429): slow down", status: 429, retryAfterSec: 45 });
    const { orgId, conversationId } = await seedConversation();
    const { outboxId } = await enqueueOutbound({
      organizationId: orgId, conversationId, channel: "airbnb", externalReservationId: "res-uuid-1",
      reservationId: null, body: "M", senderName: "Host", authorType: "host", messageType: "manual", idempotencyKey: "k429",
    });
    const t0 = Date.now();
    await drainOutboxOnce({});
    const row = await prisma.messageOutbox.findUniqueOrThrow({ where: { id: outboxId } });
    expect(row).toMatchObject({ status: "pending", lastErrorKind: "rate_limited", lastErrorCode: "HTTP 429", attemptCount: 0 });
    expect(row.availableAt.getTime()).toBeGreaterThanOrEqual(t0 + 44_000);
  });
});
