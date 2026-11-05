import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// Tur 7 T7-OB-1 adım 2 — kuyruktaki yapay zekâ taslağı ve misafirin sorusu, İHTİYAÇ BAZINDA (kurucu 11-05; tasarım
// `docs/TASARIM-2026-11-05-bayat-taslak-soru-kaybolmasin.md`). Kurucunun beklenen davranışları:
//  · "Otopark var mı?" + "Havlu da lazım" → iki ihtiyaç da korunur, her biri kendi kuralıyla değerlendirilir.
//  · "Wi-Fi şifresi?" + "Teşekkürler" → teşekkür tek başına vazgeçme değildir.
//  · "Havlu istemiyorum; Wi-Fi şifresini gönderin" → yalnız havlu ihtiyacı geri çekilir.
//  · Belirsiz gönderim → kör tekrar yok, ama konuşma süresiz kilitlenmez; yeni mesajlar kaydedilir, tehlike kontrolleri sürer; sonuç
//    doğrulanamıyorsa ev sahibinin çözebileceği görünür durum kalır; süre geçti diye "gönderilmedi" sayılmaz.
//  · İptal edilmiş taslak soruyu sonsuza kadar kilitlemez; bekleyen taslak gönderilmiş sayılmaz (geçildiyse).
// Her durumda iki yön: aynı soruya İKİ cevap gitmez VE soru sessizce kaybolmaz. Model çağrıları sahte (cevap + anlama katmanı); kuyruk,
// veritabanı ve gönderim anı vetosu gerçek.
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
  return { ...actual, sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: "inline-1" })) };
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
import { emailService } from "@/lib/email";
import { importCanonicalThread } from "@/lib/ingest/write-service";
import type { SuggestReplyResult } from "@/lib/ai/types";
import { sendOnChannel } from "@/lib/messaging";
import { understandGuestMessages } from "@/lib/ai/semantic/understand";
import { parseUnderstanding, type MessageUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import { applyChannelAutoReply, runDueChannelAutoReplies } from "@/lib/automation";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";
import { __setChannelThreadPageForTests } from "@/lib/channel-thread-window";

const mockSuggest = vi.mocked(suggestReply);
const mockUnderstand = vi.mocked(understandGuestMessages);
const mockInlineSend = vi.mocked(sendOnChannel);
const mockMail = vi.mocked(emailService.sendReporting);

const STAY_NONE = { requested: false, kind: "none", checkin_time: null, checkout_time: null };
function understood(requests: { intent: string; message: number }[], withdrawn: { intent: string; message: number }[] = []): MessageUnderstanding {
  const u = parseUnderstanding(
    { language: "tr", requests: requests.map((r) => ({ query_tr: `${r.intent} sorusu`, query_original: "q", ...r })), stay_change: STAY_NONE, withdrawn },
    { items: true },
  );
  if (!u) throw new Error("fixture");
  return u;
}
const understands = (u: MessageUnderstanding) => mockUnderstand.mockResolvedValueOnce({ status: "ok", value: u, ms: 1, cached: false });

function verdict(over: Partial<SuggestReplyResult> = {}): SuggestReplyResult {
  return {
    intent: "general",
    confidence: 0.95,
    reply: "Anlaşıldı.",
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
    ...over,
  };
}

const PARKING = "Binanın önünde ücretsiz otopark var.";
const TOWELS = "Havlular yatak odasındaki dolabın üst rafında.";
const WIFI = "Wi-Fi ağı Lale-5G, şifre modemin altında yazıyor.";

async function seed(firstGuestMessage: string) {
  const org = await prisma.organization.create({
    data: {
      name: "Org",
      alertEmail: "host@example.com",
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0,
      autoReplyEnabledAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      // Gönderilen gövde birebir karşılaştırılır: "(Bu yanıt otomatik asistan tarafından hazırlandı.)" eki bu dosyanın konusu değil.
      autoReplyDisclosure: false,
    },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 7" } });
  const createdAt = new Date(Date.now() - 20 * 60_000);
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      externalReservationId: "res-sd",
      status: "new",
      lastMessageAt: createdAt,
      messages: { create: [{ direction: "inbound", senderName: "Alex", authorType: "guest", body: firstGuestMessage, createdAt }] },
    },
  });
  return { orgId: org.id, conversationId: conversation.id };
}

