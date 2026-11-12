import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// S2 (kurucu kararı 11-11; anahtar `AI_LATE_MESSAGE_REPLY_ENABLED`, VARSAYILAN KAPALI) — KANAL OTO-YANITI UÇTAN UCA.
//
// 10:00 "Wi-Fi şifresi ne?" → 10:05 otomatik cevabımız. Misafirin 10:04'te yazdığı "Otopark var mı?" bize 10:10'da ulaşıyor: sırada
// cevabımızın ÖNÜNE düşer → bugün `already_answered` (konuşma "Yeni" kalır, ev sahibi görür — S1, 11-04). Anahtar açıkken akış o mesajı
// cevabın ardına okur ve bugünkü bütün denetimlerden geçirerek cevaplar. Model çağrıları sahte, veritabanı gerçek.
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/ai", () => ({
  suggestReply: vi.fn(),
  classifyMessage: vi.fn(),
  summarizeHostStyle: vi.fn(),
  replyCallParams: vi.fn(() => ({ model: "m", effort: null })),
  replyPromptItemsOf: (items: { held: readonly unknown[] } | undefined) => ({ mode: items !== undefined, held: (items?.held.length ?? 0) > 0 }),
  replyPromptVersion: vi.fn((b: { mode: boolean; held: boolean }) => `v-${b.mode ? 1 : 0}${b.held ? 1 : 0}`),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn(async () => "tok"),
}));
vi.mock("@/lib/messaging", async (orig) => {
  const actual = await orig<typeof import("@/lib/messaging")>();
  return { ...actual, sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: "m-new" })) };
});
vi.mock("@/lib/ai/semantic/understand", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai/semantic/understand")>();
  return { ...actual, understandingEnabled: () => true, understandGuestMessages: vi.fn() };
});
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })) };
});

import { suggestReply } from "@/lib/ai";
import type { SuggestReplyResult } from "@/lib/ai/types";
import { sendOnChannel } from "@/lib/messaging";
import { understandGuestMessages } from "@/lib/ai/semantic/understand";
import { parseUnderstanding, type MessageUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import { applyChannelAutoReply } from "@/lib/automation";
import { __setChannelThreadPageForTests } from "@/lib/channel-thread-window";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);
const mockUnderstand = vi.mocked(understandGuestMessages);

const FIRST = "Wi-Fi şifresi ne?";
const OUR_REPLY = "Wi-Fi şifresi panodaki kartta yazıyor.";
const LATE = "Otopark var mı?";
const PARKING_ANSWER = "Otopark ücretsizdir, binanın arkasındadır.";

const STAY_NONE = { requested: false, kind: "none", checkin_time: null, checkout_time: null };
function understood(requests: { intent: string; message: number }[]): MessageUnderstanding {
  const u = parseUnderstanding(
    { language: "tr", requests: requests.map((r) => ({ query_tr: `${r.intent} sorusu`, query_original: "q", ...r })), stay_change: STAY_NONE, withdrawn: [] },
    { items: true },
  );
  if (!u) throw new Error("fixture");
  return u;
}
const understands = (requests: { intent: string; message: number }[]) =>
  mockUnderstand.mockResolvedValueOnce({ status: "ok", value: understood(requests), ms: 1, cached: false });

function verdict(over: Partial<SuggestReplyResult> = {}): SuggestReplyResult {
  return {
    intent: "parking",
    confidence: 0.95,
    reply: PARKING_ANSWER,
    risk: null,
    priority: "standard",
    source: "openai",
    actionSuggestion: null,
    riskLevel: "none",
    detectedLanguage: "tr",
    riskType: null,
    usedSources: [],
    missingInfo: [],
    statedCheckoutTime: null,
    answeredRequests: { ok: true, refs: ["R1"] },
    ...over,
  };
}

