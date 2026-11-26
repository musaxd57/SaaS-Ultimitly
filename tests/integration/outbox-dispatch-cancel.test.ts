import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// KUYRUKTA "HAZIRLANIYOR / DIŞ GÖNDERİM BAŞLADI" AYRIMI VE ATOMİK İPTAL (kurucu 11-18 akşam: "`cancelRequestedAt` tek başına yarışı kapatmaz —
// iptal ile gönderim başlangıcı aynı satırda atomik karar vermeli"; `src/lib/outbox/dispatch.ts`).
//
// İki koşullu yazım aynı satırda yarışır ve TAM BİRİ kazanır:
//   · iptal kazanırsa işçi isteği ATMAZ, satır iptal olur;
//   · gönderim başlangıcı kazanırsa iptal isteyen "gönderim başladı" cevabını alır (mesajı "iptal edildi" sayamaz).
// Kanıt sağlayıcı casusuyla: istek atıldı mı.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn().mockResolvedValue(undefined),
}));

import { enqueueOutbound } from "@/lib/outbox/enqueue";
import { drainOutboxOnce, reactivateBlockedOutbox, type OutboxSendFn } from "@/lib/outbox/worker";
import { requeueFailedOutbox } from "@/lib/outbox/ops";
import { DISPATCH_AWARE_TOKEN_PREFIX, cancelFlaggedUnclaimed, markDispatchStarted, outboxPhase, requestOutboxCancel } from "@/lib/outbox/dispatch";

async function seed(key = "k1") {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const reservation = await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Ada Lale",
      arrivalDate: new Date(Date.now() + 86_400_000),
      departureDate: new Date(Date.now() + 3 * 86_400_000),
      status: "confirmed",
      sourceReference: `res-${key}`,
      channel: "airbnb",
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId,
      reservationId: reservation.id,
      channel: "airbnb",
      guestIdentifier: "Ada",
      status: "new",
      externalReservationId: `res-${key}`,
      messages: { create: [{ direction: "inbound", senderName: "Ada", body: "Merhaba" }] },
    },
  });
  const queued = await enqueueOutbound({
    organizationId: orgId,
    conversationId: conversation.id,
    channel: "airbnb",
    externalReservationId: `res-${key}`,
    reservationId: reservation.id,
    body: "Merhaba, yarın görüşürüz.",
    senderName: "Host",
    authorType: "host",
    messageType: "manual",
    idempotencyKey: key,
  });
  return { orgId, conversationId: conversation.id, rowId: queued.outboxId };
}
const rowOf = (id: string) => prisma.messageOutbox.findUniqueOrThrow({ where: { id } });
const ok: OutboxSendFn = async () => ({ ok: true, providerMessageId: "p1" });

