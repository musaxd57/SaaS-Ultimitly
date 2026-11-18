import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// KARAR MESAJI — MİSAFİRİN GÖRDÜĞÜ KANITLANMADAN BAĞLI İHTİYAÇ KAPANMAZ (kurucu 11-18 akşam, açık nokta 1).
//
// Karar kartı bir konuşma öğesine (misafirin isteği) bağlıdır. Karar mesajı gönderilince öğe "tamamlandı" olur. Üç dalda öğe, mesajın misafire
// ulaştığı BİLİNMEDEN kapanıyordu:
//  (1) sonuç belirsiz (zaman aşımı · gönderim sırasında hata · aynı metin başka yoldan gidiyor) — kart "gönderim doğrulanamadı" kalıyor ama öğe
//      tamamlanıyordu;
//  (2) yalnız yerelde kaydedildi (konuşmanın gideceği bir kanal yok) — misafire hiçbir şey gitmediği hâlde öğe tamamlanıyordu;
//  (3) bu kimliğin eski bir kuyruk satırı bulundu (henüz gönderilmemiş / gönderilemeyen) — öğe tamamlanıyordu.
// Kural: mesaj YENİDEN GÖNDERİLMEZ (kör tekrar yok) ama iş de kapanmaz. Öğe yalnız kanıtla kapanır: kanal kabul etti · iç QR sohbetinde
// görünür · ev sahibi kartı / öğeyi kendisi kapattı.
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
import { POST } from "@/app/api/conversations/[id]/decisions/[decisionId]/route";
import { claimOutboundSend } from "@/lib/outbound-claim";
import { listConversationDecisions } from "@/lib/decisions/store";
import { decisionLinkedItemIds } from "@/lib/decisions/card";
import { listConversationItems } from "@/lib/conversation-items/store";
import { isOpenForHost } from "@/lib/conversation-items/core";

const mockSend = vi.mocked(sendOnChannel);
const DAY = 86_400_000;
const utcDay = (offset: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
};
const APPROVE_TR = "Erken giriş talebiniz onaylandı: yarın saat 13:00 itibarıyla giriş yapabilirsiniz.";

interface Seeded {
  orgId: string;
  conversationId: string;
  decisionId: string;
  itemId: string;
}

