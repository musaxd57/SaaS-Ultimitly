import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// ŞİKÂYETE BAĞLI İSTEK — KANAL AKIŞI (kurucu kararı 10-01; Luna kör kabul bulgusu): "Gürültü yüzünden uyuyamadık, yine olursa ne
// yapacağız?" anlama katmanınca şikâyet + "diğer" diye bölünse de yardım talebi cevaplanmaz → misafire HİÇBİR ŞEY gitmez (kural
// hatırlatması / 112 dahil), şikâyet ev sahibinde + tek acil e-posta. Bağımsız "Wi-Fi ağı hangisi?" cevaplanır. Kapıya iki öğe
// doğrudan verilse de (planı atlayan yol) şikâyete bağlı cevap tutulur (`items_complaint_dependent`).
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/ai", () => ({
  suggestReply: vi.fn(),
  classifyMessage: vi.fn(),
  summarizeHostStyle: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn(async () => "tok"),
}));
vi.mock("@/lib/messaging", async (orig) => {
  const actual = await orig<typeof import("@/lib/messaging")>();
  return { ...actual, sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: "m1" })) };
});
vi.mock("@/lib/ai/semantic/understand", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai/semantic/understand")>();
  return { ...actual, understandingEnabled: () => true, understandGuestMessages: vi.fn() };
});
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })) };
});

import { emailService } from "@/lib/email";
import { suggestReply } from "@/lib/ai";
import type { SuggestReplyResult } from "@/lib/ai/types";
import { sendOnChannel } from "@/lib/messaging";
import { understandGuestMessages } from "@/lib/ai/semantic/understand";
import { parseUnderstanding, type MessageUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import { applyChannelAutoReply, sendDueAlerts } from "@/lib/automation";
import { hasOpenHostWork } from "@/lib/conversation-attention";
import { hostVoiceDraft } from "@/lib/ai/host-voice";

const mockSuggest = vi.mocked(suggestReply);
const mockMail = vi.mocked(emailService.sendReporting);
const mockSend = vi.mocked(sendOnChannel);
const mockUnderstand = vi.mocked(understandGuestMessages);

const IBAN = "IBAN'ınızı atar mısınız?";
const WIFI = "Wi-Fi şifresi neydi?";
const BOTH = "IBAN'ınızı atar mısınız? Bir de Wi-Fi şifresi neydi?";

const STAY_NONE = { requested: false, kind: "none", checkin_time: null, checkout_time: null };
function understood(requests: { intent: string; message: number }[], withdrawn: { intent: string; message: number }[] = []): MessageUnderstanding {
  const u = parseUnderstanding(
    {
      language: "tr",
      requests: requests.map((r) => ({ query_tr: `${r.intent} sorusu`, query_original: "q", ...r })),
      stay_change: STAY_NONE,
      withdrawn,
    },
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
const wifiAnswer = (over: Partial<SuggestReplyResult> = {}) =>
  verdict({ intent: "wifi", reply: "Wi-Fi ağı Lale-5G, şifre modemin altında yazıyor.", answeredRequests: { ok: true, refs: ["R1"] }, ...over });

async function seed(firstGuestMessage: string) {
  const org = await prisma.organization.create({
    data: {
      name: "Org",
      alertEmail: "host@example.com",
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0,
      autoReplyEnabledAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 7" } });
  const createdAt = new Date(Date.now() - 20 * 60_000);
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      externalReservationId: "res-1",
      status: "new",
      lastMessageAt: createdAt,
      messages: { create: [{ direction: "inbound", senderName: "Alex", authorType: "guest", body: firstGuestMessage, createdAt }] },
    },
  });
  return { orgId: org.id, conversationId: conversation.id };
}

async function guestWrites(conversationId: string, body: string, minutesAgo: number) {
  const createdAt = new Date(Date.now() - minutesAgo * 60_000);
  const m = await prisma.message.create({
    data: { conversationId, direction: "inbound", senderName: "Alex", authorType: "guest", body, createdAt },
  });
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: createdAt, status: "new" } });
  return m.id;
}

