import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Codex 11-17 C4 (G2-01) — karar mesajının "yalnız kendi kararını yanıtlar" bağı (`DecisionRequest.resultMessageId`) mesajla AYNI
// veritabanı işleminde yazılır. Eskiden bağ gönderimden SONRA ayrı ve kartın durumuna bağlı bir güncellemeyle yazılıyordu: o adım
// düşerse ya da kart arada değiştiyse mesaj "kapsamsız" kalıyor, aynı konuşmanın İLGİSİZ her açık öğesi ("iade istiyorum")
// "ev sahibi yazdı" sayılıp açık işlerden düşüyordu. Artık "mesaj var, bağ yok" durumu oluşamaz: ya ikisi birlikte yazılır, ya hiçbiri.
//
// AYRI dosya: Prisma temsilcisine casus kurulur (sonraki testlere sızmasın). Kalan delik (belirsiz teslimde senkronun SONRADAN getirdiği
// satır bağlanamaz — kimliği bilinmiyor) bu dosyanın konusu DEĞİL; şemalı çözüm migration turunda.
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
import { listConversationItems } from "@/lib/conversation-items/store";
import { sendHostMessage } from "@/lib/host-send";

const mockSend = vi.mocked(sendOnChannel);
const DAY = 86_400_000;
const utcDay = (offset: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
};
const APPROVE_TR = "Erken giriş talebiniz onaylandı: yarın saat 13:00 itibarıyla giriş yapabilirsiniz.";

