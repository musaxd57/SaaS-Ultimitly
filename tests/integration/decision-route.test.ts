import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// HOST KARAR MOTORU — KARAR ROTASI (Faz 1; kurucu 10-02: "host onaylayınca veya reddedince talep sonuçlanır"). Gerçek rota, DB
// gerçek, kanal MOCK. Göndermeden önce yeniden doğrulama (çift tık, misafir yeniden yazdı, iptal, gün geçti), belirsiz gönderim,
// kiracı yalıtımı, personel ve bürünme salt-okunur.
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
import { getOrgHospitableToken } from "@/lib/hospitable-credentials";
import { POST } from "@/app/api/conversations/[id]/decisions/[decisionId]/route";
import { listConversationDecisions } from "@/lib/decisions/store";
import { buildDecisionCards, decisionCardContextFor } from "@/lib/decisions/card";
import { claimOutboundSend } from "@/lib/outbound-claim";

const mockSend = vi.mocked(sendOnChannel);
const mockToken = vi.mocked(getOrgHospitableToken);

const DAY = 86_400_000;
const utcDay = (offset: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
};
const keyOf = (d: Date) => d.toISOString().slice(0, 10);

const APPROVE_TR = "Erken giriş talebiniz onaylandı: yarın saat 13:00 itibarıyla giriş yapabilirsiniz.";

interface Seeded {
  orgId: string;
  ownerId: string;
  conversationId: string;
  decisionId: string;
  itemId: string;
  reservationId: string;
  messageId: string;
}

async function seed(opts: { arrivalOffset?: number; status?: string } = {}): Promise<Seeded> {
  const org = await prisma.organization.create({ data: { name: "Org", timezone: "Europe/Istanbul" } });
  const owner = await prisma.user.create({
    data: { organizationId: org.id, name: "Ev Sahibi", email: `o${Math.random()}@x.com`, passwordHash: "x", role: "owner" },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  });
  const arrival = utcDay(opts.arrivalOffset ?? 1);
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Ada Yılmaz",
      arrivalDate: arrival,
      departureDate: new Date(arrival.getTime() + 3 * DAY),
      status: opts.status ?? "confirmed",
      channel: "airbnb",
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: reservation.id,
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
      body: "Saat 13:00'te giriş yapabilir miyiz?",
      createdAt: new Date(Date.now() - 10 * 60_000),
    },
  });
  const item = await prisma.conversationItem.create({
    data: {
      organizationId: org.id,
      conversationId: conversation.id,
      messageId: message.id,
      kind: "early_checkin",
      sources: "understanding",
      status: "open",
    },
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
      dayKey: keyOf(arrival),
      lang: "tr",
    },
  });
  session = { userId: owner.id, organizationId: org.id, role: "owner", email: owner.email, name: "Ev Sahibi", sessionEpoch: 0 };
  return {
    orgId: org.id,
    ownerId: owner.id,
    conversationId: conversation.id,
    decisionId: decision.id,
    itemId: item.id,
    reservationId: reservation.id,
    messageId: message.id,
  };
}

