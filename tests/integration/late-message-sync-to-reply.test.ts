import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { FakeIngestProvider, canonicalMessage, canonicalReservation } from "../helpers/fake-ingest";

// ---------------------------------------------------------------------------
// S2 — SENKRON YAZICISI → ZAMANLANMIŞ OTO-YANIT GEÇİŞİ → SONRAKİ SENKRON, UÇTAN UCA (Opus 11-12 S2-8a).
//
// Öteki S2 testleri konuşmayı elle "Yeni" kurup `applyChannelAutoReply`ı doğrudan çağırır. Burada zincirin tamamı gerçek:
//   senkron (ilk soru) → zamanlanmış geçiş cevaplar → misafirin cevabımızdan 2 sn ÖNCE yazdığı mesaj sonraki senkronda gelir
//   → yazıcı konuşmayı "Yeni" çevirir (S1) → zamanlanmış geçiş (uygunluk + damga) → cevap → sonraki senkron "Cevaplandı" bırakır.
// Sağlayıcı = ortak ingest sahtesi; model çağrıları ve kanal gönderimi sahte; yazıcı, uygunluk sorgusu, damga ve akış gerçek.
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
vi.mock("@/lib/messaging", async (orig) => {
  const actual = await orig<typeof import("@/lib/messaging")>();
  return { ...actual, sendOnChannel: vi.fn() };
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
import { parseUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import { runDueChannelAutoReplies } from "@/lib/automation";
import { __setIngestAdapterForTest } from "@/lib/channels/ingest";
import { syncHospitable } from "@/lib/hospitable-sync";
import { setOrgHospitableToken, resetPrimaryOrgCache } from "@/lib/hospitable-credentials";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);
const mockUnderstand = vi.mocked(understandGuestMessages);

const TOKEN = "tok-org-A";
const HP = "hp-A";
const fake = new FakeIngestProvider();
const ARR = daysFromNow(-1);
const DEP = daysFromNow(3);
const MIN = 60_000;

const WIFI_ANSWER = "Wi-Fi şifresi panodaki kartta yazıyor.";
const PARKING_ANSWER = "Otopark ücretsizdir, binanın arkasındadır.";

const reservation = (lastMessageAt: Date) =>
  canonicalReservation({ externalId: "res-1", code: "HM1", arrivalDate: ARR, departureDate: DEP, conversationExternalId: "conv-1", conversationLanguage: "tr", lastMessageAt });
const guestMsg = (id: string, at: Date, body: string) => canonicalMessage({ externalId: id, createdAt: at, body });
const ourCopy = (id: string, at: Date, body: string) => canonicalMessage({ externalId: id, createdAt: at, body, direction: "outbound", senderName: "GuestOps AI" });

function understands(intent: string) {
  const u = parseUnderstanding(
    { language: "tr", requests: [{ query_tr: `${intent} sorusu`, query_original: "q", intent, message: 1 }], stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null }, withdrawn: [] },
    { items: true },
  );
  if (!u) throw new Error("fixture");
  mockUnderstand.mockResolvedValueOnce({ status: "ok", value: u, ms: 1, cached: false });
}
function verdict(intent: string, reply: string): SuggestReplyResult {
  return {
    intent, confidence: 0.95, reply, risk: null, priority: "standard", source: "openai", actionSuggestion: null, riskLevel: "none",
    detectedLanguage: "tr", riskType: null, usedSources: [], missingInfo: [], statedCheckoutTime: null, answeredRequests: { ok: true, refs: ["R1"] },
  };
}

async function seedOrg(closingReply = false) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      alertEmail: "host@example.com", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0,
      autoReplyEnabledAt: new Date(Date.now() - 30 * 24 * 60 * MIN), autoClosingReplyEnabled: closingReply,
    },
  });
  await prisma.knowledgeBaseItem.createMany({
    data: [
      { propertyId, category: "wifi", title: "Wi-Fi", content: "Wi-Fi şifresi panodaki kartta yazıyor.", isActive: true, source: "host_manual", reviewState: "approved" },
      { propertyId, category: "general", title: "Otopark", content: "Otopark ücretsizdir; binanın arkasındadır.", isActive: true, source: "host_manual", reviewState: "approved" },
    ],
  });
  await setOrgHospitableToken(orgId, TOKEN, "A");
  fake.addProperty(TOKEN, HP, "Test Property");
  return { orgId, propertyId };
}
const conversationOf = (propertyId: string) =>
  prisma.conversation.findFirstOrThrow({
    where: { propertyId, externalReservationId: "res-1" },
    select: { id: true, status: true, lastMessageAt: true, autoReplyAttemptedAt: true, messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { direction: true, body: true, createdAt: true, externalId: true } } },
  });
