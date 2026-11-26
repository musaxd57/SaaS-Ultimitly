import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Codex 11-17 G2-02 + K2-01 (C5) — karar mesajı:
//  1. İstek işlenirken (ilk okuma → gönderim arası) rezervasyon iptal edilirse karar mesajı GİTMEZ: kilit alındıktan sonra, gönderimden
//     hemen önce konuşmanın rezervasyonu TAZE okunur (konuşmaya sonradan bağlanan rezervasyon dahil). Kart yeniden açılır, yeni sürüm döner.
//  2. Kalıcı kuyruk AÇIKKEN de karar mesajı DOĞRUDAN yoldan gider (`sendDirect`): kart gerçek gönderim sonucuna göre kapanır — kuyruğa
//     kabul "onaylandı" değildir (kesin hatada kart yeniden açılır). Ev sahibinin GENEL elle cevabı kuyruğa yazmaya devam eder.
//  3. Çift gönderim kalkanı iki yolda ortak: aynı anahtarla biri kuyrukta biri doğrudan iki gönderim olmaz.
// Araya girme `__decideHooks.afterLock` test kancasıyla (Prisma temsilcisine casus KURULMAZ); kancanın tetiklendiği her testte doğrulanır.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: "prov-1" })),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn(async () => "tok") }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { sendOnChannel } from "@/lib/messaging";
import { POST as DECIDE } from "@/app/api/conversations/[id]/decisions/[decisionId]/route";
import { POST as REPLY } from "@/app/api/conversations/[id]/reply/route";
import { __decideHooks } from "@/lib/decisions/decide";
import { sendHostMessage } from "@/lib/host-send";

const mockSend = vi.mocked(sendOnChannel);
const DAY = 86_400_000;
const utcDay = (offset: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
};
const APPROVE_TR = "Erken giriş talebiniz onaylandı: yarın saat 13:00 itibarıyla giriş yapabilirsiniz.";

async function seed(opts: { linkReservation?: boolean } = {}) {
  const link = opts.linkReservation ?? true;
  const org = await prisma.organization.create({ data: { name: "Org", timezone: "Europe/Istanbul" } });
  const owner = await prisma.user.create({
    data: { organizationId: org.id, name: "Ev Sahibi", email: `o${Math.random()}@x.com`, passwordHash: "x", role: "owner" },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" } });
  const arrival = utcDay(1);
  const reservation = await prisma.reservation.create({
    data: { propertyId: property.id, guestName: "Ada", arrivalDate: arrival, departureDate: new Date(arrival.getTime() + 3 * DAY), status: "confirmed", channel: "airbnb" },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: link ? reservation.id : null,
      guestIdentifier: "Ada",
      channel: "airbnb",
      externalReservationId: "res-1",
      status: "new",
    },
  });
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "inbound",
      senderName: "Ada",
      authorType: "guest",
      body: "Saat 13:00'te giriş yapabilir miyiz?",
      createdAt: new Date(Date.now() - 10 * 60_000),
    },
  });
  const item = await prisma.conversationItem.create({
    data: { organizationId: org.id, conversationId: conversation.id, messageId: message.id, kind: "early_checkin", sources: "understanding", status: "open" },
  });
  const decision = await prisma.decisionRequest.create({
    data: {
      organizationId: org.id,
      conversationId: conversation.id,
      messageId: message.id,
      itemId: item.id,
      reservationId: link ? reservation.id : null,
      kind: "early_checkin",
      requestedTime: "13:00",
      dayKey: arrival.toISOString().slice(0, 10),
      lang: "tr",
    },
  });
  session = { userId: owner.id, organizationId: org.id, role: "owner", email: owner.email, name: "Ev Sahibi", sessionEpoch: 0 };
  return { orgId: org.id, propertyId: property.id, conversationId: conversation.id, decisionId: decision.id, itemId: item.id, reservationId: reservation.id, arrival };
}
type Seeded = Awaited<ReturnType<typeof seed>>;

