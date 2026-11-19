import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// SİLME → KUYRUK SÖZLEŞMESİ (Codex F03 — P1)
//
// 🚨 KAPATILAN AÇIK: normal konuşma silme yolu Message + Conversation'ı siliyor,
// MessageOutbox satırına DOKUNMUYORDU (kuyruk hedef/gövde snapshot'ını kendi
// taşır; DB düzeyinde cascade yok). Gönderim öncesi veto Message'ı BULAMAYINCA
// `null` = "veto yok" diyordu — kayıp mesaj MANUEL host mesajı gibi ele alınıp
// sağlayıcıya GİDİYORDU. Mülk silme (cascade) aynı sınıf; holding-ack varlık
// kontrolü hiç yapmıyordu. Codex gerçek veto fonksiyonuyla yeniden üretti:
// kayıp Message + kayıp Conversation → gönderim durmadı.
//
// İki katman: (1) silme rotaları aynı TX'te ilgili kuyruk satırlarını `canceled`
// yapar (belt), (2) worker her yanıt türü için hedefin HÂLÂ VAR ve AYNI
// KİRACIYA AİT olduğunu POST'tan hemen önce doğrular (braces). Kanıt sağlayıcı
// casusuyla ölçülür: send HİÇ çağrılmaz.
//
// ⚠️ BİLİNEN SINIR (aşağıda ayrıca pinli): claim ALINMIŞ ve veto GEÇİLMİŞ bir
// satırın POST'u ile eşzamanlı gelen silme geri alınamaz — sağlayıcının kabul
// ettiği mesaj DB'den iptal edilemez. Pencere: veto → POST arası (ms).
// ---------------------------------------------------------------------------
let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { enqueueOutbound, enqueueProactive } from "@/lib/outbox/enqueue";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";
import { markDispatchStarted } from "@/lib/outbox/dispatch";
import { DELETE as deleteConversation } from "@/app/api/conversations/[id]/route";
import { DELETE as deleteProperty } from "@/app/api/properties/[id]/route";

const req = (url: string) => new NextRequest(`http://localhost${url}`, { method: "DELETE" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const outbox = (id: string) => prisma.messageOutbox.findUniqueOrThrow({ where: { id } });
const spySend = (): ReturnType<typeof vi.fn<OutboxSendFn>> =>
  vi.fn<OutboxSendFn>(async () => ({ ok: true, providerMessageId: "PROV-X" }));

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  session = {
    userId: "u-owner",
    organizationId: orgId,
    role: "owner",
    email: "owner@test.com",
    name: "Owner",
    sessionEpoch: 0,
  } as SessionPayload;
  const reservation = await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Ayşe",
      arrivalDate: new Date(Date.now() + 86_400_000),
      departureDate: new Date(Date.now() + 3 * 86_400_000),
      status: "confirmed",
      sourceReference: "res-uuid-del",
      channel: "airbnb",
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId,
      reservationId: reservation.id,
      channel: "airbnb",
      guestIdentifier: "Ayşe",
      status: "new",
      externalReservationId: "res-uuid-del",
      messages: { create: [{ direction: "inbound", senderName: "Ayşe", body: "Merhaba?" }] },
    },
  });
  return { orgId, propertyId, reservationId: reservation.id, conversationId: conversation.id };
}

function enqueueReply(orgId: string, conversationId: string, messageType: "manual" | "ai" | "holding_ack", key: string) {
  return enqueueOutbound({
    organizationId: orgId,
    conversationId,
    channel: "airbnb",
    externalReservationId: "res-uuid-del",
    reservationId: null,
    body: "Kuyruktaki metin",
    senderName: messageType === "manual" ? "Host" : "Lixus AI",
    authorType: messageType === "manual" ? "host" : "ai",
    messageType,
    idempotencyKey: key,
  });
}