const sentBodies = () => mockSend.mock.calls.map((c) => String((c[0] as { body?: string }).body ?? c[1] ?? ""));

/** İlk soru senkronla gelir, zamanlanmış geçiş cevaplar; sonra misafirin cevabımızdan 2 sn ÖNCE yazdığı `lateBody` senkronla gelir. */
async function untilLateMessageImported(orgId: string, propertyId: string, lateBody: string) {
  const firstAt = new Date(Date.now() - 10 * MIN);
  const first = guestMsg("g-1", firstAt, "Wi-Fi şifresi ne?");
  fake.setReservations(HP, [reservation(firstAt)]);
  fake.setMessages("res-1", [first]);
  await syncHospitable(orgId);
  expect((await conversationOf(propertyId)).status).toBe("new");

  understands("wifi");
  mockSuggest.mockResolvedValueOnce(verdict("wifi", WIFI_ANSWER));
  mockSend.mockResolvedValueOnce({ ok: true, providerMessageId: "p-ai-1" } as never);
  expect((await runDueChannelAutoReplies(orgId)).sent).toBe(1);
  const afterFirst = await conversationOf(propertyId);
  expect(afterFirst.status).toBe("answered");
  const ours = afterFirst.messages.find((m) => m.direction === "outbound");
  if (!ours) throw new Error("ilk cevap satırı yok");

  // Misafir cevabımız yazılmadan 2 sn önce platformda yazdı; sağlayıcı sırasında cevabımızın ÖNÜNE düşer. Sağlayıcının son mesaj damgası = cevabımız.
  const late = guestMsg("g-2", new Date(ours.createdAt.getTime() - 2000), lateBody);
  const copy = ourCopy("p-ai-1", ours.createdAt, ours.body);
  fake.setReservations(HP, [reservation(ours.createdAt)]);
  fake.setMessages("res-1", [first, late, copy]);
  await syncHospitable(orgId);
  const flipped = await conversationOf(propertyId);
  // Yazıcının çevirmesi (S1) — S2'nin ön şartı.
  expect(flipped.status).toBe("new");
  expect(flipped.messages.map((m) => m.externalId)).toEqual(["g-1", "g-2", "p-ai-1"]);
  return { first, late, copy, ours };
}