const approve = (s: Seeded) =>
  DECIDE(
    new NextRequest(`http://localhost/api/conversations/${s.conversationId}/decisions/${s.decisionId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", version: 0, time: "13:00", body: APPROVE_TR }),
    }),
    { params: Promise.resolve({ id: s.conversationId, decisionId: s.decisionId }) },
  );

const queueOn = () => {
  vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
  vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
};
const card = (s: Seeded) => prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } });

describe("G2-02 / K2-01 — karar mesajı: gönderimden hemen önce taze iptal okuması + kuyruk açıkken doğrudan yol", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    // Kuyruğa yazılan satırı arka planda boşaltan hızlı uyandırma kapalı: kuyruk satırının durumu testte belirleyici kalsın.
    vi.stubEnv("OUTBOX_FAST_WAKE", "0");
    // Tüketilmemiş tek seferlik taklit (`mockResolvedValueOnce`) sonraki teste sızmasın.
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true, providerMessageId: "prov-1" } as never);
  });
  afterEach(() => {
    __decideHooks.afterLock = null;
    vi.unstubAllEnvs();
  });

  it.each([
    ["kuyruk kapalı", false],
    ["kuyruk açık", true],
  ] as const)("🚨 %s: rezervasyon kilitten SONRA iptal edildi → 409 reservation_cancelled, gönderim / kuyruk satırı YOK, kart yeniden açılır, yeni sürüm döner", async (_n, queued) => {
    if (queued) queueOn();
    const s = await seed();
    let fired = 0;
    __decideHooks.afterLock = async () => {
      fired++;
      await prisma.reservation.update({ where: { id: s.reservationId }, data: { status: "cancelled" } });
    };
    const res = await approve(s);
    expect(fired).toBe(1);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json).toMatchObject({ code: "reservation_cancelled", error: "Rezervasyon iptal edilmiş; misafire karar mesajı gönderilmedi." });
    expect(mockSend).not.toHaveBeenCalled();
    expect(await prisma.messageOutbox.count()).toBe(0);
    expect(await prisma.message.count({ where: { conversationId: s.conversationId, direction: "outbound" } })).toBe(0);
    const d = await card(s);
    expect(d).toMatchObject({ status: "pending", decidedTime: null, decidedById: null, decidedAt: null });
    // İstemci yeni sürümü alır (öteki kesin olumsuz dallarında olduğu gibi).
    expect(json.version).toBe(d.version);
    expect((await prisma.conversationItem.findUniqueOrThrow({ where: { id: s.itemId } })).status).toBe("open");
  });

  it("🚨 konuşmaya SONRADAN bağlanan iptal rezervasyon da görülür (taze okuma konuşma üzerinden)", async () => {
    const s = await seed({ linkReservation: false });
    let fired = 0;
    __decideHooks.afterLock = async () => {
      fired++;
      const cancelled = await prisma.reservation.create({
        data: { propertyId: s.propertyId, guestName: "Ada", arrivalDate: s.arrival, departureDate: new Date(s.arrival.getTime() + 3 * DAY), status: "cancelled", channel: "airbnb" },
      });
      await prisma.conversation.update({ where: { id: s.conversationId }, data: { reservationId: cancelled.id } });
    };
    const res = await approve(s);
    expect(fired).toBe(1);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("reservation_cancelled");
    expect(mockSend).not.toHaveBeenCalled();
    expect((await card(s)).status).toBe("pending");
  });

  it("KONTROL — kilitten sonra rezervasyon değişmedi (kanca çalışır, bir şey yapmaz) → 200, karar gider", async () => {
    const s = await seed();
    let fired = 0;
    __decideHooks.afterLock = async () => {
      fired++;
    };
    const res = await approve(s);
    expect(fired).toBe(1);
    expect(res.status).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect((await card(s)).status).toBe("approved");
  });

  it("KONTROL — iptal OLMAYAN bir durum değişikliği (tamamlandı) gönderimi durdurmaz", async () => {
    const s = await seed();
    __decideHooks.afterLock = async () => {
      await prisma.reservation.update({ where: { id: s.reservationId }, data: { status: "completed" } });
    };
    expect((await approve(s)).status).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("🚨 kuyruk AÇIK: karar onayı kuyruğa satır YAZMAZ, doğrudan gider; kart gönderim sonucuyla 'onaylandı', yanıt queued:false", async () => {
    queueOn();
    const s = await seed();
    const res = await approve(s);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "approved", queued: false, delivery: "channel_accepted" });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await prisma.messageOutbox.count()).toBe(0);
    const out = await prisma.message.findFirstOrThrow({ where: { conversationId: s.conversationId, direction: "outbound" } });
    expect(await card(s)).toMatchObject({ status: "approved", resultMessageId: out.id });
  });

  it("🚨 kuyruk AÇIK + kanal KESİN reddetti → kart 'onaylandı' KAPANMAZ, yeniden açılır (502, yeni sürüm); öğe açık kalır", async () => {
    queueOn();
    const s = await seed();
    mockSend.mockResolvedValueOnce({ ok: false, error: "Hospitable HTTP 400 (bad_request)" } as never);
    const res = await approve(s);
    expect(res.status).toBe(502);
    const d = await card(s);
    expect(d.status).toBe("pending");
    expect((await res.json()).version).toBe(d.version);
    expect(await prisma.messageOutbox.count()).toBe(0);
    expect((await prisma.conversationItem.findUniqueOrThrow({ where: { id: s.itemId } })).status).toBe("open");
  });

  // Ana oturum incelemesi (11-18): doğrudan yol, operatörün "teslimatı durdur" anahtarını (kuyruk açıkken acil fren) ATLAMAMALI. Eskiden
  // karar mesajı kuyrukta beklerdi; doğrudan yola alınınca fren onu durdurmaz olmuştu. Emsal elle giriş mesajı: fren açıkken gönderilmez.
  it("🚨 kuyruk AÇIK + teslimat DURDURULMUŞ → karar mesajı gitmez; kart yeniden açılır (503, var olan 'birazdan tekrar deneyin' metni), kuyruğa da yazılmaz", async () => {
    queueOn();
    vi.stubEnv("OUTBOX_DELIVERY_PAUSED", "1");
    const s = await seed();
    const res = await approve(s);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("Şu anda gönderilemedi — lütfen birazdan tekrar deneyin.");
    expect(mockSend).not.toHaveBeenCalled(); // ⬅️ ESKİDE (doğrudan yol, frensiz) kanala çıkıyordu
    expect(await prisma.messageOutbox.count()).toBe(0);
    expect(await prisma.message.count({ where: { conversationId: s.conversationId, direction: "outbound" } })).toBe(0);
    const d = await card(s);
    expect(d.status).toBe("pending");
    expect(body.version).toBe(d.version);
  });

  it("KONTROL — kuyruk KAPALI iken aynı anahtarın etkisi yok (fren kuyruğun frenidir): karar gider", async () => {
    vi.stubEnv("OUTBOX_DELIVERY_PAUSED", "1");
    const s = await seed();
    const res = await approve(s);
    expect(res.status).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("KONTROL (aşırı uygulama) — kuyruk AÇIK: ev sahibinin GENEL elle cevabı kuyruğa yazmaya devam eder (202, kanala doğrudan gitmez)", async () => {
    queueOn();
    const s = await seed();
    const res = await REPLY(
      new NextRequest(`http://localhost/api/conversations/${s.conversationId}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "Havlular dolapta.", senderName: "Ev Sahibi" }),
      }),
      { params: Promise.resolve({ id: s.conversationId }) },
    );
    expect(res.status).toBe(202);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await prisma.messageOutbox.count({ where: { conversationId: s.conversationId, messageType: "manual" } })).toBe(1);
  });
});

