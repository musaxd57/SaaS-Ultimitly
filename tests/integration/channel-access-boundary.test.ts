import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { FakeOutboundProvider } from "../helpers/fake-channel";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// V0.8 — ÇEKİRDEK, KİMLİK BİLGİSİNİ KANAL KATMANINDAN ALIR (davranışsal kanıt; yapısal kardeş:
// tests/unit/core-channel-independence.test.ts).
//
// Bu dosya `@/lib/hospitable-credentials`'ı MOCK'LAMAZ: kayıtlı Hospitable çözücüsünün ÜSTÜNE sahte bir erişim konur
// (`__setMessagingAccessForTest`). Çekirdek yol sınırı atlayıp sağlayıcı modülünü doğrudan çağırsaydı sahte erişim hiç
// sorulmaz, gerçek modül bu org için kimlik bilgisi bulamaz (DB'de token yok, env yok) → teslim 0 → test kırmızı.
// Gerçek worker, gerçek rota, gerçek PostgreSQL; yalnız sağlayıcı (fake), e-posta ve oturum sahte.
// ---------------------------------------------------------------------------
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { __setOutboundAdapterForTest, __setMessagingAccessForTest, type MessagingAccess } from "@/lib/channels";
import { enqueueOutbound } from "@/lib/outbox/enqueue";
import { drainOutboxOnce } from "@/lib/outbox/worker";
import { __resetRateLimit } from "@/lib/rate-limit";
import { POST as replyRoute } from "@/app/api/conversations/[id]/reply/route";

const fake = new FakeOutboundProvider();
const RES = "res-access-1";
const TOKEN = "tok-from-channel-layer";

function fakeAccess(token: string | null) {
  return {
    provider: "hospitable" as const,
    credentialFor: vi.fn(async () => token),
    onCredentialRejected: vi.fn(async () => "noop" as const),
    isConnected: vi.fn(async () => token !== null),
  } satisfies MessagingAccess<"hospitable">;
}

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  session = { userId: "u1", organizationId: orgId, role: "owner", email: "o@t.com", name: "Owner", sessionEpoch: 0 } as SessionPayload;
  const conversation = await prisma.conversation.create({
    data: { propertyId, channel: "airbnb", guestIdentifier: "Alex", status: "waiting", externalReservationId: RES },
  });
  fake.registerReservation(RES, TOKEN);
  return { orgId, conversationId: conversation.id };
}
const enqueue = (orgId: string, conversationId: string, key: string) =>
  enqueueOutbound({
    organizationId: orgId, conversationId, channel: "airbnb", externalReservationId: RES, reservationId: null,
    body: "Merhaba!", senderName: "Host", authorType: "host", messageType: "manual", idempotencyKey: key,
  });
const replyReq = (id: string, body: string) =>
  new NextRequest(`http://localhost/api/conversations/${id}/reply`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body, senderName: "Owner" }),
  });

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  fake.reset();
  __setOutboundAdapterForTest("hospitable", fake.adapter());
});
afterEach(() => {
  __setOutboundAdapterForTest("hospitable", null);
  __setMessagingAccessForTest("hospitable", null);
  __setMessagingAccessForTest("airbnb_direct" as never, null);
});

describe("gönderim kuyruğu (varsayılan bağımlılıklar) × kanal erişimi", () => {
  it("🚨 worker kimlik bilgisini KAYITLI erişimden alır: teslim 1, sağlayıcıya giden token o erişiminki", async () => {
    const access = fakeAccess(TOKEN);
    __setMessagingAccessForTest("hospitable", access);
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueue(orgId, conversationId, "k1");
    await drainOutboxOnce({});
    expect(access.credentialFor).toHaveBeenCalledWith(orgId);
    expect(fake.deliveries).toHaveLength(1);
    expect(fake.deliveries[0].token).toBe(TOKEN);
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: outboxId } })).status).toBe("sent");
  });

  it("🚨 erişim 'bağlı değil' derse sağlayıcıya SIFIR deneme, satır bekler (kiracı sınırı korunur)", async () => {
    __setMessagingAccessForTest("hospitable", fakeAccess(null));
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueue(orgId, conversationId, "k2");
    await drainOutboxOnce({});
    expect(fake.attempts).toHaveLength(0);
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: outboxId } })).status).toBe("pending");
  });

  it("🚨 401: reddedilen kimlik bilgisi SATIRIN sağlayıcısının çözücüsüne, kullanılan token'la gider", async () => {
    const access = fakeAccess(TOKEN);
    __setMessagingAccessForTest("hospitable", access);
    const { orgId, conversationId } = await seed();
    await enqueue(orgId, conversationId, "k3");
    fake.behave({ mode: "reject", status: 401 });
    await drainOutboxOnce({});
    expect(access.onCredentialRejected).toHaveBeenCalledWith(orgId, 401, TOKEN);
    expect(fake.deliveries).toHaveLength(0);
  });

  it("🚨 ikinci sağlayıcı kayıtlıyken org düzeyinde kimlik bilgisi seçilmez → sıfır deneme (yanlış sağlayıcıya kimlik taşınmaz)", async () => {
    __setMessagingAccessForTest("hospitable", fakeAccess(TOKEN));
    __setMessagingAccessForTest("airbnb_direct" as never, { ...fakeAccess("tok-other"), provider: "airbnb_direct" as never });
    const { orgId, conversationId } = await seed();
    await enqueue(orgId, conversationId, "k4");
    await drainOutboxOnce({});
    expect(fake.attempts).toHaveLength(0);
  });
});

describe("elle yanıt rotası (bayrak KAPALI) × kanal erişimi", () => {
  it("🚨 ev sahibi cevabı kimlik bilgisini kayıtlı erişimden alır: teslim 1, token o erişiminki", async () => {
    const access = fakeAccess(TOKEN);
    __setMessagingAccessForTest("hospitable", access);
    const { orgId, conversationId } = await seed();
    const r = await replyRoute(replyReq(conversationId, "Selam"), { params: Promise.resolve({ id: conversationId }) });
    expect(r.status).toBeLessThan(300);
    expect(access.credentialFor).toHaveBeenCalledWith(orgId);
    expect(fake.deliveries).toHaveLength(1);
    expect(fake.deliveries[0].token).toBe(TOKEN);
  });

  it("KONTROL: erişim 'bağlı değil' → rota gönderim denemez, mesaj yazılmaz", async () => {
    __setMessagingAccessForTest("hospitable", fakeAccess(null));
    const { conversationId } = await seed();
    const r = await replyRoute(replyReq(conversationId, "Selam"), { params: Promise.resolve({ id: conversationId }) });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(fake.attempts).toHaveLength(0);
    expect(await prisma.message.count({ where: { conversationId } })).toBe(0);
  });
});