async function seed(opts: { externalReservationId?: string | null; channel?: string } = {}): Promise<Seeded> {
  const org = await prisma.organization.create({ data: { name: "Org", timezone: "Europe/Istanbul" } });
  const owner = await prisma.user.create({
    data: { organizationId: org.id, name: "Ev Sahibi", email: `o${Math.random()}@x.com`, passwordHash: "x", role: "owner" },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" } });
  const arrival = utcDay(1);
  const reservation = await prisma.reservation.create({
    data: { propertyId: property.id, guestName: "Ada Yılmaz", arrivalDate: arrival, departureDate: new Date(arrival.getTime() + 3 * DAY), status: "confirmed", channel: "airbnb" },
  });
  const externalReservationId = opts.externalReservationId === undefined ? "res-1" : opts.externalReservationId === "qr" ? `qr-chat:${property.id}:${reservation.id}` : opts.externalReservationId;
  const conversation = await prisma.conversation.create({
    data: { propertyId: property.id, reservationId: reservation.id, guestIdentifier: "Ada", channel: opts.channel ?? "airbnb", externalReservationId, status: "new" },
  });
  const message = await prisma.message.create({
    data: { conversationId: conversation.id, direction: "inbound", senderName: "Ada", body: "Saat 13:00'te giriş yapabilir miyiz?", createdAt: new Date(Date.now() - 10 * 60_000) },
  });
  const item = await prisma.conversationItem.create({
    data: { organizationId: org.id, conversationId: conversation.id, messageId: message.id, kind: "early_checkin", sources: "understanding", status: "pending_host" },
  });
  const decision = await prisma.decisionRequest.create({
    data: {
      organizationId: org.id,
      conversationId: conversation.id,
      messageId: message.id,
      itemId: item.id,
      reservationId: reservation.id,
      kind: "early_checkin",
      requestedTime: "13:00",
      dayKey: arrival.toISOString().slice(0, 10),
      lang: "tr",
    },
  });
  session = { userId: owner.id, organizationId: org.id, role: "owner", email: owner.email, name: "Ev Sahibi", sessionEpoch: 0 };
  return { orgId: org.id, conversationId: conversation.id, decisionId: decision.id, itemId: item.id };
}

function post(s: Seeded, body: Record<string, unknown>) {
  return POST(
    new NextRequest(`http://localhost/api/conversations/${s.conversationId}/decisions/${s.decisionId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: s.conversationId, decisionId: s.decisionId }) },
  );
}
const approve = (s: Seeded) => post(s, { action: "approve", version: 0, time: "13:00", body: APPROVE_TR });
const itemStatus = async (s: Seeded) => (await prisma.conversationItem.findUniqueOrThrow({ where: { id: s.itemId } })).status;
const cardStatus = async (s: Seeded) => (await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).status;
/** Konuşma sayfasının "Açık işler" kartından düştüğü öğeler — sayfayla AYNI çağrı (`inbox/[id]/page.tsx`). */
async function pageHiddenItemIds(s: Seeded): Promise<Set<string>> {
  const now = new Date();
  const views = await listConversationDecisions(prisma, { organizationId: s.orgId, conversationId: s.conversationId, timeZone: "Europe/Istanbul", now });
  const items = await listConversationItems(prisma, { organizationId: s.orgId, conversationId: s.conversationId });
  return decisionLinkedItemIds(views, new Set(items.filter((v) => isOpenForHost(v.effective)).map((v) => v.id)));
}
/** Bu kararın kilit sürümüyle (v1) yazılmış ESKİ kuyruk satırı — kuyruğa yazan önceki kodun bıraktığı satır. */
const seedLegacyQueueRow = (s: Seeded, status: string) =>
  prisma.messageOutbox.create({
    data: {
      organizationId: s.orgId,
      conversationId: s.conversationId,
      channel: "airbnb",
      externalReservationId: "res-1",
      messageType: "manual",
      body: APPROVE_TR,
      idempotencyKey: `decision:${s.decisionId}:v1`,
      status,
      ...(status === "sent" ? { sentAt: new Date() } : {}),
    },
  });

describe("karar mesajı — misafirin gördüğü kanıtlanmadan bağlı ihtiyaç kapanmaz", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true, providerMessageId: "prov-1" } as never);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("KONTROL: kanal kabul etti → kart onaylandı, öğe tamamlandı (bugünkü davranış)", async () => {
    const s = await seed();
    const res = await approve(s);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "approved", delivery: "channel_accepted" });
    expect(await cardStatus(s)).toBe("approved");
    expect(await itemStatus(s)).toBe("done");
  });

  it("🚨 BELİRSİZ sonuç (zaman aşımı): kart 'gönderim doğrulanamadı', öğe AÇIK kalır; ikinci gönderim yok; ev sahibi kartı kapatınca öğe tamamlanır", async () => {
    const s = await seed();
    mockSend.mockResolvedValueOnce({ ok: false, error: "The operation timed out" } as never);
    const res = await approve(s);
    expect(res.status).toBe(502);
    expect(await cardStatus(s)).toBe("send_unverified");
    expect(await itemStatus(s)).toBe("pending_host"); // ⬅️ ESKİDE "done": misafir görmemiş olabilir ama ihtiyaç kapanıyordu
    expect(mockSend).toHaveBeenCalledTimes(1);

    const card = await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } });
    expect((await post(s, { action: "dismiss", version: card.version })).status).toBe(200);
    expect(await itemStatus(s)).toBe("done"); // ev sahibi kanaldan baktı, kapattı → kanıt onun beyanı
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("🚨 gönderim sırasında HATA (ulaşmış olabilir): öğe AÇIK kalır", async () => {
    const s = await seed();
    mockSend.mockRejectedValueOnce(new Error("db write failed after delivery"));
    expect((await approve(s)).status).toBe(502);
    expect(await cardStatus(s)).toBe("send_unverified");
    expect(await itemStatus(s)).toBe("pending_host");
  });

  it("🚨 aynı metin başka yoldan gidiyor (duplicate): öğe AÇIK kalır", async () => {
    const s = await seed();
    expect(await claimOutboundSend(s.conversationId, APPROVE_TR)).toBe("claimed");
    expect((await approve(s)).status).toBe(502);
    expect(await cardStatus(s)).toBe("send_unverified");
    expect(await itemStatus(s)).toBe("pending_host");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("🚨 YALNIZ YERELDE kaydedildi (konuşmanın kanalı yok): karar kaydedilir, yanıt 'local_only' der — ama öğe AÇIK kalır (misafire hiçbir şey gitmedi)", async () => {
    const s = await seed({ externalReservationId: null });
    const res = await approve(s);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "approved", delivery: "local_only" });
    expect(await cardStatus(s)).toBe("approved");
    expect(await itemStatus(s)).toBe("pending_host"); // ⬅️ ESKİDE "done"
    // (Kanal taklidi burada çağrılır: gerçek `sendOnChannel` hedefsiz rotada kendisi "atlandı" döner — taklit o kararı vermez.)

    // Konuşma sayfası: kartın sonuç satırı ("onaylandı") hâlâ AÇIK olan öğeyi "Açık işler"den gizlemez.
    const hidden = await pageHiddenItemIds(s);
    expect(hidden.has(s.itemId)).toBe(false); // ⬅️ gizlenseydi açık iş sayfada hiçbir yerde görünmezdi
  });

  it("KONTROL: kanal kabul ettiğinde öğe kapalıdır ve sonuç satırı onu 'Açık işler'de ikinci kez göstermez (bugünkü davranış)", async () => {
    const s = await seed();
    expect((await approve(s)).status).toBe(200);
    expect((await pageHiddenItemIds(s)).has(s.itemId)).toBe(true);
  });

  it("KONTROL: açık kart (gönderim doğrulanamadı) öğeyi temsil eder — öğe açık olsa da 'Açık işler'de ikinci kez görünmez", async () => {
    const s = await seed();
    mockSend.mockResolvedValueOnce({ ok: false, error: "The operation timed out" } as never);
    expect((await approve(s)).status).toBe(502);
    expect(await itemStatus(s)).toBe("pending_host");
    expect((await pageHiddenItemIds(s)).has(s.itemId)).toBe(true);
  });

  it("KONTROL: iç QR sohbeti — misafir cevabı sohbet sayfasında görür → öğe tamamlanır", async () => {
    const s = await seed({ externalReservationId: "qr", channel: "chat" });
    const res = await approve(s);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "approved", delivery: "qr_visible" });
    expect(await itemStatus(s)).toBe("done");
  });

  it.each([["pending"], ["ambiguous"], ["review"]])(
    "🚨 ESKİ kuyruk satırı '%s' (henüz gitmedi / sonucu belirsiz): YENİDEN GÖNDERİLMEZ; kart 'gönderim doğrulanamadı', öğe AÇIK kalır",
    async (status) => {
      const s = await seed();
      await seedLegacyQueueRow(s, status);
      const res = await approve(s);
      expect(res.status).toBe(502);
      expect((await res.json()).code).toBe("send_unverified");
      expect(await cardStatus(s)).toBe("send_unverified"); // ⬅️ ESKİDE "approved"
      expect(await itemStatus(s)).toBe("pending_host"); // ⬅️ ESKİDE "done"
      expect(mockSend).not.toHaveBeenCalled();
    },
  );

  it("KONTROL: eski kuyruk satırı 'sent' (kanal kabul etmiş) → kart onaylandı, öğe tamamlandı; yeniden gönderilmez", async () => {
    const s = await seed();
    await seedLegacyQueueRow(s, "sent");
    const res = await approve(s);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "approved", delivery: "channel_accepted" });
    expect(await cardStatus(s)).toBe("approved");
    expect(await itemStatus(s)).toBe("done");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it.each([["failed"], ["canceled"], ["blocked"]])(
    "🚨 ESKİ kuyruk satırı '%s' (KESİNLİKLE gitmedi): kart YENİDEN AÇILIR (ev sahibi tekrar gönderebilir), öğe AÇIK; yeni sürümle gönderim gider",
    async (status) => {
      const s = await seed();
      await seedLegacyQueueRow(s, status);
      const res = await approve(s);
      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.code).not.toBe("send_unverified");
      expect(await cardStatus(s)).toBe("pending"); // ⬅️ ESKİDE "approved": gitmeyen mesaj "onaylandı" diye kapanıyordu
      expect(await itemStatus(s)).toBe("pending_host");
      expect(mockSend).not.toHaveBeenCalled();

      // Yeni sürüm = yeni istek kimliği: ölü satır bir daha yolu kesmez.
      const card = await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } });
      expect(json.version).toBe(card.version);
      const again = await post(s, { action: "approve", version: card.version, time: "13:00", body: APPROVE_TR });
      expect(again.status).toBe(200);
      expect(await cardStatus(s)).toBe("approved");
      expect(await itemStatus(s)).toBe("done");
      expect(mockSend).toHaveBeenCalledTimes(1);
    },
  );
});