async function guestWrites(conversationId: string, body: string, at: Date = new Date()) {
  const m = await prisma.message.create({ data: { conversationId, direction: "inbound", senderName: "Alex", authorType: "guest", body, createdAt: at } });
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: at, status: "new" } });
  return m.id;
}

async function hostWrites(conversationId: string, body: string) {
  const at = new Date();
  await prisma.message.create({ data: { conversationId, direction: "outbound", senderName: "Ev sahibi", authorType: "host", body, createdAt: at } });
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: at, status: "answered" } });
}

const sent: string[] = [];
const okSend: OutboxSendFn = async (input) => {
  sent.push(input.body);
  return { ok: true, providerMessageId: `p-${sent.length}` };
};
const deliver = (send: OutboxSendFn = okSend) => drainOutboxOnce({ send, tokenFor: async () => "t" });
const rows = (conversationId: string) =>
  prisma.messageOutbox.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" }, select: { idempotencyKey: true, status: true, lastErrorCode: true, body: true } });
const items = (conversationId: string) =>
  prisma.conversationItem.findMany({ where: { conversationId }, orderBy: [{ createdAt: "asc" }, { requestIndex: "asc" }, { id: "asc" }], select: { kind: true, status: true } });
const statusOf = async (conversationId: string, kind: string) => (await items(conversationId)).filter((i) => i.kind === kind).map((i) => i.status);