async function seed() {
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
    data: { propertyId: property.id, reservationId: reservation.id, guestIdentifier: "Ada", channel: "airbnb", externalReservationId: "res-1", status: "new" },
  });
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "inbound",
      senderName: "Ada",
      authorType: "guest",
      body: "Saat 13:00'te giriş yapabilir miyiz? Bir de geçen konaklamanın iadesini istiyorum.",
      createdAt: new Date(Date.now() - 10 * 60_000),
    },
  });
  const item = await prisma.conversationItem.create({
    data: { organizationId: org.id, conversationId: conversation.id, messageId: message.id, kind: "early_checkin", sources: "understanding", status: "open" },
  });
  // Aynı turun İLGİSİZ öğesi: karar mesajı bunu yanıtlamaz.
  const unrelated = await prisma.conversationItem.create({
    data: { organizationId: org.id, conversationId: conversation.id, messageId: message.id, requestIndex: 1, kind: "refund", sources: "understanding", status: "open" },
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
  return { orgId: org.id, conversation, decisionId: decision.id, unrelatedId: unrelated.id };
}

const approve = (s: Awaited<ReturnType<typeof seed>>) =>
  POST(
    new NextRequest(`http://localhost/api/conversations/${s.conversation.id}/decisions/${s.decisionId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", version: 0, time: "13:00", body: APPROVE_TR }),
    }),
    { params: Promise.resolve({ id: s.conversation.id, decisionId: s.decisionId }) },
  );

async function unrelatedEffective(s: Awaited<ReturnType<typeof seed>>) {
  const views = await listConversationItems(prisma, { organizationId: s.orgId, conversationId: s.conversation.id });
  return views.find((v) => v.id === s.unrelatedId)?.effective;
}

describe("C4 — karar mesajının kapsam bağı mesajla aynı işlemde", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true, providerMessageId: "prov-1" } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 kart gönderim sürerken DEĞİŞTİ (settle 0 satır): bağ kartın durumundan bağımsız yazılır — ilgisiz öğe AÇIK kalır", async () => {
    const s = await seed();
    mockSend.mockImplementationOnce(async () => {
      // Gönderim sürerken kart başka yoldan kapatıldı (5 dk bayat "sending" kartı kapatılabilir).
      await prisma.decisionRequest.update({ where: { id: s.decisionId }, data: { status: "dismissed", version: { increment: 1 } } });
      return { ok: true, providerMessageId: "prov-2" } as never;
    });
    await approve(s);
    const out = await prisma.message.findFirstOrThrow({ where: { conversationId: s.conversation.id, direction: "outbound" } });
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).resultMessageId).toBe(out.id);
    expect(await unrelatedEffective(s)).toBe("open");
  });

  it("KONTROL — olağan onay: bağ yazılır, ilgisiz öğe açık, kararın kendi öğesi tamamlandı", async () => {
    const s = await seed();
    expect((await approve(s)).status).toBe(200);
    const out = await prisma.message.findFirstOrThrow({ where: { conversationId: s.conversation.id, direction: "outbound" } });
    expect(await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).toMatchObject({ status: "approved", resultMessageId: out.id });
    expect(await unrelatedEffective(s)).toBe("open");
  });
});

describe("C4 — gönderim çekirdeğinin kayıt kancası (onRecorded) mesajla aynı işlemde", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockSend.mockResolvedValue({ ok: true, providerMessageId: "prov-1" } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  async function input(over: { externalReservationId?: string | null } = {}) {
    const s = await seed();
    const ext = over.externalReservationId === undefined ? "res-1" : over.externalReservationId;
    await prisma.conversation.update({ where: { id: s.conversation.id }, data: { externalReservationId: ext } });
    return {
      s,
      input: {
        organizationId: s.orgId,
        conversation: { id: s.conversation.id, channel: "airbnb", guestIdentifier: "Ada", externalReservationId: ext },
        body: "Merhaba",
        claimBody: "Merhaba",
        senderName: "Ev Sahibi",
        aiAssisted: false,
        idempotencyKey: `k-${Math.random()}`,
        strictIdempotency: true,
      },
    };
  }
  const outboundCount = (conversationId: string) => prisma.message.count({ where: { conversationId, direction: "outbound" } });

  it("🚨 doğrudan yol: kanca DÜŞERSE mesaj da yazılmaz (\"mesaj var, bağ yok\" oluşamaz); teslim kesin olduğu için sonuç yine 'sent'", async () => {
    const { s, input: base } = await input();
    const r = await sendHostMessage({ ...base, onRecorded: async () => { throw new Error("link failed (test)"); } });
    expect(r).toMatchObject({ status: "sent", message: null });
    expect(await outboundCount(s.conversation.id)).toBe(0);
  });

  it("🚨 kuyruk yolu: kanca DÜŞERSE ne mesaj ne kuyruk satırı yazılır (hiçbir şey gönderilmeyecek)", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    const { s, input: base } = await input();
    await expect(sendHostMessage({ ...base, onRecorded: async () => { throw new Error("link failed (test)"); } })).rejects.toThrow("link failed");
    expect(await outboundCount(s.conversation.id)).toBe(0);
    expect(await prisma.messageOutbox.count()).toBe(0);
  });

  it.each([
    ["doğrudan yol", "res-1", false],
    ["kuyruk yolu", "res-1", true],
    ["kanala bağlı olmayan konuşma", null, false],
  ] as const)("KONTROL — %s: kanca kaydedilen mesajın kimliğiyle BİR kez çağrılır", async (_name, ext, queued) => {
    if (queued) {
      vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
      vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    }
    const { s, input: base } = await input({ externalReservationId: ext });
    const seen: string[] = [];
    const r = await sendHostMessage({ ...base, onRecorded: async (_tx, messageId) => { seen.push(messageId); } });
    const out = await prisma.message.findFirstOrThrow({ where: { conversationId: s.conversation.id, direction: "outbound" } });
    expect(seen).toEqual([out.id]);
    expect("message" in r && r.message?.id).toBe(out.id);
  });
});

// EN SONDA: Prisma temsilcisine kurulan casus geri alındıktan sonra da sonraki testlere sızabiliyor (CLAUDE.md dersi) — casuslar BİR KEZ kurulur,
// geri alınmaz, bayrakla açılır (`outbox-delivery-effect-fault.test.ts` deseni); bu bloktan sonra test yok.
describe("C4 — gönderimden sonraki adımlar düşerse (casuslu, dosyanın son bloğu)", () => {
  let failSettleApproved = false;
  let failQueuedMessageRead = false;
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true, providerMessageId: "prov-1" } as never);
    failSettleApproved = false;
    failQueuedMessageRead = false;
  });
  afterEach(() => vi.unstubAllEnvs());

  let installed = false;
  function installSpies() {
    if (installed) return;
    installed = true;
    const realUpdateMany = prisma.decisionRequest.updateMany.bind(prisma.decisionRequest) as (a: unknown) => Promise<unknown>;
    vi.spyOn(prisma.decisionRequest, "updateMany").mockImplementation(((a: { data?: { status?: unknown } }) =>
      failSettleApproved && a?.data?.status === "approved" ? Promise.reject(new Error("db blip (test)")) : realUpdateMany(a)) as never);
    const realFindUnique = prisma.message.findUnique.bind(prisma.message) as (a: unknown) => Promise<unknown>;
    vi.spyOn(prisma.message, "findUnique").mockImplementation(((a: unknown) =>
      failQueuedMessageRead ? Promise.reject(new Error("db blip (test)")) : realFindUnique(a)) as never);
  }

  it("🚨 gönderimden sonraki kart kapanışı (settle) DÜŞERSE: mesaj kayıtlı ve bağlı — ilgisiz öğe AÇIK kalır", async () => {
    installSpies();
    const s = await seed();
    failSettleApproved = true;
    await approve(s).catch(() => null);
    failSettleApproved = false;
    const out = await prisma.message.findFirstOrThrow({ where: { conversationId: s.conversation.id, direction: "outbound" } });
    expect((await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).resultMessageId).toBe(out.id);
    expect(await unrelatedEffective(s)).toBe("open");
  });

  it("🚨 kuyruğa yazıldıktan SONRA çekirdek fırlatırsa kart 'doğrulanamadı' olur ama bağ BOŞLA EZİLMEZ — ilgisiz öğe AÇIK kalır", async () => {
    installSpies();
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    const s = await seed();
    // Kuyruk işlemi COMMIT oldu; çekirdeğin ardından yaptığı mesaj okuması düşer → karar çekirdeği "doğrulanamadı" kapanışına gider.
    failQueuedMessageRead = true;
    const res = await approve(s);
    failQueuedMessageRead = false;
    expect(res.status).toBe(502);
    const out = await prisma.message.findFirstOrThrow({ where: { conversationId: s.conversation.id, direction: "outbound" } });
    expect(await prisma.decisionRequest.findUniqueOrThrow({ where: { id: s.decisionId } })).toMatchObject({ status: "send_unverified", resultMessageId: out.id });
    expect(await unrelatedEffective(s)).toBe("open");
  });
});