describe("konuşma silme → kuyruk iptal edilir, sağlayıcı ÇAĞRILMAZ", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    // Y5 (10-14): genel kapatma kapalıyken otomatik satır talep edilmez / iptal edilir — bu dosya canlı ayarda VARLIK vetosunu ölçer.
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  for (const messageType of ["manual", "ai", "holding_ack"] as const) {
    it(`🚨 ${messageType}: enqueue → DELETE /conversations/[id] → drain → send 0 çağrı`, async () => {
      const { orgId, conversationId } = await seed();
      const { outboxId } = await enqueueReply(orgId, conversationId, messageType, `k-${messageType}`);

      const res = await deleteConversation(req(`/api/conversations/${conversationId}`), ctx(conversationId));
      expect(res.status).toBe(200);
      expect(await prisma.conversation.count({ where: { id: conversationId } })).toBe(0);

      const send = spySend();
      const out = await drainOutboxOnce({ send, tokenFor: async () => "tok" });

      expect(send).not.toHaveBeenCalled(); // ⬅️ ARIZADA: kayıp Message = "manuel mesaj, geçsin" → POST
      expect(out.sent).toBe(0);
      const row = await outbox(outboxId);
      expect(row.status).toBe("canceled");
      expect(row.lastErrorCode).toBe("conversation_deleted"); // rota katmanı (belt) iptal etti
    });
  }

  it("rota, BAŞKA org'un satırına dokunmaz ve yalnız silinen konuşmanın satırını iptal eder", async () => {
    const a = await seed(); // session = A
    const bOrg = await makeOrgWithProperty();
    const bConv = await prisma.conversation.create({
      data: { propertyId: bOrg.propertyId, channel: "airbnb", guestIdentifier: "B", status: "new", externalReservationId: "res-b" },
    });
    const other = await prisma.conversation.create({
      data: { propertyId: a.propertyId, channel: "airbnb", guestIdentifier: "Diğer", status: "new", externalReservationId: "res-other" },
    });
    const rowB = await enqueueOutbound({
      organizationId: bOrg.orgId, conversationId: bConv.id, channel: "airbnb", externalReservationId: "res-b",
      reservationId: null, body: "B", senderName: "Host", authorType: "host", messageType: "manual", idempotencyKey: "kb",
    });
    const rowOther = await enqueueOutbound({
      organizationId: a.orgId, conversationId: other.id, channel: "airbnb", externalReservationId: "res-other",
      reservationId: null, body: "O", senderName: "Host", authorType: "host", messageType: "manual", idempotencyKey: "ko",
    });
    await enqueueReply(a.orgId, a.conversationId, "manual", "ka");

    await deleteConversation(req(`/api/conversations/${a.conversationId}`), ctx(a.conversationId));

    expect((await outbox(rowB.outboxId)).status).toBe("pending"); // yabancı kiracı — dokunulmadı
    expect((await outbox(rowOther.outboxId)).status).toBe("pending"); // aynı org, başka konuşma — dokunulmadı
    // İptal İSTEĞİ de yalnız silinen konuşmanın satırlarına yazılır: istek başka satıra yazılsaydı o satır bir sonraki geçişte iptal olurdu.
    expect((await outbox(rowB.outboxId)).cancelRequestedAt).toBeNull();
    expect((await outbox(rowOther.outboxId)).cancelRequestedAt).toBeNull();
  });

  it("KONTROL: silinmemiş konuşmanın satırı normal TESLİM edilir (aşırı-uygulama değil)", async () => {
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueueReply(orgId, conversationId, "manual", "k-ok");
    const send = spySend();
    await drainOutboxOnce({ send, tokenFor: async () => "tok" });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await outbox(outboxId)).status).toBe("sent");
  });
});