function post(s: Pick<Seeded, "conversationId" | "decisionId">, body: Record<string, unknown>) {
  return POST(
    new NextRequest(`http://localhost/api/conversations/${s.conversationId}/decisions/${s.decisionId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: s.conversationId, decisionId: s.decisionId }) },
  );
}

describe("POST /api/conversations/[id]/decisions/[decisionId]", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true, providerMessageId: "prov-1" } as never);
    mockToken.mockResolvedValue("tok");
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("bayrak kapalı → 404, hiçbir şey gönderilmez / yazılmaz", async () => {
    vi.stubEnv("HOST_DECISIONS_ENABLED", "");
    const s = await seed();
    const res = await post(s, { action: "approve", version: 0, time: "13:00", body: APPROVE_TR });
    expect(res.status).toBe(404);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).status).toBe("pending");
  });

  it("ONAYLA: ev sahibinin gördüğü metin misafire gider; kart onaylandı (saat, karar veren, mesaj); öğe tamamlandı; denetim kaydı metin / tutar taşımaz", async () => {
    const s = await seed();
    const res = await post(s, { action: "approve", version: 0, time: "13:00", body: APPROVE_TR });
    expect(res.status).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][1]).toBe(APPROVE_TR);
    const d = await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } });
    expect(d).toMatchObject({ status: "approved", decidedTime: "13:00", decidedById: s.ownerId, version: 2 });
    const out = await prisma.message.findFirstOrThrow({ where: { conversationId: s.conversationId, direction: "outbound" } });
    expect(d.resultMessageId).toBe(out.id);
    expect(out).toMatchObject({ authorType: "host", aiAssisted: true, body: APPROVE_TR, externalId: "prov-1" });
    expect((await prisma.conversationItem.findUniqueOrThrow({ where: { id: s.itemId } })).status).toBe("done");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: s.orgId, action: "decision.approved" } });
    expect(audit.actorUserId).toBe(s.ownerId);
    expect(audit.metadataJson).not.toContain("13:00");
    expect(audit.metadataJson).not.toContain("onaylandı");
  });

  it("🚨 çift tıklama: aynı sürümle ikinci istek 409 (stale), misafire İKİNCİ mesaj gitmez", async () => {
    const s = await seed();
    const [a, b] = await Promise.all([
      post(s, { action: "approve", version: 0, time: "13:00", body: APPROVE_TR }),
      post(s, { action: "approve", version: 0, time: "13:00", body: APPROVE_TR }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await prisma.message.count({ where: { conversationId: s.conversationId, direction: "outbound" } })).toBe(1);
    // Eski sürümle sonradan gelen karar da (başka sekme) 409.
    expect((await post(s, { action: "decline", version: 0, body: "x" })).status).toBe(409);
  });

  it("🚨 misafir talepten SONRA yeniden yazdıysa önce okutulur (409, gönderim yok); son mesaj kimliğiyle tekrar → gider", async () => {
    const s = await seed();
    const later = await prisma.message.create({
      data: { conversationId: s.conversationId, direction: "inbound", senderName: "Ada", body: "Aslında 12:00 olur mu?" },
    });
    const first = await post(s, { action: "approve", version: 0, time: "13:00", body: APPROVE_TR });
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ code: "guest_wrote_again", latestMessageId: later.id });
    expect(mockSend).not.toHaveBeenCalled();
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).status).toBe("pending");
    // Başka (eski) bir kimlikle "okudum" demek yetmez.
    expect((await post(s, { action: "approve", version: 0, time: "13:00", body: APPROVE_TR, seenMessageId: s.messageId })).status).toBe(409);
    const ok = await post(s, { action: "approve", version: 0, time: "13:00", body: APPROVE_TR, seenMessageId: later.id });
    expect(ok.status).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("rezervasyon iptal → 409, gönderim yok, kart bekliyor kalır", async () => {
    const s = await seed({ status: "cancelled" });
    const res = await post(s, { action: "approve", version: 0, time: "13:00", body: APPROVE_TR });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("reservation_cancelled");
    expect(mockSend).not.toHaveBeenCalled();
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).status).toBe("pending");
  });

  it("talep edilen gün geçti → 409 expired, gönderim yok", async () => {
    const s = await seed({ arrivalOffset: -2 });
    const res = await post(s, { action: "decline", version: 0, body: "Maalesef mümkün değil." });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("expired");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("REDDET: metin gider, kart reddedildi, onay saati yok", async () => {
    const s = await seed();
    const body = "Maalesef yarın erken giriş mümkün olmayacak; giriş saatimiz 15:00.";
    const res = await post(s, { action: "decline", version: 0, body, time: "13:00" });
    expect(res.status).toBe(200);
    expect(mockSend.mock.calls[0][1]).toBe(body);
    expect(await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).toMatchObject({
      status: "declined",
      decidedTime: null,
    });
  });

  it("KAPAT ('gerek kalmadı'): misafire mesaj GİTMEZ; kart kapatıldı, öğe tamamlandı; aynı sürümle ikinci kapatma 409", async () => {
    const s = await seed();
    const res = await post(s, { action: "dismiss", version: 0 });
    expect(res.status).toBe(200);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).status).toBe("dismissed");
    expect((await prisma.conversationItem.findUniqueOrThrow({ where: { id: s.itemId } })).status).toBe("done");
    expect((await post(s, { action: "dismiss", version: 0 })).status).toBe(409);
    expect(await prisma.auditLog.count({ where: { organizationId: s.orgId, action: "decision.dismissed" } })).toBe(1);
  });

  it("🚨 BELİRSİZ gönderim (zaman aşımı) → 502 send_unverified; kart 'gönderim doğrulanamadı' (kör tekrar yok); 'kontrol ettim' ile kapanır", async () => {
    const s = await seed();
    mockSend.mockResolvedValueOnce({ ok: false, error: "The operation timed out" } as never);
    const res = await post(s, { action: "approve", version: 0, time: "13:00", body: APPROVE_TR });
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("send_unverified");
    const d = await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } });
    expect(d).toMatchObject({ status: "send_unverified", decidedTime: "13:00" });
    // Onay / ret yeniden GÖNDERİLEMEZ (kart beklemede değil) — yalnız kapatma.
    expect((await post(s, { action: "approve", version: d.version, time: "13:00", body: APPROVE_TR })).status).toBe(409);
    expect((await post(s, { action: "dismiss", version: d.version })).status).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("KESİN ret (4xx) → hiçbir şey gitmedi: kart yeniden açılır (karar bekliyor), 502", async () => {
    const s = await seed();
    mockSend.mockResolvedValueOnce({ ok: false, error: "Hospitable HTTP 400 (bad_request)" } as never);
    const res = await post(s, { action: "approve", version: 0, time: "13:00", body: APPROVE_TR });
    expect(res.status).toBe(502);
    const d = await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } });
    expect(d.status).toBe("pending");
    expect(d.decidedTime).toBeNull();
    // Yanıt yeni sürümü taşır (istemci yeniden denemede onu gönderir — yoksa her yeniden deneme önce "kart değişti" alırdı).
    expect((await res.json()).version).toBe(d.version);
    // Yeni sürümle yeniden denenebilir.
    expect((await post(s, { action: "approve", version: d.version, time: "13:00", body: APPROVE_TR })).status).toBe(200);
  });

  it("🚨 gönderim sırasında süreç düştü (kart 'sending'te kaldı): taze iken KAPATILAMAZ / onaylanamaz; 5 dk sonra 'doğrulanamadı' sayılır ve kapatılabilir", async () => {
    const s = await seed();
    await prisma.decisionRequest.update({ where: { id: s.decisionId }, data: { status: "sending", version: 1 } });
    expect((await post(s, { action: "dismiss", version: 1 })).status).toBe(409);
    expect((await post(s, { action: "approve", version: 1, time: "13:00", body: APPROVE_TR })).status).toBe(409);
    // Süre doldu → kapatılabilir (misafire yine bir şey gitmez).
    await prisma.$executeRaw`UPDATE "DecisionRequest" SET "updatedAt" = now() - interval '6 minutes' WHERE id = ${s.decisionId}`;
    expect((await post(s, { action: "dismiss", version: 1 })).status).toBe(200);
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).status).toBe("dismissed");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("kanal bağlı değil → 502, kart yeniden açılır (yeni sürüm yanıtta)", async () => {
    const s = await seed();
    mockToken.mockResolvedValueOnce(null as never);
    const res = await post(s, { action: "approve", version: 0, time: "13:00", body: APPROVE_TR });
    expect(res.status).toBe(502);
    const d = await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } });
    expect(d.status).toBe("pending");
    expect((await res.json()).version).toBe(d.version);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("🚨 OLGULAR DEĞİŞTİ: ev sahibinin baktığı kontrol listesi artık güncel değilse (önceki misafire geç çıkış onaylandı) 409 facts_changed, gönderim YOK; güncel izle gider", async () => {
    const s = await seed();
    const TZ = "Europe/Istanbul";
    // Sayfanın yaptığı gibi: kart bağlamı tek kurucudan, iz karttan.
    const hashNow = async () => {
      const views = await listConversationDecisions(prisma, { organizationId: s.orgId, conversationId: s.conversationId, timeZone: TZ, now: new Date() });
      const conv = await prisma.conversation.findUniqueOrThrow({
        where: { id: s.conversationId },
        include: { property: true, reservation: true, messages: { orderBy: { createdAt: "asc" } } },
      });
      const ctx = await decisionCardContextFor({ organizationId: s.orgId, conversation: conv, timeZone: TZ, now: new Date(), needsEarlyRule: true });
      return (await buildDecisionCards(views, ctx))[0].factsHash;
    };
    const seen = await hashNow();
    // O arada: aynı gün çıkan önceki misafirin 14:00 geç çıkışı onaylandı → erken giriş kartının olguları değişti.
    const cur = await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } });
    const prev = await prisma.reservation.create({
      data: {
        propertyId: cur.propertyId,
        guestName: "Önceki",
        arrivalDate: new Date(cur.arrivalDate.getTime() - 3 * DAY),
        departureDate: cur.arrivalDate,
        status: "confirmed",
        channel: "airbnb",
      },
    });
    const prevConv = await prisma.conversation.create({
      data: { propertyId: cur.propertyId, reservationId: prev.id, guestIdentifier: "Önceki", channel: "airbnb", externalReservationId: "res-prev" },
    });
    await prisma.decisionRequest.create({
      data: {
        organizationId: s.orgId,
        conversationId: prevConv.id,
        messageId: "m-prev",
        reservationId: prev.id,
        kind: "late_checkout",
        lang: "tr",
        status: "approved",
        requestedTime: "14:00",
        decidedTime: "14:00",
        decidedAt: new Date(),
      },
    });
    const res = await post(s, { action: "approve", version: 0, time: "13:00", body: APPROVE_TR, factsHash: seen });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("facts_changed");
    expect(mockSend).not.toHaveBeenCalled();
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).status).toBe("pending");
    // Güncel kartın iziyle (ev sahibi yeni satırları gördü) gider.
    const fresh = await hashNow();
    expect(fresh).not.toBe(seen);
    expect((await post(s, { action: "approve", version: 0, time: "13:00", body: APPROVE_TR, factsHash: fresh })).status).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("girdi: erken giriş onayında geçerli saat zorunlu; boş metin 400; tanınmayan işlem 400", async () => {
    const s = await seed();
    expect((await post(s, { action: "approve", version: 0, body: APPROVE_TR })).status).toBe(400);
    expect((await post(s, { action: "approve", version: 0, time: "25:00", body: APPROVE_TR })).status).toBe(400);
    expect((await post(s, { action: "approve", version: 0, time: "13:00", body: "   " })).status).toBe(400);
    expect((await post(s, { action: "send", version: 0 })).status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("🚨 KİRACI YALITIMI: başka org'un sahibi bu kartı bulamaz (404); PERSONEL 403; BÜRÜNME salt-okunur (403) — hiçbiri yazmaz", async () => {
    const s = await seed();
    const other = await prisma.organization.create({ data: { name: "Other" } });
    session = { userId: "x", organizationId: other.id, role: "owner", email: "x@x.com", name: "X", sessionEpoch: 0 };
    expect((await post(s, { action: "approve", version: 0, time: "13:00", body: APPROVE_TR })).status).toBe(404);
    session = { userId: "st", organizationId: s.orgId, role: "staff", email: "s@x.com", name: "S", sessionEpoch: 0 };
    expect((await post(s, { action: "dismiss", version: 0 })).status).toBe(403);
    session = {
      userId: s.ownerId,
      organizationId: s.orgId,
      role: "owner",
      email: "o@x.com",
      name: "O",
      sessionEpoch: 0,
      actorUserId: "op1",
      actorEmail: "ops@lixusai.com",
      impersonatedAt: Math.floor(Date.now() / 1000),
    } as SessionPayload;
    expect((await post(s, { action: "dismiss", version: 0 })).status).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).status).toBe("pending");
  });

  it("🚨 gönderim sırasında HATA (kanal kabul etti, kayıt düştü olabilir) → kart yeniden AÇILMAZ, 'gönderim doğrulanamadı' (502); ikinci gönderim yok", async () => {
    const s = await seed();
    mockSend.mockRejectedValueOnce(new Error("db write failed after delivery"));
    const res = await post(s, { action: "approve", version: 0, time: "13:00", body: APPROVE_TR });
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("send_unverified");
    const d = await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } });
    expect(d).toMatchObject({ status: "send_unverified", decidedTime: "13:00", decidedById: s.ownerId });
    expect((await post(s, { action: "approve", version: d.version, time: "13:00", body: APPROVE_TR })).status).toBe(409);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await prisma.auditLog.count({ where: { organizationId: s.orgId, action: "decision.approved" } })).toBe(1);
  });

  it("🚨 aynı metin az önce başka yoldan gitti / gidiyor (duplicate) → kart 'gönderim doğrulanamadı' (yeniden açılıp 2 dk sonra ikinci kez gitmez)", async () => {
    const s = await seed();
    expect(await claimOutboundSend(s.conversationId, APPROVE_TR)).toBe("claimed");
    const res = await post(s, { action: "approve", version: 0, time: "13:00", body: APPROVE_TR });
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("send_unverified");
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).status).toBe("send_unverified");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("🚨 kilit onayın saatini ve karar vereni gönderimden ÖNCE yazar (komşu kart / erken giriş kontrolü gönderim sürerken görür); ret saat yazmaz", async () => {
    const s = await seed();
    let during: { status: string; decidedTime: string | null; decidedById: string | null } | null = null;
    mockSend.mockImplementationOnce(async () => {
      during = await prisma.decisionRequest.findUniqueOrThrow({
        where: { id: s.decisionId },
        select: { status: true, decidedTime: true, decidedById: true },
      });
      return { ok: true, providerMessageId: "prov-9" } as never;
    });
    expect((await post(s, { action: "approve", version: 0, time: "14:00", body: APPROVE_TR })).status).toBe(200);
    expect(during).toEqual({ status: "sending", decidedTime: "14:00", decidedById: s.ownerId });
    const s2 = await seed();
    mockSend.mockImplementationOnce(async () => {
      during = await prisma.decisionRequest.findUniqueOrThrow({
        where: { id: s2.decisionId },
        select: { status: true, decidedTime: true, decidedById: true },
      });
      return { ok: true, providerMessageId: "prov-10" } as never;
    });
    expect((await post(s2, { action: "decline", version: 0, body: "Maalesef mümkün değil." })).status).toBe(200);
    expect(during).toMatchObject({ status: "sending", decidedTime: null });
  });

  it("🚨 standardın YANLIŞ tarafındaki onay saati 400 (erken giriş 15:00 ve sonrası) — misafire '16:00 erken giriş onaylandı' gitmez", async () => {
    const s = await seed();
    for (const time of ["15:00", "16:00"]) {
      const res = await post(s, { action: "approve", version: 0, time, body: APPROVE_TR });
      expect(res.status, time).toBe(400);
    }
    expect(mockSend).not.toHaveBeenCalled();
    expect((await post(s, { action: "approve", version: 0, time: "14:45", body: APPROVE_TR })).status).toBe(200);
  });

  it("ev sahibi hazır metni DEĞİŞTİRDİYSE mesaj onun yazdığıdır (yapay zekâ destekli sayılmaz)", async () => {
    const s = await seed();
    expect((await post(s, { action: "approve", version: 0, time: "13:00", body: "13:00 olur, bekliyoruz!", edited: true })).status).toBe(200);
    expect((await prisma.message.findFirstOrThrow({ where: { conversationId: s.conversationId, direction: "outbound" } })).aiAssisted).toBe(false);
  });

  it("🚨 talebin mesajı bulunamasa da (birleştirmede ayıklandı) kart açıldıktan sonra misafir yazdıysa önce okutulur", async () => {
    const s = await seed();
    await prisma.message.delete({ where: { id: s.messageId } });
    const later = await prisma.message.create({
      data: { conversationId: s.conversationId, direction: "inbound", senderName: "Ada", body: "Vazgeçtik, normal saatte geliriz." },
    });
    const res = await post(s, { action: "approve", version: 0, time: "13:00", body: APPROVE_TR });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "guest_wrote_again", latestMessageId: later.id });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("🚨 CANLI gün: rezervasyon geçmişe kaydıysa kayıtlı gün gelecekte olsa da 409 expired; tersi (kayıtlı gün geçmiş, rezervasyon ileri) gider", async () => {
    const s = await seed();
    const past = utcDay(-3);
    await prisma.reservation.update({ where: { id: s.reservationId }, data: { arrivalDate: past, departureDate: new Date(past.getTime() + DAY) } });
    const res = await post(s, { action: "approve", version: 0, time: "13:00", body: APPROVE_TR });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("expired");
    const s2 = await seed();
    await prisma.decisionRequest.update({ where: { id: s2.decisionId }, data: { dayKey: keyOf(utcDay(-5)) } });
    expect((await post(s2, { action: "approve", version: 0, time: "13:00", body: APPROVE_TR })).status).toBe(200);
  });

  it("başka konuşmanın kart kimliğiyle (aynı org) istek 404", async () => {
    const s = await seed();
    const otherConv = await prisma.conversation.create({
      data: {
        propertyId: (await prisma.property.findFirstOrThrow({ where: { organizationId: s.orgId } })).id,
        guestIdentifier: "B",
        channel: "airbnb",
        externalReservationId: "res-2",
      },
    });
    const res = await post({ conversationId: otherConv.id, decisionId: s.decisionId }, { action: "dismiss", version: 0 });
    expect(res.status).toBe(404);
  });
});