describe("kuyruk — gönderim başlangıcı ile iptal aynı satırda karar verir", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("KONTROL: iptal yokken satır gider ve 'dış gönderim başladı' işareti isteğin ATILDIĞI anda zaten yazılıdır", async () => {
    const s = await seed();
    let phaseAtSend: string | null = null;
    const send = vi.fn<OutboxSendFn>(async (row) => {
      const live = await rowOf(row.id);
      phaseAtSend = outboxPhase(live);
      return { ok: true, providerMessageId: "p1" };
    });
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(phaseAtSend).toBe("dispatching"); // ⬅️ işaret POST'tan ÖNCE
    const row = await rowOf(s.rowId);
    expect(row.status).toBe("sent");
    expect(row.dispatchStartedAt).not.toBeNull();
    expect(row.cancelRequestedAt).toBeNull();
  });

  it("🚨 bekleyen satır için iptal: hemen iptal edilir, işçi isteği ATMAZ", async () => {
    const s = await seed();
    expect(await requestOutboxCancel({ organizationId: s.orgId, id: s.rowId }, "conversation_deleted")).toEqual({ canceled: 1, requested: 0, dispatching: 0 });
    const send = vi.fn<OutboxSendFn>(ok);
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(send).not.toHaveBeenCalled();
    expect(await rowOf(s.rowId)).toMatchObject({ status: "canceled", lastErrorKind: "canceled", lastErrorCode: "conversation_deleted" });
  });

  it("🚨 işçi satırı ALMIŞ ama isteği atmamışken iptal: iptal 'istendi' döner, işçi isteği ATMAZ ve satırı o sebeple iptal eder", async () => {
    const s = await seed();
    let result: Awaited<ReturnType<typeof requestOutboxCancel>> | null = null;
    const send = vi.fn<OutboxSendFn>(ok);
    await drainOutboxOnce({
      send,
      // Belirteç okuması talep ALINDIKTAN sonra, gönderimden ÖNCE koşar: işçinin "hazırlanıyor" evresi.
      tokenFor: async () => {
        expect(outboxPhase(await rowOf(s.rowId))).toBe("preparing");
        result = await requestOutboxCancel({ organizationId: s.orgId, id: s.rowId }, "host_took_over");
        return "t";
      },
    });
    expect(result).toEqual({ canceled: 0, requested: 1, dispatching: 0 });
    expect(send).not.toHaveBeenCalled(); // ⬅️ ESKİDE: iptal edilemiyordu (satır 'sending'), mesaj gidiyordu
    const row = await rowOf(s.rowId);
    expect(row).toMatchObject({ status: "canceled", lastErrorCode: "host_took_over" });
    expect(row.dispatchStartedAt).toBeNull();
  });

  it("🚨 istek sağlayıcıya ÇIKMIŞKEN iptal: iptal EDİLEMEZ ('gönderim başladı'), satır dokunulmadan sonucunu alır", async () => {
    const s = await seed();
    let result: Awaited<ReturnType<typeof requestOutboxCancel>> | null = null;
    const send = vi.fn<OutboxSendFn>(async () => {
      result = await requestOutboxCancel({ organizationId: s.orgId, id: s.rowId }, "host_took_over");
      return { ok: true, providerMessageId: "p1" };
    });
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(result).toEqual({ canceled: 0, requested: 0, dispatching: 1 });
    const row = await rowOf(s.rowId);
    expect(row.status).toBe("sent");
    expect(row.cancelRequestedAt).toBeNull(); // geç gelen istek satıra yazılmadı
  });

  it("🚨 iptal isteği satır işçideyken yazıldı, satır sonra GERİ BIRAKILDI (erteleme) → bir sonraki geçişte talep edilmeden kapanır, istek atılmaz", async () => {
    const s = await seed();
    // İşçi satırı almış ve hazırlıkta (elle kurulum: talep durumu).
    await prisma.messageOutbox.update({ where: { id: s.rowId }, data: { status: "sending", claimedBy: "w1", claimExpiresAt: new Date(Date.now() + 60_000) } });
    expect(await requestOutboxCancel({ organizationId: s.orgId, id: s.rowId }, "host_took_over")).toEqual({ canceled: 0, requested: 1, dispatching: 0 });
    // İşçi satırı gönderim başlangıcına varmadan geri bırakır (ör. rezervasyon bekletmesi).
    await prisma.messageOutbox.update({ where: { id: s.rowId }, data: { status: "pending", claimedBy: null, claimExpiresAt: null, availableAt: new Date(Date.now() - 1_000) } });
    const attemptsBefore = (await rowOf(s.rowId)).attemptCount;
    const send = vi.fn<OutboxSendFn>(ok);
    const out = await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(send).not.toHaveBeenCalled();
    // TALEP EDİLMEDEN kapanır (geçiş başı temizliği): satır işçinin gönderim öncesi kontrollerine hiç girmez, deneme sayılmaz.
    expect(out.claimed).toBe(0);
    expect(await rowOf(s.rowId)).toMatchObject({ status: "canceled", lastErrorCode: "host_took_over", attemptCount: attemptsBefore });
  });

  it("geçiş başı temizliği yapılamasa da (iptal isteği taşıyan satır talep edilirse) gönderim başlangıcı reddeder", async () => {
    const s = await seed();
    await prisma.messageOutbox.update({ where: { id: s.rowId }, data: { status: "sending", claimedBy: "w1", claimExpiresAt: new Date(Date.now() + 60_000), cancelRequestedAt: new Date(), cancelReason: "host_took_over" } });
    expect(await markDispatchStarted({ id: s.rowId, token: "w1", now: new Date() })).toEqual({ kind: "cancel_requested", reason: "host_took_over" });
    expect((await rowOf(s.rowId)).dispatchStartedAt).toBeNull();
  });

  it("gönderim başlangıcı yalnız KENDİ talebindeki 'sending' satıra yazılır: başka işçinin talebi / bekleyen satır → 'lost'", async () => {
    const s = await seed();
    expect(await markDispatchStarted({ id: s.rowId, token: "w1", now: new Date() })).toEqual({ kind: "lost" }); // bekleyen satır
    await prisma.messageOutbox.update({ where: { id: s.rowId }, data: { status: "sending", claimedBy: "w2", claimExpiresAt: new Date(Date.now() + 60_000) } });
    expect(await markDispatchStarted({ id: s.rowId, token: "w1", now: new Date() })).toEqual({ kind: "lost" }); // başkasının talebi
    expect((await rowOf(s.rowId)).dispatchStartedAt).toBeNull();
    // Kendi talebinde ama UZLAŞTIRMADA olan satır (isteği önceki denemede çıkmış, sonucu aranıyor): yeni gönderim başlangıcı yazılmaz.
    await prisma.messageOutbox.update({ where: { id: s.rowId }, data: { status: "reconciling" } });
    expect(await markDispatchStarted({ id: s.rowId, token: "w2", now: new Date() })).toEqual({ kind: "lost" });
    expect((await rowOf(s.rowId)).dispatchStartedAt).toBeNull();
    await prisma.messageOutbox.update({ where: { id: s.rowId }, data: { status: "sending" } });
    expect(await markDispatchStarted({ id: s.rowId, token: "w2", now: new Date() })).toEqual({ kind: "started" });
  });

  it("🚨 YARIŞ (gerçek veritabanı): gönderim başlangıcı ile iptal isteği aynı anda — her denemede TAM BİRİ kazanır, ikisi birden asla", async () => {
    const outcomes = { dispatchWon: 0, cancelWon: 0 };
    for (let i = 0; i < 25; i++) {
      const s = await seed(`race-${i}`);
      await prisma.messageOutbox.update({ where: { id: s.rowId }, data: { status: "sending", claimedBy: "w1", claimExpiresAt: new Date(Date.now() + 60_000) } });
      const [start, cancel] = await Promise.all([
        markDispatchStarted({ id: s.rowId, token: "w1", now: new Date() }),
        requestOutboxCancel({ organizationId: s.orgId, id: s.rowId }, "host_took_over"),
      ]);
      const row = await rowOf(s.rowId);
      const dispatched = start.kind === "started";
      const cancelRequested = cancel.requested === 1;
      // Tam biri: ikisi birden kazanırsa istek atılmış mesaj "iptal edildi" sanılır; ikisi de kaybederse satır askıda kalır.
      expect([dispatched, cancelRequested].filter(Boolean), `deneme ${i}`).toHaveLength(1);
      expect(row.dispatchStartedAt !== null, `deneme ${i}`).toBe(dispatched);
      expect(row.cancelRequestedAt !== null, `deneme ${i}`).toBe(cancelRequested);
      if (dispatched) {
        expect(cancel).toEqual({ canceled: 0, requested: 0, dispatching: 1 });
        outcomes.dispatchWon++;
      } else {
        expect(start).toEqual({ kind: "cancel_requested", reason: "host_took_over" });
        outcomes.cancelWon++;
      }
    }
    expect(outcomes.dispatchWon + outcomes.cancelWon).toBe(25);
  });

  it("🚨 yeni gönderim denemesi 'hazırlanıyor'dan başlar: geri denenen satır önceki denemenin işaretini taşımaz → ikinci denemenin hazırlığında iptal edilebilir", async () => {
    const s = await seed();
    let calls = 0;
    let cancel: Awaited<ReturnType<typeof requestOutboxCancel>> | null = null;
    const send = vi.fn<OutboxSendFn>(async () => {
      calls++;
      return { ok: false, kind: "definitive_failure", error: "HTTP 400 bad request", providerMessageId: null } as never;
    });
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(calls).toBe(1);
    const afterFirst = await rowOf(s.rowId);
    expect(afterFirst.status).toBe("pending"); // geri çekilip yeniden denenecek
    await prisma.messageOutbox.update({ where: { id: s.rowId }, data: { availableAt: new Date(Date.now() - 1_000), claimedAt: null } });
    await drainOutboxOnce({
      send,
      tokenFor: async () => {
        expect(outboxPhase(await rowOf(s.rowId))).toBe("preparing"); // ⬅️ işaret sıfırlanmasaydı "dispatching" görünür, iptal reddedilirdi
        cancel = await requestOutboxCancel({ organizationId: s.orgId, id: s.rowId }, "host_took_over");
        return "t";
      },
    });
    expect(cancel).toEqual({ canceled: 0, requested: 1, dispatching: 0 });
    expect(calls).toBe(1); // ikinci istek atılmadı
    expect((await rowOf(s.rowId)).status).toBe("canceled");
  });

  it("kapsam: iptal yalnız verilen kapsamdaki satırlara yazılır (başka işletme / başka konuşma etkilenmez); sebep kısa kod olmalı", async () => {
    const a = await seed("a");
    const b = await seed("b");
    expect(await requestOutboxCancel({ organizationId: a.orgId, conversationId: a.conversationId }, "conversation_deleted")).toEqual({ canceled: 1, requested: 0, dispatching: 0 });
    expect((await rowOf(b.rowId)).status).toBe("pending");
    // Başka işletmenin kimliğiyle kapsam eşleşmez.
    expect(await requestOutboxCancel({ organizationId: a.orgId, id: b.rowId }, "conversation_deleted")).toEqual({ canceled: 0, requested: 0, dispatching: 0 });
    expect((await rowOf(b.rowId)).status).toBe("pending");
    await expect(requestOutboxCancel({ organizationId: b.orgId, id: b.rowId }, "Ada'nın isteği üzerine")).rejects.toThrow();
    expect((await rowOf(b.rowId)).cancelRequestedAt).toBeNull();
  });

  it("gönderilmiş / başarısız / belirsiz satıra iptal isteği yazılmaz (iptal edilecek bir şey yok); kapsamsız temizlik yalnız istek taşıyanı kapatır", async () => {
    const s = await seed("a");
    const other = await seed("b");
    for (const status of ["sent", "failed", "ambiguous", "review"]) {
      await prisma.messageOutbox.update({ where: { id: s.rowId }, data: { status } });
      expect(await requestOutboxCancel({ organizationId: s.orgId, id: s.rowId }, "host_took_over"), status).toEqual({ canceled: 0, requested: 0, dispatching: 0 });
      expect((await rowOf(s.rowId)).cancelRequestedAt, status).toBeNull();
    }
    expect(await cancelFlaggedUnclaimed()).toBe(0);
    expect((await rowOf(other.rowId)).status).toBe("pending"); // istek taşımayan bekleyen satır kapanmaz
  });

  it("🚨 iptal İSTENMİŞ satır dirilmez: 'başarısız' olduysa elle yeniden kuyruğa alınmaz, 'engelli' ise abonelik dönünce bekleyene dönmez", async () => {
    // (a) İşçi satırı almışken iptal istendi; satır gönderim öncesi kontrolde 'başarısız'a düştü. Ev sahibi "Tekrar dene"ye basarsa satır
    //     yeniden denenmiş GİBİ görünmez (alınsaydı ilk geçişte yine iptal edilirdi).
    const a = await seed("a");
    await prisma.messageOutbox.update({ where: { id: a.rowId }, data: { status: "failed", lastErrorCode: "HTTP 400", cancelRequestedAt: new Date(), cancelReason: "conversation_deleted" } });
    expect(await requeueFailedOutbox(a.orgId, a.rowId)).toEqual({ outcome: "not_retryable", status: "failed" });
    expect((await rowOf(a.rowId)).status).toBe("failed");
    // KONTROL: iptal isteği taşımayan başarısız satır eskisi gibi yeniden kuyruğa alınır.
    const b = await seed("b");
    await prisma.messageOutbox.update({ where: { id: b.rowId }, data: { status: "failed", lastErrorCode: "HTTP 400" } });
    expect(await requeueFailedOutbox(b.orgId, b.rowId)).toEqual({ outcome: "requeued" });
    // (b) Engelli (kanal aboneliği kapalı) + iptal isteği taşıyan satır, abonelik dönünce bekleyene DÖNMEZ; istek taşımayan döner.
    const c = await seed("c");
    const d = await seed("d");
    await prisma.messageOutbox.update({ where: { id: c.rowId }, data: { status: "blocked", cancelRequestedAt: new Date(), cancelReason: "conversation_deleted" } });
    await prisma.messageOutbox.update({ where: { id: d.rowId }, data: { status: "blocked" } });
    expect(await reactivateBlockedOutbox(c.orgId)).toBe(0);
    expect((await rowOf(c.rowId)).status).toBe("blocked");
    expect(await reactivateBlockedOutbox(d.orgId)).toBe(1);
    expect((await rowOf(d.rowId)).status).toBe("pending");
  });

  it("evre sözlüğü", () => {
    const at = new Date();
    expect(outboxPhase({ status: "pending", dispatchStartedAt: null })).toBe("queued");
    expect(outboxPhase({ status: "blocked", dispatchStartedAt: null })).toBe("queued");
    expect(outboxPhase({ status: "sending", dispatchStartedAt: null })).toBe("preparing");
    expect(outboxPhase({ status: "sending", dispatchStartedAt: at })).toBe("dispatching");
    for (const s of ["ambiguous", "reconciling", "review"]) expect(outboxPhase({ status: s, dispatchStartedAt: at }), s).toBe("uncertain");
    expect(outboxPhase({ status: "sent", dispatchStartedAt: at })).toBe("sent");
    expect(outboxPhase({ status: "failed", dispatchStartedAt: at })).toBe("failed");
    expect(outboxPhase({ status: "canceled", dispatchStartedAt: null })).toBe("canceled");
  });
});

