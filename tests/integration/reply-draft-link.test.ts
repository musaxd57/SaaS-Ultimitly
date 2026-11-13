import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { subMonths } from "date-fns";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// TASLAK ↔ EV SAHİBİNİN GÖNDERDİĞİ METİN BAĞI (kurucu 11-13: "embedding yapılarak asıl metin farkı incelenerek dahi tutulsun, buraya ML ekle";
// migration 96; tasarım docs/TASARIM-2026-11-13-taslak-gonderim-bagi.md). GÖLGE: gönderim başarılı olduktan sonra yazılır, gönderimi değiştirmez.
// Taslak = gönderimden önceki son gerçek misafir mesajının `aiSuggestedReply`'ı ("hazır taslak" kuralı). Metinler şifreli; saklama / misafir
// silmesi boşaltır, eklenen parçaları siler. Anlam ölçümü ertelenir (anahtarsızken satırlar beklemede).
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(async () => ({ ok: true, id: `sent-${Math.random().toString(36).slice(2)}` })),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn(async () => "tok") }));
const embed = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/ai/embeddings/provider", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/embeddings/provider")>()),
  embedTexts: embed.fn,
}));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { POST } from "@/app/api/conversations/[id]/reply/route";
import { decryptSecretBound } from "@/lib/crypto-core";
import {
  measureReplyDraftEmbeddings,
  loadDraftAcceptance,
  loadRecurringAdditionCandidates,
  recordReplyDraftLink,
  EMBEDDING_MAX_ATTEMPTS,
} from "@/lib/reply-draft/service";
import { anonymizeOldGuestData } from "@/lib/data-retention";
import { eraseReservationData } from "@/lib/erasure";
import { __resetOutboxPresence } from "@/lib/outbox/presence";

const DRAFT = "Merhaba, giriş saatimiz 15:00. Kapıda sizi bekliyor olacağız.";