const MIN = 60_000;
type SeedOptions = {
  /** Kaçırılan cevabın yazarı (varsayılan: yapay zekâ). */
  replyAuthor?: "ai" | "host";
  /** Geç mesajın metni. */
  late?: string;
  /** Geç mesaj kaç dakika önce yazıldı (varsayılan 16; cevabımız 15 dakika önce). */
  lateWrittenMinAgo?: number;
  /** Cevabımız kaç dakika önce yazıldı. */
  replyMinAgo?: number;
  /** Cevaptan SONRA yazılmış (olağan) yeni misafir mesajı. */
  after?: string;
};

/** İlk soru (cevaptan önce alındı) → cevabımız → cevaptan ÖNCE yazılıp SONRA alınan geç mesaj. Konuşma "Yeni" (S1 çevirmesi). */
async function seed(o: SeedOptions = {}) {
  const now = Date.now();
  const replyAt = now - (o.replyMinAgo ?? 15) * MIN;
  const lateAt = now - (o.lateWrittenMinAgo ?? 16) * MIN;
  const org = await prisma.organization.create({
    data: {
      name: "Org",
      alertEmail: "host@example.com",
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0,
      autoReplyEnabledAt: new Date(now - 30 * 24 * 60 * MIN),
    },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 7" } });
  await prisma.knowledgeBaseItem.create({
    data: { propertyId: property.id, category: "general", title: "Otopark", content: "Otopark ücretsizdir; binanın arkasındadır.", isActive: true, source: "host_manual", reviewState: "approved" },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      externalReservationId: "res-1",
      status: "new",
      lastMessageAt: new Date(now - 10 * MIN),
      messages: {
        create: [
          { direction: "inbound", senderName: "Alex", authorType: "guest", body: FIRST, externalId: "ext-1", createdAt: new Date(replyAt - 5 * MIN), ingestedAt: new Date(replyAt - 4 * MIN) },
          { direction: "outbound", senderName: "GuestOps AI", authorType: o.replyAuthor ?? "ai", body: OUR_REPLY, externalId: "ext-r", createdAt: new Date(replyAt) },
          { direction: "inbound", senderName: "Alex", authorType: "guest", body: o.late ?? LATE, externalId: "ext-2", createdAt: new Date(lateAt), ingestedAt: new Date(now - 10 * MIN) },
          ...(o.after
            ? [{ direction: "inbound", senderName: "Alex", authorType: "guest", body: o.after, externalId: "ext-3", createdAt: new Date(now - 9 * MIN), ingestedAt: new Date(now - 8 * MIN) }]
            : []),
        ],
      },
    },
  });
  return { conversationId: conversation.id };
}

const itemsOf = async (conversationId: string) =>
  (await prisma.conversationItem.findMany({ where: { conversationId }, orderBy: [{ createdAt: "asc" }, { requestIndex: "asc" }, { id: "asc" }] })).map((r) => ({
    kind: r.kind,
    status: r.status,
  }));
const sentBodies = () => mockSend.mock.calls.map((c) => String((c[0] as { body?: string }).body ?? c[1] ?? ""));
const statusOf = async (id: string) => (await prisma.conversation.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

describe("kanal oto-yanıtı — geç içeri alınan misafir mesajı (S2)", () => {
  beforeEach(async () => {
    await resetDb();
    mockSuggest.mockReset();
    mockSend.mockClear();
    mockUnderstand.mockReset();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("AI_CONVERSATION_ITEMS_ENABLED", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    __setChannelThreadPageForTests(null);
  });

  it("anahtar KAPALI (bugün): geç mesaja yapay zekâ cevap vermez — `already_answered`, model çağrılmaz, konuşma 'Yeni' kalır", async () => {
    const { conversationId } = await seed();
    const out = await applyChannelAutoReply(conversationId);
    expect(out).toMatchObject({ sent: false, skippedReason: "already_answered" });
    expect(mockUnderstand).not.toHaveBeenCalled();
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(await statusOf(conversationId)).toBe("new");
  });

  it("🚨 anahtar AÇIK: geç mesaj cevapsız tur olarak okunur ve cevaplanır; cevabımız geçmişte, geç mesaj son mesajdır", async () => {
    vi.stubEnv("AI_LATE_MESSAGE_REPLY_ENABLED", "1");
    const { conversationId } = await seed();
    understands([{ intent: "parking", message: 1 }]);
    mockSuggest.mockResolvedValueOnce(verdict());
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(true); // ⬅️ ESKİDE already_answered
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(sentBodies()[0]).toContain("Otopark ücretsizdir");
    // Cevap modeline giden: son misafir mesajı GEÇ mesaj; geçmişin sırası ilk soru → cevabımız → geç mesaj.
    const input = mockSuggest.mock.calls[0]![0] as {
      guestMessage: string;
      history?: { body: string; direction: string }[];
      conversationItems?: { answerable: { kind: string; late?: boolean }[] };
    };
    expect(input.guestMessage).toContain(LATE);
    expect(input.history?.map((h) => h.body)).toEqual([FIRST, OUR_REPLY, LATE]);
    // Cevap modeli isteğin GEÇ ulaştığını bilir (son cevabımız onu görmeden gitti) — tekrar eden soruyu yeniden cevaplamasın diye.
    expect(input.conversationItems?.answerable.map((a) => [a.kind, a.late ?? false])).toEqual([["parking", true]]);
    // Anlama katmanına yalnız cevapsız tur (geç mesaj) gider — cevapladığımız ilk soru değil.
    const understanding = JSON.stringify(mockUnderstand.mock.calls[0]![0]);
    expect(understanding).toContain(LATE);
    // İstek öğesi geç mesaja bağlı açılır ve bu cevapla kapanır; konuşma cevaplandı.
    expect(await itemsOf(conversationId)).toEqual([{ kind: "parking", status: "answered" }]);
    expect(await statusOf(conversationId)).toBe("answered");
    // Yeni cevap veritabanında en sonda; geç mesajın kendi yazılma anı değişmedi (sırada hâlâ eski cevabın önünde).
    const rows = await prisma.message.findMany({ where: { conversationId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { body: true } });
    expect(rows.map((r) => r.body.split("\n")[0])).toEqual([FIRST, LATE, OUR_REPLY, expect.stringContaining("Otopark ücretsizdir")]);
  });

  it("🚨 anahtar AÇIK: cevaplandıktan sonra aynı geç mesaj ikinci kez cevaplanmaz (yeni cevap onu gördü)", async () => {
    vi.stubEnv("AI_LATE_MESSAGE_REPLY_ENABLED", "1");
    const { conversationId } = await seed();
    understands([{ intent: "parking", message: 1 }]);
    mockSuggest.mockResolvedValueOnce(verdict());
    expect((await applyChannelAutoReply(conversationId)).sent).toBe(true);
    // Senkron yeni cevabımızı sağlayıcıdan geri getirmeden önce de, sonra da: tur yok.
    await prisma.conversation.update({ where: { id: conversationId }, data: { status: "new" } });
    const again = await applyChannelAutoReply(conversationId);
    expect(again).toMatchObject({ sent: false, skippedReason: "already_answered" });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
  });

  it("🚨 anahtar AÇIK: kaçırılan cevabı EV SAHİBİ yazdıysa yapay zekâ karışmaz", async () => {
    vi.stubEnv("AI_LATE_MESSAGE_REPLY_ENABLED", "1");
    const { conversationId } = await seed({ replyAuthor: "host" });
    const out = await applyChannelAutoReply(conversationId);
    expect(out).toMatchObject({ sent: false, skippedReason: "already_answered" });
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("🚨 anahtar AÇIK: 24 saatten önce yazılmış geç mesaj cevaplanmaz", async () => {
    vi.stubEnv("AI_LATE_MESSAGE_REPLY_ENABLED", "1");
    const { conversationId } = await seed({ replyMinAgo: 24 * 60, lateWrittenMinAgo: 24 * 60 + 1 });
    const out = await applyChannelAutoReply(conversationId);
    expect(out).toMatchObject({ sent: false, skippedReason: "already_answered" });
    expect(mockSuggest).not.toHaveBeenCalled();
    // KONTROL: aynı dizilim sınırın içindeyken cevaplanır.
    await resetDb();
    const fresh = await seed({ replyMinAgo: 23 * 60, lateWrittenMinAgo: 23 * 60 + 1 });
    understands([{ intent: "parking", message: 1 }]);
    mockSuggest.mockResolvedValueOnce(verdict());
    expect((await applyChannelAutoReply(fresh.conversationId)).sent).toBe(true);
  });

  it("anahtar AÇIK: geç mesaj hassas bir istekse (evcil hayvan) bugünkü kural — cevap gitmez, istek ev sahibinde", async () => {
    vi.stubEnv("AI_LATE_MESSAGE_REPLY_ENABLED", "1");
    const { conversationId } = await seed({ late: "Köpeğimizi getirebilir miyiz?" });
    understands([{ intent: "pets", message: 1 }]);
    mockSuggest.mockResolvedValue(verdict({ reply: "Evet, getirebilirsiniz.", answeredRequests: { ok: true, refs: [] } }));
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await itemsOf(conversationId)).toEqual([{ kind: "pets", status: "pending_host" }]);
  });

  it("anahtar AÇIK: geç mesaj kapanışsa (teşekkür) cevap üretilmez", async () => {
    vi.stubEnv("AI_LATE_MESSAGE_REPLY_ENABLED", "1");
    const { conversationId } = await seed({ late: "Tamam, teşekkürler" });
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(false);
    // Anahtar kapalıyken sebep `already_answered` olurdu; açıkken mesaj cevapsız tur olarak okundu ve KAPANIŞ sayıldı. Kapanış mesajı
    // konuşmanın son hareketi olmadığı için (cevabımız daha yeni) konuşma gizlenmez — görünür kalır.
    expect(out.skippedReason).toBe("closing_ack_open");
    expect(mockSuggest).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("🚨 geç mesaj + cevaptan SONRA yazılmış yeni mesaj: anahtar açıkken ikisi de cevapsız turdadır (kapalıyken yalnız yenisi)", async () => {
    const AFTER = "Çıkış saati kaç?";
    // KAPALI: tur yalnız yeni mesaj — geç mesaj cevaplanmış geçmiş gibi okunur.
    let seeded = await seed({ after: AFTER });
    understands([{ intent: "checkout_time", message: 1 }]);
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "checkout_time", reply: "Çıkış saati 11:00." }));
    await applyChannelAutoReply(seeded.conversationId);
    let input = mockSuggest.mock.calls[0]![0] as { history?: { body: string }[]; conversationItems?: { answerable: { kind: string; late?: boolean }[] } };
    expect(input.history?.map((h) => h.body)).toEqual([FIRST, LATE, OUR_REPLY, AFTER]);
    expect(input.conversationItems?.answerable.some((a) => a.late)).toBe(false);
    // AÇIK: geç mesaj cevabın ardına, yeni mesajın önüne gelir → ikisi de cevapsız tur.
    await resetDb();
    mockSuggest.mockReset();
    mockUnderstand.mockReset();
    vi.stubEnv("AI_LATE_MESSAGE_REPLY_ENABLED", "1");
    seeded = await seed({ after: AFTER });
    understands([
      { intent: "parking", message: 1 },
      { intent: "checkout_time", message: 2 },
    ]);
    mockSuggest.mockResolvedValueOnce(verdict({ reply: `${PARKING_ANSWER} Çıkış saati 11:00.`, answeredRequests: { ok: true, refs: ["R1", "R2"] } }));
    await applyChannelAutoReply(seeded.conversationId);
    input = mockSuggest.mock.calls[0]![0] as { history?: { body: string }[]; conversationItems?: { answerable: { kind: string; late?: boolean }[] } };
    expect(input.history?.map((h) => h.body)).toEqual([FIRST, OUR_REPLY, LATE, AFTER]);
    // Yalnız geç ulaşan mesajın isteği işaretli; cevaptan sonra yazılan olağan mesajınki değil.
    expect(input.conversationItems?.answerable.map((a) => [a.kind, a.late ?? false])).toEqual([["parking", true], ["checkout_time", false]]);
    expect((await itemsOf(seeded.conversationId)).map((i) => i.kind).sort()).toEqual(["checkout_time", "parking"]);
  });

  it("🚨 konuşma sayfa sayfa okunurken de (kesit geriye genişlerken) geç mesaj cevabın ardında kalır", async () => {
    // Sayfa boyu 2: ilk sayfa [geç mesaj, cevabımız]; kesit yetmediği için bir sayfa daha okunur — yeniden kurulan görünüm de aynı sırada olmalı.
    __setChannelThreadPageForTests(2);
    vi.stubEnv("AI_LATE_MESSAGE_REPLY_ENABLED", "1");
    const { conversationId } = await seed();
    understands([{ intent: "parking", message: 1 }]);
    mockSuggest.mockResolvedValueOnce(verdict());
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(true);
    const input = mockSuggest.mock.calls[0]![0] as { guestMessage: string; history?: { body: string }[] };
    expect(input.history?.map((h) => h.body)).toEqual([FIRST, OUR_REPLY, LATE]);
    expect(input.guestMessage).toContain(LATE);
  });

  it("🚨 kuyruk yolu: geç mesajın cevabı sıraya girer ve gönderim anı denetiminden geçer (kaçırdığı eski cevap onu durdurmaz)", async () => {
    vi.stubEnv("AI_LATE_MESSAGE_REPLY_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
    const { conversationId } = await seed();
    understands([{ intent: "parking", message: 1 }]);
    mockSuggest.mockResolvedValueOnce(verdict());
    const out = await applyChannelAutoReply(conversationId);
    expect(out).toMatchObject({ sent: true, queued: true });
    expect(mockSend).not.toHaveBeenCalled(); // doğrudan gönderim yok — kuyruk
    const queued = await prisma.messageOutbox.findMany({ where: { conversationId }, select: { status: true, idempotencyKey: true } });
    expect(queued).toHaveLength(1);
    // Gönderim kimliği geç mesaja bağlı (turun son misafir mesajı).
    const lateRow = await prisma.message.findFirstOrThrow({ where: { conversationId, body: LATE }, select: { id: true } });
    expect(queued[0]!.idempotencyKey).toBe(`auto:${conversationId}:${lateRow.id}`);
    const delivered: string[] = [];
    const send: OutboxSendFn = async (input) => {
      delivered.push(input.body);
      return { ok: true, providerMessageId: "p-1" };
    };
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toContain("Otopark ücretsizdir");
    expect((await prisma.messageOutbox.findMany({ where: { conversationId }, select: { status: true } })).map((r) => r.status)).toEqual(["sent"]);
    // KONTROL: taslak sıradayken misafir YENİ bir mesaj yazarsa bayat cevap gitmez (var olan veto — geç tur için de geçerli).
    await resetDb();
    mockSuggest.mockReset();
    mockUnderstand.mockReset();
    const second = await seed();
    understands([{ intent: "parking", message: 1 }]);
    mockSuggest.mockResolvedValueOnce(verdict());
    await applyChannelAutoReply(second.conversationId);
    await prisma.message.create({
      data: { conversationId: second.conversationId, direction: "inbound", senderName: "Alex", authorType: "guest", body: "Bir şey daha soracağım", externalId: "ext-new", createdAt: new Date(), ingestedAt: new Date() },
    });
    delivered.length = 0;
    await drainOutboxOnce({ send, tokenFor: async () => "t" });
    expect(delivered).toHaveLength(0);
  });
});