describe("S2 uçtan uca — senkron → zamanlanmış oto-yanıt → senkron", () => {
  beforeEach(async () => {
    await resetDb();
    mockSuggest.mockReset();
    mockSend.mockReset();
    mockUnderstand.mockReset();
    fake.reset();
    resetPrimaryOrgCache();
    __setIngestAdapterForTest("hospitable", fake.adapter());
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("AI_CONVERSATION_ITEMS_ENABLED", "1");
  });
  afterEach(() => {
    __setIngestAdapterForTest("hospitable", null);
    vi.unstubAllEnvs();
    resetPrimaryOrgCache();
  });

  it("anahtar KAPALI (bugün): geç mesaj için model çağrılmaz, konuşma 'Yeni' kalır ve damgalanır (her geçişte yeniden denenmez)", async () => {
    const { orgId, propertyId } = await seedOrg();
    await untilLateMessageImported(orgId, propertyId, "Otopark var mı?");
    const out = await runDueChannelAutoReplies(orgId);
    expect(out.sent).toBe(0);
    expect(mockSuggest).toHaveBeenCalledTimes(1); // yalnız ilk cevap
    expect(mockSend).toHaveBeenCalledTimes(1);
    const conv = await conversationOf(propertyId);
    expect(conv.status).toBe("new");
    expect(conv.autoReplyAttemptedAt?.getTime()).toBe(conv.lastMessageAt.getTime());
    await runDueChannelAutoReplies(orgId);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
  });

  it("🚨 anahtar AÇIK: yazıcının 'Yeni' çevirdiği konuşmayı zamanlanmış geçiş cevaplar; sonraki senkron 'Cevaplandı' bırakır, ikinci cevap üretilmez", async () => {
    vi.stubEnv("AI_LATE_MESSAGE_REPLY_ENABLED", "1");
    const { orgId, propertyId } = await seedOrg();
    const { first, late, copy } = await untilLateMessageImported(orgId, propertyId, "Otopark var mı?");

    understands("parking");
    mockSuggest.mockResolvedValueOnce(verdict("parking", PARKING_ANSWER));
    mockSend.mockResolvedValueOnce({ ok: true, providerMessageId: "p-ai-2" } as never);
    expect((await runDueChannelAutoReplies(orgId)).sent).toBe(1); // ⬅️ anahtar kapalıyken 0
    expect(sentBodies()).toHaveLength(2);
    expect(sentBodies()[1]).toContain("Otopark ücretsizdir");
    // Cevap modeli geç mesajı SON mesaj olarak gördü; ilk cevabımız geçmişte.
    const input = mockSuggest.mock.calls[1]![0] as { guestMessage: string; history?: { body: string }[] };
    expect(input.guestMessage).toContain("Otopark var mı?");
    expect(input.history?.map((h) => h.body.split("\n")[0])).toEqual(["Wi-Fi şifresi ne?", WIFI_ANSWER, "Otopark var mı?"]);
    const answered = await conversationOf(propertyId);
    expect(answered.status).toBe("answered");

    // Sonraki senkron ikinci cevabımızın sağlayıcı kopyasını getirir: konuşma "Cevaplandı" kalır, geç mesaj artık geç değildir.
    const second = answered.messages[answered.messages.length - 1]!;
    fake.setReservations(HP, [reservation(second.createdAt)]);
    fake.setMessages("res-1", [first, late, copy, ourCopy("p-ai-2", second.createdAt, second.body)]);
    await syncHospitable(orgId);
    expect((await conversationOf(propertyId)).status).toBe("answered");
    expect((await runDueChannelAutoReplies(orgId)).sent).toBe(0);
    expect(mockSuggest).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("🚨 anahtar AÇIK (S2-2b, üretim biçimi): cevabımızdan 2 sn önce yazılmış geç 'teşekkürler' → misafire hiçbir şey gitmez, konuşma görünür kalır", async () => {
    // Kısa nezaket cevabı AÇIK. Geç mesajın anı sağlayıcının son mesaj damgasına (cevabımız) 5 saniyeden yakın — gizleme kuralının damga
    // kıyası onu "son hareket" sanardı: konuşma listeden düşer, "Rica ederiz" asıl cevabımızın hemen ardından giderdi.
    vi.stubEnv("AI_LATE_MESSAGE_REPLY_ENABLED", "1");
    const { orgId, propertyId } = await seedOrg(true);
    await untilLateMessageImported(orgId, propertyId, "Tamam, teşekkürler");
    const out = await runDueChannelAutoReplies(orgId);
    expect(out.sent).toBe(0);
    expect(mockSend).toHaveBeenCalledTimes(1); // yalnız ilk cevap
    const conv = await conversationOf(propertyId);
    expect(conv.status).toBe("new");
    // Bu mesaj için kalıcı hayır: damgalandı, bir sonraki geçişte yeniden değerlendirilmez.
    expect(conv.autoReplyAttemptedAt?.getTime()).toBe(conv.lastMessageAt.getTime());
  });
});