describe("G2-02 / K2-01 — çift gönderim kalkanı kuyruk ve doğrudan yolda ortak (aynı anahtar)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("OUTBOX_FAST_WAKE", "0");
    queueOn();
    // Tüketilmemiş tek seferlik taklit (`mockResolvedValueOnce`) sonraki teste sızmasın.
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true, providerMessageId: "prov-1" } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  const base = (s: Seeded, key: string) => ({
    organizationId: s.orgId,
    conversation: { id: s.conversationId, channel: "airbnb", guestIdentifier: "Ada", externalReservationId: "res-1" },
    body: APPROVE_TR,
    claimBody: APPROVE_TR,
    senderName: "Ev Sahibi",
    aiAssisted: false,
    idempotencyKey: key,
    strictIdempotency: true,
  });

  it("🚨 anahtar önce KUYRUĞA yazıldıysa aynı anahtarla doğrudan gönderim kanala çıkmaz (kuyruk satırının durumu döner)", async () => {
    const s = await seed();
    const first = await sendHostMessage(base(s, "decision:x:v1"));
    expect(first).toMatchObject({ status: "queued", deduped: false });
    const second = await sendHostMessage({ ...base(s, "decision:x:v1"), sendDirect: true });
    expect(second).toMatchObject({ status: "queued", deduped: true });
    expect(mockSend).not.toHaveBeenCalled();
    expect(await prisma.messageOutbox.count()).toBe(1);
    expect(await prisma.message.count({ where: { conversationId: s.conversationId, direction: "outbound" } })).toBe(1);
  });

  it("🚨 anahtar önce DOĞRUDAN gönderildiyse aynı anahtarla kuyruk yolu ikinci kopya yazmaz (duplicate)", async () => {
    const s = await seed();
    const first = await sendHostMessage({ ...base(s, "decision:y:v1"), sendDirect: true });
    expect(first).toMatchObject({ status: "sent" });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const second = await sendHostMessage(base(s, "decision:y:v1"));
    expect(second).toEqual({ status: "duplicate" });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await prisma.messageOutbox.count()).toBe(0);
    expect(await prisma.message.count({ where: { conversationId: s.conversationId, direction: "outbound" } })).toBe(1);
  });

  it("KONTROL — `sendDirect` verilmeyen çağrı kuyruk açıkken kuyruğa yazar (seçenek varsayılan olarak kapalı)", async () => {
    const s = await seed();
    expect(await sendHostMessage(base(s, "k-plain"))).toMatchObject({ status: "queued" });
    expect(mockSend).not.toHaveBeenCalled();
    expect(await prisma.messageOutbox.count()).toBe(1);
  });
});