describe("mülk silme (cascade) → bağlı yanıt VE lifecycle satırları iptal, sağlayıcı ÇAĞRILMAZ", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    // Y5 (10-14): genel kapatma kapalıyken otomatik satır talep edilmez / iptal edilir — bu dosya canlı ayarda VARLIK vetosunu ölçer.
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 enqueue(reply + welcome) → DELETE /properties/[id] → drain → send 0 çağrı", async () => {
    const { orgId, propertyId, reservationId, conversationId } = await seed();
    const reply = await enqueueReply(orgId, conversationId, "ai", "k-ai");
    const welcome = await enqueueProactive({
      organizationId: orgId,
      externalReservationId: "res-uuid-del",
      reservationId,
      channel: "airbnb",
      messageType: "welcome",
      body: "Hoş geldiniz!",
      idempotencyKey: "welcome:res-uuid-del",
    });

    const res = await deleteProperty(req(`/api/properties/${propertyId}`), ctx(propertyId));
    expect(res.status).toBe(200);
    expect(await prisma.property.count({ where: { id: propertyId } })).toBe(0);

    const send = spySend();
    const out = await drainOutboxOnce({ send, tokenFor: async () => "tok" });
    expect(send).not.toHaveBeenCalled();
    expect(out.sent).toBe(0);
    expect((await outbox(reply.outboxId)).status).toBe("canceled");
    expect((await outbox(welcome.outboxId)).status).toBe("canceled");
    expect((await outbox(reply.outboxId)).lastErrorCode).toBe("property_deleted");
  });

  it("yabancı org'un mülkü silinemez ve hiçbir satıra dokunulmaz (404)", async () => {
    const a = await seed();
    const b = await makeOrgWithProperty();
    const bConv = await prisma.conversation.create({
      data: { propertyId: b.propertyId, channel: "airbnb", guestIdentifier: "B", status: "new", externalReservationId: "res-b" },
    });
    const rowB = await enqueueOutbound({
      organizationId: b.orgId, conversationId: bConv.id, channel: "airbnb", externalReservationId: "res-b",
      reservationId: null, body: "B", senderName: "Host", authorType: "host", messageType: "manual", idempotencyKey: "kb",
    });
    void a;
    const res = await deleteProperty(req(`/api/properties/${b.propertyId}`), ctx(b.propertyId));
    expect(res.status).toBe(404);
    expect(await prisma.property.count({ where: { id: b.propertyId } })).toBe(1);
    expect((await outbox(rowB.outboxId)).status).toBe("pending");
  });
});