describe("Tur 7 T7-OB-1 adım 2 — kuyruktaki taslak ihtiyaç bazında", () => {
  beforeEach(async () => {
    await resetDb();
    sent.length = 0;
    mockSuggest.mockReset();
    mockUnderstand.mockReset();
    mockInlineSend.mockClear();
    mockMail.mockClear();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("AI_CONVERSATION_ITEMS_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    __setChannelThreadPageForTests(null);
  });

  it("🚨 'Otopark var mı?' kuyruktayken 'Bir de havlu lazım' → İKİSİ birlikte cevaplanır, misafire TEK mesaj; bayat taslak gitmez", async () => {
    const { conversationId } = await seed("Otopark var mı?");
    understands(understood([{ intent: "parking", message: 1 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "parking", reply: PARKING, answeredRequests: { ok: true, refs: ["R1"] } }));
    await applyChannelAutoReply(conversationId);
    expect((await rows(conversationId)).map((r) => r.status)).toEqual(["pending"]);

    await guestWrites(conversationId, "Bir de havlu lazım.");
    understands(understood([{ intent: "parking", message: 1 }, { intent: "cleaning_linen", message: 2 }]));
    mockSuggest.mockResolvedValueOnce(
      verdict({ intent: "cleaning_linen", reply: `${PARKING} ${TOWELS}`, answeredRequests: { ok: true, refs: ["R1", "R2"] } }),
    );
    await applyChannelAutoReply(conversationId);
    // Modele İLK soru da gitti (bekleyen taslak "gönderilmiş" sayılmadı).
    const prompt = JSON.stringify(mockSuggest.mock.calls.at(-1));
    expect(prompt).toContain("Otopark var mı?");

    await deliver();
    await deliver();
    expect(sent).toEqual([`${PARKING} ${TOWELS}`]);
    const r = await rows(conversationId);
    expect(r.map((x) => x.status)).toEqual(["canceled", "sent"]);
    expect(r[0]!.lastErrorCode).toBe("superseded_by_newer_message");
    expect(await statusOf(conversationId, "parking")).toEqual(["answered"]);
    expect(await statusOf(conversationId, "cleaning_linen")).toEqual(["answered"]);
  });

  for (const page of [null, 2] as const) {
  it(`🚨 model düşünürken yazılan mesaj (tetikten SONRA, taslaktan ÖNCE kaydedildi) → veto taslağı iptal eder, bu tur da onu yok sayar: iki soru TEK cevapta${page ? ` (tetik okunan ilk sayfanın DIŞINDA — sayfa ${page})` : ""}`, async () => {
    __setChannelThreadPageForTests(page);
    const { conversationId } = await seed("Otopark var mı?");
    understands(understood([{ intent: "parking", message: 1 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "parking", reply: PARKING, answeredRequests: { ok: true, refs: ["R1"] } }));
    await applyChannelAutoReply(conversationId);
    const draft = await prisma.message.findFirstOrThrow({ where: { conversationId, direction: "outbound" } });
    // Misafir model çalışırken yazdı: sağlayıcı damgası taslağın kaydından ÖNCE (tetikten sonra).
    await guestWrites(conversationId, "Bir de havlu lazım.", new Date(draft.createdAt.getTime() - 1_000));
    understands(understood([{ intent: "parking", message: 1 }, { intent: "cleaning_linen", message: 2 }]));
    mockSuggest.mockResolvedValueOnce(
      verdict({ intent: "cleaning_linen", reply: `${PARKING} ${TOWELS}`, answeredRequests: { ok: true, refs: ["R1", "R2"] } }),
    );
    const out = await applyChannelAutoReply(conversationId);
    expect(out.skippedReason).toBeUndefined();
    await deliver();
    await deliver();
    expect(sent).toEqual([`${PARKING} ${TOWELS}`]);
  });
  }

  it("🚨 'Wi-Fi şifresi neydi?' kuyruktayken 'Teşekkürler' → teşekkür vazgeçme DEĞİL: Wi-Fi cevaplanır (tek mesaj)", async () => {
    const { conversationId } = await seed("Wi-Fi şifresi neydi?");
    understands(understood([{ intent: "wifi", message: 1 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "wifi", reply: WIFI, answeredRequests: { ok: true, refs: ["R1"] } }));
    await applyChannelAutoReply(conversationId);

    await guestWrites(conversationId, "Teşekkürler");
    understands(understood([{ intent: "wifi", message: 1 }, { intent: "greeting_thanks", message: 2 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "wifi", reply: WIFI, answeredRequests: { ok: true, refs: ["R1"] } }));
    const out = await applyChannelAutoReply(conversationId);
    expect(out.skippedReason).toBeUndefined();
    await deliver();
    await deliver();
    expect(sent).toEqual([WIFI]);
    expect(await statusOf(conversationId, "wifi")).toEqual(["answered"]);
  });

  it("🚨 'Havlu lazım' kuyruktayken 'Havlu istemiyorum; Wi-Fi şifresini gönderin' → YALNIZ havlu geri çekilir, Wi-Fi cevaplanır, havlu cevabı gitmez", async () => {
    const { conversationId } = await seed("Havlu lazım.");
    understands(understood([{ intent: "cleaning_linen", message: 1 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "cleaning_linen", reply: TOWELS, answeredRequests: { ok: true, refs: ["R1"] } }));
    await applyChannelAutoReply(conversationId);

    await guestWrites(conversationId, "Havlu istemiyorum; Wi-Fi şifresini gönderin.");
    // Anlama katmanı her cevapsız mesajın isteğini yeniden yazar (yoksa tur öğeye bölünmez — `message_without_request`); vazgeçme ayrıca.
    understands(understood([{ intent: "cleaning_linen", message: 1 }, { intent: "wifi", message: 2 }], [{ intent: "cleaning_linen", message: 1 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "wifi", reply: WIFI, answeredRequests: { ok: true, refs: ["R1"] } }));
    await applyChannelAutoReply(conversationId);
    await deliver();
    await deliver();
    expect(sent).toEqual([WIFI]);
    expect(await statusOf(conversationId, "cleaning_linen")).toEqual(["withdrawn"]);
    expect(await statusOf(conversationId, "wifi")).toEqual(["answered"]);
  });

  it("🚨 tur yeniden açılan ihtiyacı DEĞERLENDİREMEZSE (anlama katmanı düştü) soru sessiz kalmaz: ev sahibinde uyarıyla açık (pending_host)", async () => {
    const { conversationId } = await seed("Otopark var mı?");
    understands(understood([{ intent: "parking", message: 1 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "parking", reply: PARKING, answeredRequests: { ok: true, refs: ["R1"] } }));
    await applyChannelAutoReply(conversationId);
    expect(await statusOf(conversationId, "parking")).toEqual(["answered"]);

    await guestWrites(conversationId, "Bir de havlu lazım.");
    mockUnderstand.mockResolvedValueOnce({ status: "failed", ms: 1 });
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "cleaning_linen", reply: `${PARKING} ${TOWELS}` }));
    await applyChannelAutoReply(conversationId);
    await deliver();
    await deliver();
    // Bayat taslak yine gitmedi; ihtiyaç "cevaplandı" görünmüyor ve ev sahibine kalan durumda (uyarı rozeti) — sessiz "open" değil.
    expect(sent).not.toContain(PARKING);
    expect(await statusOf(conversationId, "parking")).toEqual(["pending_host"]);
  });

  it("KONTROL — geçilmemiş bekleyen taslak 'gönderilmiş' kalır: yeniden tur ikinci cevap ÜRETMEZ (model çağrılmaz), taslak bir kez gider", async () => {
    const { conversationId } = await seed("Otopark var mı?");
    understands(understood([{ intent: "parking", message: 1 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "parking", reply: PARKING, answeredRequests: { ok: true, refs: ["R1"] } }));
    await applyChannelAutoReply(conversationId);
    const again = await applyChannelAutoReply(conversationId);
    expect(again.sent).toBe(false);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    await deliver();
    expect(sent).toEqual([PARKING]);
  });

  it("🚨 duraklatma yüzünden iptal edilen taslak soruyu KİLİTLEMEZ: süre bitince aynı soru yeniden değerlendirilir ve BİR kez cevaplanır", async () => {
    const { conversationId } = await seed("Otopark var mı?");
    understands(understood([{ intent: "parking", message: 1 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "parking", reply: PARKING, answeredRequests: { ok: true, refs: ["R1"] } }));
    await applyChannelAutoReply(conversationId);
    await prisma.conversation.update({ where: { id: conversationId }, data: { autoReplyHoldUntil: new Date(Date.now() + 60 * 60_000) } });
    await deliver();
    expect((await rows(conversationId)).map((r) => [r.status, r.lastErrorCode])).toEqual([["canceled", "ai_paused"]]);
    expect(await statusOf(conversationId, "parking")).not.toEqual(["answered"]);

    await prisma.conversation.update({ where: { id: conversationId }, data: { autoReplyHoldUntil: new Date(Date.now() - 1_000) } });
    understands(understood([{ intent: "parking", message: 1 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "parking", reply: PARKING, answeredRequests: { ok: true, refs: ["R1"] } }));
    const out = await applyChannelAutoReply(conversationId);
    expect(out.skippedReason).toBeUndefined();
    await deliver();
    await deliver();
    expect(sent).toEqual([PARKING]);
    const r = await rows(conversationId);
    expect(r.map((x) => x.status)).toEqual(["canceled", "sent"]);
    expect(r[1]!.idempotencyKey.endsWith("#r2")).toBe(true);
    // Aynı tetikte yeni tur: gönderilmiş sürüm tekilleştirir → üçüncü satır yok.
    understands(understood([{ intent: "parking", message: 1 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "parking", reply: PARKING, answeredRequests: { ok: true, refs: ["R1"] } }));
    await prisma.conversation.update({ where: { id: conversationId }, data: { status: "new" } });
    await applyChannelAutoReply(conversationId);
    expect(await rows(conversationId)).toHaveLength(2);
  });

  it("KONTROL — BAYAT iptal (genel anahtar kapalıyken hazırlanan cevap, kurucu Y5) yeniden değerlendirmeye AÇILMAZ: aynı anahtar, gönderim yok", async () => {
    const { conversationId } = await seed("Otopark var mı?");
    understands(understood([{ intent: "parking", message: 1 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "parking", reply: PARKING, answeredRequests: { ok: true, refs: ["R1"] } }));
    await applyChannelAutoReply(conversationId);
    vi.stubEnv("AUTO_REPLY_ENABLED", "");
    await deliver();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    expect((await rows(conversationId)).map((r) => [r.status, r.lastErrorCode])).toEqual([["canceled", "auto_reply_disabled"]]);
    understands(understood([{ intent: "parking", message: 1 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "parking", reply: PARKING, answeredRequests: { ok: true, refs: ["R1"] } }));
    const out = await applyChannelAutoReply(conversationId);
    expect(out.skippedReason).toBe("already_queued");
    await deliver();
    expect(sent).toEqual([]);
    expect(await rows(conversationId)).toHaveLength(1);
  });
});

describe("Tur 7 T7-OB-1 adım 2 — teslimi belirsiz yapay zekâ cevabı", () => {
  beforeEach(async () => {
    await resetDb();
    sent.length = 0;
    mockSuggest.mockReset();
    mockUnderstand.mockReset();
    mockInlineSend.mockClear();
    mockMail.mockClear();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("AI_CONVERSATION_ITEMS_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
  });
  afterEach(() => vi.unstubAllEnvs());

  const timeout: OutboxSendFn = async (input) => {
    sent.push(input.body);
    return { ok: false, error: "Hospitable API'ye ulaşılamadı (timeout)" };
  };

  async function ambiguousFirstReply() {
    const s = await seed("Otopark var mı?");
    understands(understood([{ intent: "parking", message: 1 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "parking", reply: PARKING, answeredRequests: { ok: true, refs: ["R1"] } }));
    await applyChannelAutoReply(s.conversationId);
    await deliver(timeout);
    expect((await rows(s.conversationId)).map((r) => r.status)).toEqual(["ambiguous"]);
    return s;
  }

  for (const state of ["ambiguous", "review"] as const) {
    it(`🚨 önceki cevap '${state}': yeni misafir mesajı kaydedilir, tur TAM koşar (model çağrılır) ama cevap OTOMATİK GİTMEZ; konuşma Yeni + "doğrulanamadı" notu`, async () => {
      const { conversationId } = await ambiguousFirstReply();
      if (state === "review") await prisma.messageOutbox.updateMany({ where: { conversationId }, data: { status: "review" } });
      await guestWrites(conversationId, "Bir de havlu lazım.");
      // `review` satırı bağlamda "gönderilmemiş" sunulur (mevcut karar) → cevapsız pencere iki mesaj; `ambiguous` (yolda sayılır) → yalnız yenisi.
      understands(
        understood(state === "review" ? [{ intent: "parking", message: 1 }, { intent: "cleaning_linen", message: 2 }] : [{ intent: "cleaning_linen", message: 1 }]),
      );
      mockSuggest.mockResolvedValueOnce(verdict({ intent: "cleaning_linen", reply: TOWELS, answeredRequests: { ok: true, refs: ["R1"] } }));
      const out = await applyChannelAutoReply(conversationId);
      expect(mockSuggest).toHaveBeenCalledTimes(2);
      expect(out).toMatchObject({ sent: false, skippedReason: "delivery_unverified" });
      expect(await rows(conversationId)).toHaveLength(1);
      expect(mockInlineSend).not.toHaveBeenCalled();
      const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      expect(c.status).toBe("new");
      expect(c.skippedReason).toBe("delivery_unverified");
      // Havlu ihtiyacı kaybolmadı: ev sahibinde açık (cevaplandı sayılmadı).
      expect(await statusOf(conversationId, "cleaning_linen")).not.toContain("answered");
      expect(await statusOf(conversationId, "cleaning_linen")).toHaveLength(1);
      // Belirsiz cevap ASLA kör tekrarlanmaz: tek POST.
      await deliver(timeout);
      expect(sent).toEqual([PARKING]);
    });
  }

  it("🚨 belirsizken gelen TEHLİKE mesajı yine yükseltilir (tehlike kontrolleri sürer) — tutma onun önüne geçmez", async () => {
    const { conversationId } = await ambiguousFirstReply();
    await guestWrites(conversationId, "Mutfakta duman var, alarm çalıyor!");
    understands(understood([{ intent: "emergency", message: 1 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "emergency", riskLevel: "high", riskType: "safety_emergency", reply: "Hemen dışarı çıkın." }));
    const out = await applyChannelAutoReply(conversationId);
    expect(out.skippedReason).not.toBe("delivery_unverified");
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).status).toBe("problem");
  });

  it("🚨 süresiz kilit YOK: ev sahibi belirsizlikten sonra yazınca konu çözülmüş sayılır → misafirin sonraki mesajı normal cevaplanır (tek gönderim)", async () => {
    const { conversationId } = await ambiguousFirstReply();
    await prisma.messageOutbox.updateMany({ where: { conversationId }, data: { status: "review" } });
    await hostWrites(conversationId, "Otopark binanın önünde, ücretsiz.");
    await guestWrites(conversationId, "Bir de havlu lazım.");
    understands(understood([{ intent: "cleaning_linen", message: 1 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "cleaning_linen", reply: TOWELS, answeredRequests: { ok: true, refs: ["R1"] } }));
    const out = await applyChannelAutoReply(conversationId);
    expect(out.skippedReason).toBeUndefined();
    await deliver();
    expect(sent).toEqual([PARKING, TOWELS]);
  });

  it("KONTROL — ev sahibinin belirsizlikten ÖNCEKİ mesajı çözüm sayılmaz (tutma sürer)", async () => {
    const s = await seed("Merhaba");
    await hostWrites(s.conversationId, "Hoş geldiniz!");
    await guestWrites(s.conversationId, "Otopark var mı?");
    understands(understood([{ intent: "parking", message: 1 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "parking", reply: PARKING, answeredRequests: { ok: true, refs: ["R1"] } }));
    await applyChannelAutoReply(s.conversationId);
    await deliver(timeout);
    await guestWrites(s.conversationId, "Bir de havlu lazım.");
    understands(understood([{ intent: "cleaning_linen", message: 1 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "cleaning_linen", reply: TOWELS, answeredRequests: { ok: true, refs: ["R1"] } }));
    expect((await applyChannelAutoReply(s.conversationId)).skippedReason).toBe("delivery_unverified");
  });

  it("🚨 belirsiz cevap aslında GİTTİYSE (senkron sağlayıcıdaki kopyasını bizim satırımıza bağlar) tutma KALKAR — sonraki soru normal cevaplanır", async () => {
    const { orgId, conversationId } = await ambiguousFirstReply();
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { propertyId: true } });
    // Gerçek senkron yazımı: sağlayıcı akışında bizim metnimiz ev sahibi tarafında görünüyor → adopt-and-heal yerel AI satırını sahiplenir.
    await prisma.$transaction((tx) =>
      importCanonicalThread(
        tx,
        convo.propertyId,
        {
          externalId: "res-sd",
          code: "SDCODE",
          channel: "airbnb",
          status: "confirmed",
          arrivalDate: new Date(Date.now() + 5 * 86_400_000),
          departureDate: new Date(Date.now() + 8 * 86_400_000),
          guest: { externalId: "g-sd", name: "Alex", givenName: "Alex", email: null, phone: null },
          totalAmount: null,
          currency: null,
          conversationExternalId: "conv-sd",
          conversationLanguage: null,
          lastMessageAt: new Date(),
          terminal: false,
        },
        [{ externalId: "prov-echo-1", direction: "outbound", senderName: "Ev Sahibi", body: PARKING, createdAt: new Date() }],
        null,
        { organizationId: orgId, provider: "hospitable", connectionId: null },
      ),
    );
    const ai = await prisma.message.findFirstOrThrow({ where: { conversationId, authorType: "ai" } });
    expect(ai.externalId).toBe("prov-echo-1");
    expect(await prisma.message.count({ where: { conversationId, authorType: "host" } })).toBe(0);

    await guestWrites(conversationId, "Bir de havlu lazım.");
    understands(understood([{ intent: "cleaning_linen", message: 1 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "cleaning_linen", reply: TOWELS, answeredRequests: { ok: true, refs: ["R1"] } }));
    const out = await applyChannelAutoReply(conversationId);
    expect(out.skippedReason).toBeUndefined();
    // Kuyruk konuşma başına SIRALI: yeni cevap, önceki belirsiz satır son durumuna (inceleme) varana dek bekler — kör tekrar yok, kilit
    // de yok (süre sınırlı: eşleştirici denemeleri bitince satır incelemeye düşer). Sağlayıcıda bulunan kopyanın satırı "iletildi"
    // sayması (bekleme hiç olmaz) kurucu sorusu O3 — uygulanmadı.
    await deliver();
    expect(sent).toEqual([PARKING]);
    await prisma.messageOutbox.updateMany({ where: { conversationId, status: "ambiguous" }, data: { status: "review" } });
    await deliver();
    // Belirsiz satırın kendisi yine kör tekrarlanmadı (tek deneme); yeni soru cevaplandı.
    expect(sent).toEqual([PARKING, TOWELS]);
  });

  it("🚨 tutma sırasında gelen HASSAS istek (IBAN) ev sahibinde tutulur + bugünkü tek e-posta; güvenli istek açık kalır; karar kaydı yazılır", async () => {
    const { conversationId } = await ambiguousFirstReply();
    const both = "IBAN'ınızı atar mısınız? Bir de havlu lazım.";
    await guestWrites(conversationId, both);
    understands(understood([{ intent: "payment_invoice", message: 1 }, { intent: "cleaning_linen", message: 1 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "cleaning_linen", reply: TOWELS, answeredRequests: { ok: true, refs: ["R1"] } }));
    const out = await applyChannelAutoReply(conversationId);
    expect(out).toMatchObject({ sent: false, skippedReason: "delivery_unverified" });
    const rows = await prisma.conversationItem.findMany({
      where: { conversationId, kind: { in: ["payment_invoice", "cleaning_linen"] } },
      select: { kind: true, status: true, notifiedAt: true },
      orderBy: { kind: "asc" },
    });
    expect(rows.map((r) => [r.kind, r.status, r.notifiedAt !== null])).toEqual([
      ["cleaning_linen", "open", false],
      ["payment_invoice", "pending_host", true],
    ]);
    expect(mockMail).toHaveBeenCalledTimes(1);
    const reasons = (await prisma.riskEvent.findMany({ where: { conversationId }, select: { surface: true, finalDecision: true, reason: true } }))
      .map((r) => `${r.surface}:${r.finalDecision}:${r.reason}`)
      .sort();
    expect(reasons).toContain("auto_reply:human_review:delivery_unverified");
    await deliver(timeout);
    expect(sent).toEqual([PARKING]);
  });

  it("koşucu tutulan mesajı DAMGALAR (her turda yeniden modellenmez); misafir yeni yazınca yeniden değerlendirilir", async () => {
    const { orgId, conversationId } = await ambiguousFirstReply();
    await guestWrites(conversationId, "Bir de havlu lazım.");
    understands(understood([{ intent: "cleaning_linen", message: 1 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "cleaning_linen", reply: TOWELS, answeredRequests: { ok: true, refs: ["R1"] } }));
    await runDueChannelAutoReplies(orgId);
    await runDueChannelAutoReplies(orgId);
    expect(mockSuggest).toHaveBeenCalledTimes(2);
    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(c.autoReplyAttemptedAt?.getTime()).toBe(c.lastMessageAt.getTime());

    await guestWrites(conversationId, "Bir de terlik var mı?", new Date(Date.now() + 1_000));
    understands(understood([{ intent: "amenities", message: 2 }]));
    mockSuggest.mockResolvedValueOnce(verdict({ intent: "amenities", reply: "Terlikler girişteki dolapta.", answeredRequests: { ok: true, refs: ["R1"] } }));
    await runDueChannelAutoReplies(orgId);
    expect(mockSuggest).toHaveBeenCalledTimes(3);
  });
});
