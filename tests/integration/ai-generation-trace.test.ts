// ---------------------------------------------------------------------------
// YAPAY ZEKÂ ÜRETİM İZİ (migration 60) — kanal oto-yanıtı uçtan uca, gerçek PostgreSQL + gerçek kapı.
//
// İz bir GÖZLEMDİR: anahtar açık / kapalı, yazım başarılı / başarısız — misafire giden metin ve karar AYNI kalır. Her iz iddiası
// RiskEvent'in AYNI karar + gerekçesiyle eşleştirilir (iki kayıt ayrışırsa konsol yalan söyler).
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

vi.mock("@/lib/ai", () => ({
  suggestReply: vi.fn(),
  classifyMessage: vi.fn(),
  summarizeHostStyle: vi.fn(),
  replyCallParams: vi.fn(() => ({ model: "configured-model", effort: null })),
  replyPromptVersion: vi.fn(() => "promptv12abc"),
  replyPromptItemsOf: (items: { held: readonly unknown[] } | undefined) => ({ mode: items !== undefined, held: (items?.held.length ?? 0) > 0 }),
}));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) } }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { replyPromptVersion, suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply } from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);
const mockPromptVersion = vi.mocked(replyPromptVersion);
const DAY = 86_400_000;

const BENIGN = "Wifi şifresi giriş kapısının yanındaki kartta yazıyor.";
const verdict = (over: Record<string, unknown> = {}) => ({
  intent: "wifi",
  confidence: 0.95,
  reply: BENIGN,
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "low",
  detectedLanguage: "tr",
  riskType: null as string | null,
  usedSources: [] as string[],
  missingInfo: [] as string[],
  statedCheckoutTime: null,
  llmUsage: { pt: 900, ct: 40, rt: 12, m: "served-model-2026" },
  ...over,
});

async function seed(body = "Wifi şifresi nedir?") {
  const org = await prisma.organization.create({
    data: { name: "İz Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Deniz Daire" } });
  const r = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Ayşe Yılmaz",
      arrivalDate: new Date(Date.now() - DAY),
      departureDate: new Date(Date.now() + 2 * DAY),
      channel: "airbnb",
      status: "confirmed",
      sourceReference: "res-trace-1",
    },
  });
  const c = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: r.id,
      guestIdentifier: "Ayşe Yılmaz",
      channel: "airbnb",
      status: "new",
      externalReservationId: "res-trace-1",
      lastMessageAt: new Date(),
      messages: { create: { direction: "inbound", senderName: "Ayşe Yılmaz", authorType: "guest", body } },
    },
  });
  return { orgId: org.id, propertyId: property.id, reservationId: r.id, conversationId: c.id };
}

const sentBody = () => (mockSend.mock.calls[0]?.[1] as string | undefined) ?? null;