describe("worker — hedef varlığı/kiracı vetosu (braces: rota katmanı olmasa da)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    // Y5 (10-14): genel kapatma kapalıyken otomatik satır talep edilmez / iptal edilir — bu dosya canlı ayarda VARLIK vetosunu ölçer.
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 Codex kanıtı: Message + Conversation DB'den doğrudan silinmiş → veto, POST yok", async () => {
    // Rota yolu DEĞİL: ham silme (bir migration, elle SQL, başka bir yol). Belt yok,
    // yalnız braces. Eski `aiSendVeto`: `!msg → return null` → manuel gibi gönderirdi.
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueueReply(orgId, conversationId, "manual", "k-raw");
    await prisma.$transaction([
      prisma.message.deleteMany({ where: { conversationId } }),
      prisma.conversation.delete({ where: { id: conversationId } }),
    ]);
    const send = spySend();
    await drainOutboxOnce({ send, tokenFor: async () => "tok" });
    expect(send).not.toHaveBeenCalled();
    const row = await outbox(outboxId);
    expect(row.status).toBe("canceled");
    expect(row.lastErrorCode).toBe("conversation_gone");
  });

  it("Message silinmiş, Conversation duruyor → `message_gone` (manuel satır dahil)", async () => {
    const { orgId, conversationId } = await seed();
    const { outboxId, messageId } = await enqueueReply(orgId, conversationId, "manual", "k-msg");
    await prisma.message.delete({ where: { id: messageId } });
    const send = spySend();
    await drainOutboxOnce({ send, tokenFor: async () => "tok" });
    expect(send).not.toHaveBeenCalled();
    expect((await outbox(outboxId)).lastErrorCode).toBe("message_gone");
  });

  it("holding_ack de varlık kontrolünden geçer (eskiden hiç bakmıyordu)", async () => {
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueueReply(orgId, conversationId, "holding_ack", "k-ack");
    await prisma.$transaction([
      prisma.message.deleteMany({ where: { conversationId } }),
      prisma.conversation.delete({ where: { id: conversationId } }),
    ]);
    const send = spySend();
    await drainOutboxOnce({ send, tokenFor: async () => "tok" });
    expect(send).not.toHaveBeenCalled();
    expect((await outbox(outboxId)).status).toBe("canceled");
  });

  it("🚨 KİRACI UYUŞMAZLIĞI: satırın org'u konuşmanın org'undan farklıysa POST yok", async () => {
    // Enqueue'ye başka org'un conversationId'si verilmiş (bug/yanlış çağıran).
    const a = await seed();
    const b = await makeOrgWithProperty();
    const { outboxId } = await enqueueOutbound({
      organizationId: b.orgId, // ← B adına
      conversationId: a.conversationId, // ← A'nın konuşması
      channel: "airbnb", externalReservationId: "res-uuid-del", reservationId: null,
      body: "X", senderName: "Host", authorType: "host", messageType: "manual", idempotencyKey: "k-x",
    });
    const send = spySend();
    await drainOutboxOnce({ send, tokenFor: async () => "tok" });
    expect(send).not.toHaveBeenCalled();
    expect((await outbox(outboxId)).lastErrorCode).toBe("tenant_mismatch");
  });

  it("BİLİNEN SINIR (belgelenmiş): veto GEÇİLDİKTEN sonra POST sırasında gelen silme geri alınamaz", async () => {
    // Claim alınmış + veto geçilmiş satırın POST'u ile eşzamanlı silme: sağlayıcının
    // kabul ettiği mesaj DB'den iptal edilemez. Rota katmanı `claimedBy: null`
    // filtresiyle bu satırı BİLEREK atlar (claim'i ezmek settle'ı bozar → satır
    // "canceled" görünürken mesaj gitmiş olurdu = daha kötü yalan). Pencere ms
    // mertebesinde; bu test sınırı GİZLEMEZ, pinler.
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueueReply(orgId, conversationId, "manual", "k-race");
    const send = vi.fn<OutboxSendFn>(async () => {
      // POST sırasında konuşma silinir.
      await deleteConversation(req(`/api/conversations/${conversationId}`), ctx(conversationId));
      return { ok: true, providerMessageId: "PROV-RACE" };
    });
    await drainOutboxOnce({ send, tokenFor: async () => "tok" });
    expect(send).toHaveBeenCalledTimes(1); // gitti — geri alınamaz
    expect((await outbox(outboxId)).status).toBe("sent"); // ve DÜRÜSTÇE 'sent' (canceled DEĞİL)
  });
});