async function itemsOf(conversationId: string) {
  const rows = await prisma.conversationItem.findMany({
    where: { conversationId },
    // Bir turun öğeleri AYNI createdAt ile yazılır ve requestIndex mesaj başına 0'dan başlar: iki mesajın öğeleri tam eşit kalır →
    // son eşitlik bozucu id (yazılış = mesaj sırası). 09-27: eşitlikte sıra rastgeleydi, tam kapı bir kez kırmızı verdi.
    orderBy: [{ createdAt: "asc" }, { requestIndex: "asc" }, { id: "asc" }],
  });
  const msgs = await prisma.message.findMany({ where: { conversationId }, select: { id: true, body: true } });
  const bodyOf = new Map(msgs.map((m) => [m.id, m.body]));
  return rows.map((r) => ({
    body: bodyOf.get(r.messageId),
    kind: r.kind,
    sensitivity: r.sensitivity,
    status: r.status,
    notified: r.notifiedAt !== null,
  }));
}

async function conv(conversationId: string) {
  return prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: { status: true, priority: true, autoReplyHoldUntil: true, skippedReason: true },
  });
}

async function reasons(conversationId: string) {
  const rows = await prisma.riskEvent.findMany({ where: { conversationId }, select: { surface: true, finalDecision: true, reason: true } });
  return rows.map((r) => `${r.surface}:${r.finalDecision}:${r.reason}`).sort();
}

function beforeEachTurn() {
  beforeEach(async () => {
    await resetDb();
    mockSuggest.mockReset();
    mockUnderstand.mockReset();
    mockMail.mockReset();
    mockMail.mockResolvedValue({ ok: true });
    mockSend.mockClear();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("AI_CONVERSATION_ITEMS_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());
}


import { autoReplyGateVerdict } from "@/lib/automation";

const NOISE = "Gürültü yüzünden uyuyamadık, yine olursa ne yapacağız?";
const NOISE_WIFI = "Gürültü yüzünden uyuyamadık. Bu arada Wi-Fi ağı hangisi?";
const BAD_REPLY = "Sessiz saatler 22:00'den sonradır, lütfen kurallara uyun. Tehlike olursa 112'yi arayın.";

describe("şikâyete bağlı istek (kurucu kararı 10-01)", () => {
  beforeEachTurn();

  it("🚨 şikâyet + 'yine olursa ne yapacağız?' (diğer): model yardım talebini cevaplasa da misafire HİÇBİR ŞEY gitmez; tek e-posta", async () => {
    const { conversationId } = await seed(NOISE);
    understands(
      understood([
        { intent: "complaint_issue", message: 1 },
        { intent: "other", message: 1 },
      ]),
    );
    // Tur tamamen tutulunca cevap modeline öğe bloğu verilmez (beyan yok). İkinci kemer: model yine de bir beyan uydursa da gitmez.
    mockSuggest.mockResolvedValue(verdict({ intent: "general", reply: BAD_REPLY, answeredRequests: { ok: true, refs: ["R1"] } }));
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockSuggest.mock.calls[0][0]).not.toHaveProperty("conversationItems");
    const items = await itemsOf(conversationId);
    expect(items.map((i) => [i.kind, i.status])).toEqual([
      ["complaint_issue", "pending_host"],
      ["other", "open"],
    ]);
    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it("şikâyet + bağımsız 'Wi-Fi ağı hangisi?': Wi-Fi CEVAPLANIR, şikâyet ev sahibinde + tek e-posta", async () => {
    const { conversationId } = await seed(NOISE_WIFI);
    understands(
      understood([
        { intent: "complaint_issue", message: 1 },
        { intent: "wifi", message: 1 },
      ]),
    );
    mockSuggest.mockResolvedValueOnce(wifiAnswer());
    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(true);
    const items = await itemsOf(conversationId);
    expect(items.map((i) => [i.kind, i.status])).toEqual([
      ["complaint_issue", "pending_host"],
      ["wifi", "answered"],
    ]);
    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it("🚨 kapıya iki öğe DOĞRUDAN verilir (plan atlanmış gibi): şikâyete bağlı cevap tutulur; bağımsız Wi-Fi geçer", () => {
    const answered = verdict({ intent: "general", reply: "Wi-Fi ağı Lale-5G.", answeredRequests: { ok: true, refs: ["R1"] } });
    const complaint = { kind: "complaint_issue" as const, sensitivity: "sensitive" as const, riskType: null };
    expect(
      autoReplyGateVerdict(answered, NOISE, { items: { held: [complaint], paymentHeld: false, answerableKinds: ["other"] } }),
    ).toEqual({ reason: "blocked", detail: "items_complaint_dependent" });
    expect(
      autoReplyGateVerdict(answered, NOISE_WIFI, { items: { held: [complaint], paymentHeld: false, answerableKinds: ["wifi"] } })?.detail,
    ).not.toBe("items_complaint_dependent");
  });
});