describe("üretim izi — kanal oto-yanıtı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("AI_GENERATION_TRACE_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true } as never);
    mockSuggest.mockResolvedValue(verdict() as never);
    mockPromptVersion.mockReturnValue("promptv12abc");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("gönderilen cevap: iz = RiskEvent kararı + gerekçesi; gönderilen metin MİSAFİRE GİDEN gövdenin aynısı; token + model + sürüm", async () => {
    const s = await seed();
    const r = await applyChannelAutoReply(s.conversationId);
    expect(r.sent).toBe(true);
    const [g] = await prisma.aiGeneration.findMany();
    const [ev] = await prisma.riskEvent.findMany();
    expect(g).toMatchObject({
      organizationId: s.orgId,
      conversationId: s.conversationId,
      propertyId: s.propertyId,
      reservationId: s.reservationId,
      surface: "channel_auto",
      model: "served-model-2026",
      promptVersion: "promptv12abc",
      decision: ev.finalDecision,
      gateReason: ev.reason,
      draftText: BENIGN,
      sentText: sentBody(),
      promptTokens: 900,
      completionTokens: 40,
      reasoningTokens: 12,
    });
    expect(ev.finalDecision).toBe("auto_sent");
    expect(g.triggerMessageId).toBe(ev.triggerId);
    expect(g.latencyMs).not.toBeNull();
    // Bağlam kurucu tanısı (kurucu talimatı madde 11): isteme giren mesaj kimlikleri + sayılar; METİN YOK.
    const diag = JSON.parse(g.contextDiagnosticsJson!);
    const msgs = await prisma.message.findMany({ where: { conversationId: s.conversationId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(diag).toMatchObject({ v: 1, omittedCount: 0, pendingCount: 1, pendingIncludedCount: 1, olderMemoryUsed: false });
    expect(diag.includedIds).toContain(ev.triggerId);
    expect(diag.includedIds.every((id: string) => msgs.some((m) => m.id === id))).toBe(true);
    expect(g.contextDiagnosticsJson).not.toContain(BENIGN.slice(0, 12));
    expect(g.toolResultsJson).toBeNull(); // araç koşmadı
  });

  it("bağlam tanısı: 'eski hafıza' = istemin KONUŞMA KAYITLARI bloğu (konuşma kayıtları anahtarı açık + önceki giden mesaj)", async () => {
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "1");
    const s = await seed();
    await prisma.message.create({
      data: { conversationId: s.conversationId, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body: "Hoş geldiniz!", createdAt: new Date(Date.now() - 3_600_000) },
    });
    expect((await applyChannelAutoReply(s.conversationId)).sent).toBe(true);
    const [g] = await prisma.aiGeneration.findMany();
    expect(JSON.parse(g.contextDiagnosticsJson!)).toMatchObject({ olderMemoryUsed: true });
  });

  it("tutulan cevap (iade): iz human_review, gönderilen metin YOK, taslak var; misafire bir şey gitmez", async () => {
    const s = await seed("İade istiyorum, ödediğim parayı geri istiyorum.");
    mockSuggest.mockResolvedValue(verdict({ intent: "refund", reply: "Talebinizi ev sahibine iletiyorum.", riskLevel: "high", riskType: "money_refund" }) as never);
    const r = await applyChannelAutoReply(s.conversationId);
    expect(r.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    const gens = await prisma.aiGeneration.findMany({ where: { conversationId: s.conversationId } });
    const evs = await prisma.riskEvent.findMany({ where: { conversationId: s.conversationId } });
    expect(gens).toHaveLength(1);
    expect(gens[0]).toMatchObject({ decision: "human_review", gateReason: evs[0].reason, sentText: null, draftText: "Talebinizi ev sahibine iletiyorum." });
  });

  it("🚨 anahtar KAPALI → iz yok; karar ve gönderilen metin BİREBİR aynı", async () => {
    const on = await seed();
    await applyChannelAutoReply(on.conversationId);
    const bodyOn = sentBody();
    await resetDb();
    vi.clearAllMocks();
    mockSend.mockResolvedValue({ ok: true } as never);
    mockSuggest.mockResolvedValue(verdict() as never);
    vi.stubEnv("AI_GENERATION_TRACE_ENABLED", "");
    const off = await seed();
    const r = await applyChannelAutoReply(off.conversationId);
    expect(r.sent).toBe(true);
    expect(sentBody()).toBe(bodyOn);
    expect(await prisma.aiGeneration.count()).toBe(0);
    expect(await prisma.riskEvent.count()).toBe(1);
    // Kapalıyken iz girdisi hiç KURULMAZ (istem sürümü her kararda yeniden hesaplanmaz).
    expect(mockPromptVersion).not.toHaveBeenCalled();
  });

  it("kuyruklu teslim (DURABLE_OUTBOX_ENABLED=1): gönderilen metin = kuyruğa giren gövde", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*"); // O1: liste açıkça bütün işletmeler (Opus F10: liste yoksa kimse)
    const s = await seed();
    await applyChannelAutoReply(s.conversationId);
    const [row] = await prisma.messageOutbox.findMany({ where: { conversationId: s.conversationId } });
    expect(row?.body).toBeTruthy();
    const [g] = await prisma.aiGeneration.findMany();
    expect(g).toMatchObject({ decision: "auto_sent", sentText: row.body, draftText: BENIGN });
  });

  it("🚨 önizleme (dryRun) iz yazmaz", async () => {
    const s = await seed();
    const r = await applyChannelAutoReply(s.conversationId, { dryRun: true });
    expect(r.sent).toBe(false);
    expect(await prisma.aiGeneration.count()).toBe(0);
  });

  it("🚨 model çağrılmadı (yedek cevap) → iz yok; karar kaydı yine yazılır", async () => {
    const s = await seed();
    mockSuggest.mockResolvedValue(verdict({ source: "fallback", llmUsage: undefined }) as never);
    await applyChannelAutoReply(s.conversationId);
    expect(await prisma.aiGeneration.count()).toBe(0);
    expect(await prisma.riskEvent.count()).toBe(1);
  });

  it("🚨 iz kurulumu FIRLATSA da cevap gider ve karar kaydı yazılır", async () => {
    const s = await seed();
    mockPromptVersion.mockImplementation(() => {
      throw new Error("istem sürümü kurulamadı");
    });
    const r = await applyChannelAutoReply(s.conversationId);
    expect(r.sent).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await prisma.riskEvent.count()).toBe(1);
    expect(await prisma.aiGeneration.count()).toBe(0);
  });
});