// ---------------------------------------------------------------------------
// 11-18 akşam (`outbox/dispatch.ts`): silme, işçinin HAZIRLIĞINDAKİ satırı da durdurur. Rota işçinin talebini yine ezmez; ama isteği henüz
// sağlayıcıya çıkmamış satıra aynı işlemde iptal isteği yazar ve işçi isteği atmadan HEMEN önce satırı koşullu işaretlediği için o satırı
// göndermez. Yukarıdaki "bilinen sınır" böylece yalnız isteği gerçekten çıkmış satıra iner (o test aynen geçerli).
// ---------------------------------------------------------------------------
describe("silme → işçinin hazırlığındaki satır da gönderilmez", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  /** İşçi satırı almış, gönderim öncesi kontrollerini bitirmiş, isteği henüz atmamış. */
  const claimInPreparation = (id: string, token: string) =>
    prisma.messageOutbox.update({
      where: { id },
      data: { status: "sending", claimedBy: token, claimedAt: new Date(), claimExpiresAt: new Date(Date.now() + 60_000), attemptCount: 1 },
    });

  it("🚨 konuşma silme: hazırlıktaki satıra iptal isteği yazılır (talep ezilmez) → gönderim başlangıcı reddedilir", async () => {
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueueReply(orgId, conversationId, "manual", "k-prep");
    await claimInPreparation(outboxId, "d1:w1");

    const res = await deleteConversation(req(`/api/conversations/${conversationId}`), ctx(conversationId));
    expect(res.status).toBe(200);

    const row = await outbox(outboxId);
    expect(row).toMatchObject({ status: "sending", claimedBy: "d1:w1", cancelReason: "conversation_deleted" });
    expect(row.cancelRequestedAt).not.toBeNull();
    // ⬅️ ESKİDE: rota bu satırı atlıyordu ve işçi (varlık kontrolünü geçtiyse) isteği atıyordu.
    expect(await markDispatchStarted({ id: outboxId, token: "d1:w1", now: new Date() })).toEqual({ kind: "cancel_requested", reason: "conversation_deleted" });
  });

  it("🚨 daire silme: hazırlıktaki cevap VE yaşam döngüsü satırına iptal isteği yazılır; başka dairenin satırına yazılmaz", async () => {
    const { orgId, propertyId, reservationId, conversationId } = await seed();
    const reply = await enqueueReply(orgId, conversationId, "ai", "k-ai-prep");
    const welcome = await enqueueProactive({
      organizationId: orgId,
      externalReservationId: "res-uuid-del",
      reservationId,
      channel: "airbnb",
      messageType: "welcome",
      body: "Hoş geldiniz!",
      idempotencyKey: "welcome:res-uuid-del",
    });
    // Aynı işletmenin BAŞKA dairesi: dokunulmaz.
    const otherProperty = await prisma.property.create({ data: { organizationId: orgId, name: "Lale 2" } });
    const otherConv = await prisma.conversation.create({
      data: { propertyId: otherProperty.id, channel: "airbnb", guestIdentifier: "Diğer", status: "new", externalReservationId: "res-other" },
    });
    const other = await enqueueOutbound({
      organizationId: orgId, conversationId: otherConv.id, channel: "airbnb", externalReservationId: "res-other",
      reservationId: null, body: "O", senderName: "Host", authorType: "host", messageType: "manual", idempotencyKey: "ko-prep",
    });
    for (const id of [reply.outboxId, welcome.outboxId, other.outboxId]) await claimInPreparation(id, "d1:w2");

    const res = await deleteProperty(req(`/api/properties/${propertyId}`), ctx(propertyId));
    expect(res.status).toBe(200);

    for (const id of [reply.outboxId, welcome.outboxId]) {
      expect(await outbox(id)).toMatchObject({ status: "sending", claimedBy: "d1:w2", cancelReason: "property_deleted" });
      expect(await markDispatchStarted({ id, token: "d1:w2", now: new Date() })).toEqual({ kind: "cancel_requested", reason: "property_deleted" });
    }
    expect((await outbox(other.outboxId)).cancelRequestedAt).toBeNull();
    expect(await markDispatchStarted({ id: other.outboxId, token: "d1:w2", now: new Date() })).toEqual({ kind: "started" });
  });

  it("isteği ÇIKMIŞ satıra iptal isteği yazılmaz (iptal edilemez — sonucu gönderim belirler)", async () => {
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueueReply(orgId, conversationId, "manual", "k-out");
    await claimInPreparation(outboxId, "d1:w3");
    expect(await markDispatchStarted({ id: outboxId, token: "d1:w3", now: new Date() })).toEqual({ kind: "started" });

    await deleteConversation(req(`/api/conversations/${conversationId}`), ctx(conversationId));
    expect(await outbox(outboxId)).toMatchObject({ status: "sending", claimedBy: "d1:w3", cancelRequestedAt: null });
  });
});