function req(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/conversations/${id}/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("taslak ↔ gönderilen metin bağı", () => {
  let orgId: string;
  let propertyId: string;
  let conversationId: string;
  let reservationId: string;
  let guestMsgId: string;

  async function guestMessage(convId: string, body: string, draft: string | null, intent = "check_in") {
    return prisma.message.create({
      data: { conversationId: convId, direction: "inbound", body, senderName: "Misafir", aiSuggestedReply: draft, aiIntent: intent },
    });
  }
  const send = (body: unknown, convId = conversationId) => POST(req(convId, body), { params: Promise.resolve({ id: convId }) });

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("REPLY_DRAFT_LINK_ENABLED", "1");
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    propertyId = (await prisma.property.create({ data: { organizationId: orgId, name: "Lale 5" } })).id;
    reservationId = (
      await prisma.reservation.create({
        data: { propertyId, guestName: "Deniz", arrivalDate: new Date(), departureDate: new Date(Date.now() + 2 * 86_400_000), status: "confirmed", channel: "airbnb" },
      })
    ).id;
    conversationId = (
      await prisma.conversation.create({
        data: { propertyId, reservationId, guestIdentifier: "Deniz", channel: "airbnb", externalReservationId: "res-1", status: "waiting" },
      })
    ).id;
    guestMsgId = (await guestMessage(conversationId, "Saat kaçta girebiliriz?", DRAFT)).id;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "Owner", sessionEpoch: 0 };
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 'Onayla ve gönder' → bağ yazılır: unchanged, approved, taslak ŞİFRELİ (düz metin yok), konu etiketi taşınır", async () => {
    const res = await send({ body: DRAFT, aiAssisted: true, anchorMessageId: guestMsgId, draftUse: "approved" });
    expect(res.status).toBe(201);
    const sent = await prisma.message.findFirstOrThrow({ where: { conversationId, direction: "outbound" } });
    const link = await prisma.replyDraftLink.findUniqueOrThrow({ where: { sentMessageId: sent.id } });
    expect(link).toMatchObject({ anchorMessageId: guestMsgId, linkKind: "approved", outcome: "unchanged", intent: "check_in", embeddingState: "pending", semanticSim: null });
    expect(link.draftEnc).not.toContain("15:00");
    expect(decryptSecretBound(link.draftEnc!, `reply-draft:draft:${orgId}:${guestMsgId}`)).toBe(DRAFT);
  });

  it("🚨 'Taslağı kullan' → saat düzeltilip gönderildi: seeded, değer değişimi, major_edit (bugün bu gönderim 'elle yazıldı' görünüyordu)", async () => {
    const res = await send({ body: "Merhaba, giriş saatimiz 14:00. Kapıda sizi bekliyor olacağız.", draftUse: "seeded" });
    expect(res.status).toBe(201);
    const link = await prisma.replyDraftLink.findFirstOrThrow({ where: { conversationId } });
    expect(link).toMatchObject({ linkKind: "seeded", valueChanged: true, outcome: "major_edit" });
    expect(JSON.parse(link.editKindsJson)).toContain("corrected_value");
  });

  it("taslak kullanılmadan baştan yazıldı → implicit + rewritten; ekleme parçası sır maskeli ve şifreli saklanır", async () => {
    await send({ body: "Kapı kodumuz 4711, otopark arkada ücretsiz, akşam yedide ekibimiz orada olacak." });
    const link = await prisma.replyDraftLink.findFirstOrThrow({ where: { conversationId }, include: { spans: true } });
    expect(link).toMatchObject({ linkKind: "implicit", outcome: "rewritten" });
    expect(link.spans.length).toBeGreaterThan(0);
    for (const sp of link.spans) {
      const text = decryptSecretBound(sp.textEnc, `reply-draft:span:${orgId}:${sp.id}`);
      expect(text).not.toContain("4711");
      expect(sp.propertyId).toBe(propertyId);
    }
    expect(link.spans.some((sp) => sp.hasSecret)).toBe(true);
  });

  it("KONTROL — anahtar kapalı → satır YOK; kodun kurduğu cevap ('code') → satır YOK; son gerçek mesaj ev sahibinin → satır YOK", async () => {
    vi.stubEnv("REPLY_DRAFT_LINK_ENABLED", "0");
    expect((await send({ body: DRAFT })).status).toBe(201);
    expect(await prisma.replyDraftLink.count()).toBe(0);
    vi.stubEnv("REPLY_DRAFT_LINK_ENABLED", "1");
    // Önceki gönderim (anahtar kapalıyken) son gerçek mesajı ev sahibininki yaptı → yeni gönderim bağlanmaz.
    expect((await send({ body: "Ek bilgi: otopark arkada." })).status).toBe(201);
    expect(await prisma.replyDraftLink.count()).toBe(0);
    const g2 = await guestMessage(conversationId, "Erken giriş olur mu?", "Erken girişi kontrol edip size döneceğim.");
    expect((await send({ body: "Saat 13:00'te girebilirsiniz.", draftUse: "code" })).status).toBe(201);
    expect(await prisma.replyDraftLink.count({ where: { anchorMessageId: g2.id } })).toBe(0);
  });

  it("🚨 Haiku 11-13: taslağın önceki bağı misafire ULAŞMAMIŞ gönderime aitse, ev sahibinin ardından gönderdiği gerçek cevap onun yerini alır", async () => {
    expect((await send({ body: DRAFT, aiAssisted: true, anchorMessageId: guestMsgId, draftUse: "approved" })).status).toBe(201);
    const first = await prisma.message.findFirstOrThrow({ where: { conversationId, direction: "outbound" } });
    await prisma.messageOutbox.create({
      data: { organizationId: orgId, conversationId, messageId: first.id, channel: "airbnb", body: DRAFT, idempotencyKey: "rd-failed-1", status: "failed" },
    });
    __resetOutboxPresence();
    expect((await send({ body: "Merhaba, giriş saatimiz 14:00. Kapıda sizi bekliyor olacağız.", draftUse: "seeded" })).status).toBe(201);
    const links = await prisma.replyDraftLink.findMany({ where: { conversationId } });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ anchorMessageId: guestMsgId, linkKind: "seeded", valueChanged: true });
    expect(links[0].sentMessageId).not.toBe(first.id);
  });

  it("KONTROL — önceki bağ ULAŞMIŞ gönderime aitse korunur (ikinci mesaj bağlanmaz)", async () => {
    expect((await send({ body: DRAFT, aiAssisted: true, anchorMessageId: guestMsgId, draftUse: "approved" })).status).toBe(201);
    const first = await prisma.message.findFirstOrThrow({ where: { conversationId, direction: "outbound" } });
    await prisma.messageOutbox.create({
      data: { organizationId: orgId, conversationId, messageId: first.id, channel: "airbnb", body: DRAFT, idempotencyKey: "rd-sent-1", status: "sent" },
    });
    __resetOutboxPresence();
    await send({ body: "Ek bilgi: otopark arkada.", draftUse: "seeded" });
    const links = await prisma.replyDraftLink.findMany({ where: { conversationId } });
    expect(links.map((l) => l.sentMessageId)).toEqual([first.id]);
  });

  it("🚨 yarış (mutasyon Q14): önceki bağın gönderimi ULAŞMIŞ ama zaman damgası yeni gönderimden sonra → önceki bağ KORUNUR (silinmez)", async () => {
    const now = Date.now();
    const a = await prisma.message.create({
      data: { conversationId, direction: "outbound", body: DRAFT, senderName: "Owner", createdAt: new Date(now + 60_000) },
    });
    expect(await recordReplyDraftLink({ organizationId: orgId, conversationId, sentMessageId: a.id, sentBody: DRAFT, draftUse: "approved" })).toBe("recorded");
    const b = await prisma.message.create({
      data: { conversationId, direction: "outbound", body: "Başka cevap", senderName: "Owner", createdAt: new Date(now) },
    });
    expect(await recordReplyDraftLink({ organizationId: orgId, conversationId, sentMessageId: b.id, sentBody: "Başka cevap" })).toBe("duplicate");
    expect((await prisma.replyDraftLink.findMany()).map((l) => l.sentMessageId)).toEqual([a.id]);
  });

  it("aynı taslağa TEK bağ: aynı istek kimliğiyle yeniden deneme ikinci satır yazmaz; turdaki ikinci mesaj bağlanmaz", async () => {
    const body = { body: DRAFT, aiAssisted: true, anchorMessageId: guestMsgId, draftUse: "approved", requestId: "req-aaaa-1111" };
    expect((await send(body)).status).toBe(201);
    await send(body);
    await send({ body: "Bir de: otopark arkada." });
    expect(await prisma.replyDraftLink.count()).toBe(1);
  });

  describe("ertelenmiş anlam ölçümü (embedding)", () => {
    const unit = (x: number, y: number) => {
      const n = Math.hypot(x, y);
      return [x / n, y / n];
    };
    beforeEach(async () => {
      await send({ body: "Merhabalar, girişimiz saat 15:00, kapıda bekliyor olacağız; arkada ücretsiz otoparkımız var." , draftUse: "seeded" });
    });

    it("🚨 anahtar ya da embedding anahtarı yoksa HİÇBİR satıra dokunmaz (beklemede kalır), sağlayıcı çağrılmaz", async () => {
      expect(await measureReplyDraftEmbeddings()).toEqual({ measured: 0, skipped: 0, failed: 0 });
      vi.stubEnv("REPLY_DRAFT_EMBEDDING_ENABLED", "1");
      vi.stubEnv("OPENAI_API_KEY", "");
      expect(await measureReplyDraftEmbeddings()).toEqual({ measured: 0, skipped: 0, failed: 0 });
      expect(embed.fn).not.toHaveBeenCalled();
      expect((await prisma.replyDraftLink.findFirstOrThrow()).embeddingState).toBe("pending");
    });

    it("ölçüm: kosinüs saklanır, sınıf saklanan sayılarla YENİDEN kurulur, parça vektörleri yazılır", async () => {
      vi.stubEnv("REPLY_DRAFT_EMBEDDING_ENABLED", "1");
      vi.stubEnv("OPENAI_API_KEY", "sk-test");
      embed.fn.mockImplementation(async (texts: string[]) => texts.map((_, i) => (i < 2 ? unit(1, 0.05 * i) : unit(0.3, 1))));
      expect(await measureReplyDraftEmbeddings()).toEqual({ measured: 1, skipped: 0, failed: 0 });
      const link = await prisma.replyDraftLink.findFirstOrThrow({ include: { spans: true } });
      expect(link.embeddingState).toBe("done");
      expect(link.semanticSim).toBeGreaterThan(0.99);
      expect(link.embeddingModel).toBeTruthy();
      expect(link.spans.every((sp) => sp.vector && sp.dims === 2)).toBe(true);
      expect(await measureReplyDraftEmbeddings()).toEqual({ measured: 0, skipped: 0, failed: 0 });
    });

    it("sağlayıcı arızası → deneme sayacı artar, EMBEDDING_MAX_ATTEMPTS sonra 'failed'", async () => {
      vi.stubEnv("REPLY_DRAFT_EMBEDDING_ENABLED", "1");
      vi.stubEnv("OPENAI_API_KEY", "sk-test");
      embed.fn.mockResolvedValue(null);
      for (let i = 1; i < EMBEDDING_MAX_ATTEMPTS; i++) {
        await measureReplyDraftEmbeddings();
        expect((await prisma.replyDraftLink.findFirstOrThrow()).embeddingState).toBe("pending");
      }
      expect((await measureReplyDraftEmbeddings()).failed).toBe(1);
      expect((await prisma.replyDraftLink.findFirstOrThrow()).embeddingState).toBe("failed");
    });

    it("metni silinmiş satır ölçülmez → 'skipped'", async () => {
      vi.stubEnv("REPLY_DRAFT_EMBEDDING_ENABLED", "1");
      vi.stubEnv("OPENAI_API_KEY", "sk-test");
      await prisma.replyDraftLink.updateMany({ data: { draftEnc: null } });
      expect((await measureReplyDraftEmbeddings()).skipped).toBe(1);
      expect(embed.fn).not.toHaveBeenCalled();
    });
  });

  it("öğrenme okuyucuları: konu başına kabul + aynı dairede 3 konuşmada tekrar eden ekleme adayı", async () => {
    const addition = "arkada ücretsiz otoparkımız var";
    for (let i = 0; i < 3; i++) {
      const conv = await prisma.conversation.create({
        data: { propertyId, guestIdentifier: `G${i}`, channel: "airbnb", externalReservationId: `r-${i}`, status: "waiting" },
      });
      await guestMessage(conv.id, "Otopark var mı?", "Otopark sorunuz için teşekkürler, bakıyorum.", "parking");
      await send({ body: `Otopark sorunuz için teşekkürler, ${addition}, bakıyorum.`, draftUse: "seeded" }, conv.id);
    }
    const acc = await loadDraftAcceptance(orgId);
    expect(acc.get("parking")?.decided).toBe(3);
    const cands = await loadRecurringAdditionCandidates(orgId);
    expect(cands).toHaveLength(1);
    expect(cands[0]).toMatchObject({ propertyId, conversations: 3, text: addition });
  });

  it("🚨 misafir silmesi: şifreli taslak / fark / özet boşalır, eklenen parçalar SİLİNİR; ölçüler kalır", async () => {
    await send({ body: "Merhaba, giriş saatimiz 15:00. Kapıda bekliyor olacağız, arkada ücretsiz otoparkımız var.", draftUse: "seeded" });
    expect(await prisma.replyDraftSpan.count()).toBeGreaterThan(0);
    await eraseReservationData(orgId, reservationId);
    const link = await prisma.replyDraftLink.findFirstOrThrow();
    expect({ d: link.draftEnc, f: link.diffEnc, h: link.draftHash }).toEqual({ d: null, f: null, h: null });
    expect(link.outcome).toBeTruthy();
    expect(await prisma.replyDraftSpan.count()).toBe(0);
  });

  it("🚨 süre-bazlı saklama: eski konaklamanın bağ metinleri boşalır, parçaları silinir; seçim bacağı sonlanır (ikinci geçiş iş bulmaz)", async () => {
    await send({ body: "Merhaba, giriş saatimiz 15:00. Kapıda bekliyor olacağız, arkada ücretsiz otoparkımız var.", draftUse: "seeded" });
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { arrivalDate: subMonths(new Date(), 26), departureDate: subMonths(new Date(), 25), status: "completed" },
    });
    vi.stubEnv("DATA_RETENTION_MONTHS", "24");
    expect((await anonymizeOldGuestData()).anonymized).toBeGreaterThanOrEqual(1);
    const link = await prisma.replyDraftLink.findFirstOrThrow();
    expect({ d: link.draftEnc, f: link.diffEnc, h: link.draftHash }).toEqual({ d: null, f: null, h: null });
    expect(await prisma.replyDraftSpan.count()).toBe(0);
    expect((await anonymizeOldGuestData()).anonymized).toBe(0);
  });
});