// ---------------------------------------------------------------------------
// K2 — TALEP SÜRESİ DOLAN SATIR: hazırlıkta çöktüyse (gönderim başlangıcı işareti yok) mesajın gitmediği KESİNDİR → yeniden denenir;
// isteği çıkmışsa eskisi gibi "belirsiz". Hüküm yalnız işareti yazan sürümün talebine verilir (belirteç öneki).
// ---------------------------------------------------------------------------
describe("kuyruk — talep süresi dolan satır: hazırlıkta çöken belirsiz olmaz", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });
  const AWARE = `${DISPATCH_AWARE_TOKEN_PREFIX}olmus-isci`;
  const stale = (id: string, data: Record<string, unknown>) =>
    prisma.messageOutbox.update({
      where: { id },
      data: { status: "sending", attemptCount: 1, claimedAt: new Date(Date.now() - 600_000), claimExpiresAt: new Date(Date.now() - 60_000), ...data },
    });

  it("işçinin talep belirteci bu sürümün önekini taşır", async () => {
    const s = await seed();
    let token: string | null = null;
    await drainOutboxOnce({
      send: async (row) => {
        token = (await rowOf(row.id)).claimedBy;
        return { ok: true, providerMessageId: "p1" };
      },
      tokenFor: async () => "t",
    });
    expect(String(token).startsWith(DISPATCH_AWARE_TOKEN_PREFIX)).toBe(true);
    expect((await rowOf(s.rowId)).status).toBe("sent");
  });

  it("🚨 hazırlıkta çöken satır (işaret yok, bu sürümün talebi) 'belirsiz' OLMAZ: aynı geçişte yeniden alınır ve gider; deneme sayısı şişmez", async () => {
    const s = await seed();
    await stale(s.rowId, { claimedBy: AWARE });
    const send = vi.fn<OutboxSendFn>(ok);
    const reconcile = vi.fn(async () => ({ found: false, providerMessageId: null }));
    await drainOutboxOnce({ send, reconcile, tokenFor: async () => "t" });
    expect(reconcile).not.toHaveBeenCalled(); // ⬅️ ESKİDE: 'belirsiz' → uzlaştırma → gereksiz "ulaşmış olabilir" incelemesi
    expect(send).toHaveBeenCalledTimes(1);
    const row = await rowOf(s.rowId);
    expect(row.status).toBe("sent");
    expect(row.attemptCount).toBe(1); // çöken deneme sayılmadı (istek atılmamıştı)
    expect(row.lastErrorCode).not.toBe("claim_expired");
  });

  it("🚨 isteği ÇIKMIŞ satır (işaret var) eskisi gibi 'belirsiz': körlemesine yeniden GÖNDERİLMEZ, uzlaştırmaya gider", async () => {
    const s = await seed();
    await stale(s.rowId, { claimedBy: AWARE, dispatchStartedAt: new Date(Date.now() - 500_000) });
    const send = vi.fn<OutboxSendFn>(ok);
    const reconcile = vi.fn(async () => ({ found: false, providerMessageId: null }));
    await drainOutboxOnce({ send, reconcile, tokenFor: async () => "t" });
    expect(send).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledTimes(1);
    const row = await rowOf(s.rowId);
    expect(row.status).toBe("ambiguous");
    expect(row.dispatchStartedAt).not.toBeNull(); // uzlaştırma talebi işareti korur
  });

  it("🚨 KONTROL (geçiş kuralı): işareti hiç yazmayan ESKİ sürümün talebinde işaretin yokluğu kanıt değildir → 'belirsiz', yeniden gönderilmez", async () => {
    const s = await seed();
    await stale(s.rowId, { claimedBy: "eski-surum-iscisi" });
    const send = vi.fn<OutboxSendFn>(ok);
    const reconcile = vi.fn(async () => ({ found: false, providerMessageId: null }));
    await drainOutboxOnce({ send, reconcile, tokenFor: async () => "t" });
    expect(send).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect((await rowOf(s.rowId)).status).toBe("ambiguous");
  });

  it("talebi henüz DOLMAMIŞ satıra dokunulmaz (işçi hâlâ çalışıyor olabilir)", async () => {
    const s = await seed();
    await stale(s.rowId, { claimedBy: AWARE, claimExpiresAt: new Date(Date.now() + 60_000) });
    const send = vi.fn<OutboxSendFn>(ok);
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(send).not.toHaveBeenCalled();
    expect(await rowOf(s.rowId)).toMatchObject({ status: "sending", claimedBy: AWARE });
  });

  it("🚨 hazırlıkta çöken satır için iptal istenmişse yeniden GÖNDERİLMEZ: bekleyene döner ve aynı geçişte kapanır", async () => {
    const s = await seed();
    await stale(s.rowId, { claimedBy: AWARE, cancelRequestedAt: new Date(), cancelReason: "host_took_over" });
    const send = vi.fn<OutboxSendFn>(ok);
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(send).not.toHaveBeenCalled();
    expect(await rowOf(s.rowId)).toMatchObject({ status: "canceled", lastErrorCode: "host_took_over" });
  });

  it("🚨 kurtarma ile yavaş işçi yarışı: kurtarma satırı geri bıraktıysa eski işçi talebini kaybeder ve isteği ATAMAZ", async () => {
    const s = await seed();
    await stale(s.rowId, { claimedBy: AWARE });
    // Kurtarma + yeniden talep + gönderim (yeni işçi).
    await drainOutboxOnce({ send: ok, tokenFor: async () => "t" });
    // Yavaş kalan eski işçi şimdi gönderim başlangıcına varıyor.
    expect(await markDispatchStarted({ id: s.rowId, token: AWARE, now: new Date() })).toEqual({ kind: "lost" });
  });
});
