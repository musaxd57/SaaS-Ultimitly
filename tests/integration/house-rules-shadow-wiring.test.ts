import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// EV KURALI GÖLGE ÖLÇÜMÜ — KANAL OTO-YANITI + QR BAĞLANTISI (#188 dilim 3; bayrak `AI_HOUSE_RULES_SHADOW`). Sözleşme:
//  · bayrak açık: anlama katmanı kural kipinde çağrılır, karar kaydına `hr` yazılır ("kural açık olsaydı ne olurdu");
//  · KARAR DEĞİŞMEZ: gönderim / gerekçe bayrak açık ve kapalı iki koşuda BİREBİR aynı;
//  · bayrak kapalı: katman temel kipte, `hr` YOK, kural deposu HİÇ okunmaz;
//  · konu yoksa depo okunmaz, kayıt boş liste; depo okunamazsa kayıt yazılmaz, akış sürer.
// Model çağrıları sahte (cevap modeli + anlama katmanı).
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn(), summarizeHostStyle: vi.fn() }));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn(async () => "tok") }));
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
vi.mock("@/lib/house-rules/store", async (orig) => {
  const actual = await orig<typeof import("@/lib/house-rules/store")>();
  return { ...actual, loadHouseRules: vi.fn(actual.loadHouseRules) };
});

import { suggestReply } from "@/lib/ai";
import type { SuggestReplyResult } from "@/lib/ai/types";
import { sendOnChannel } from "@/lib/messaging";
import { understandGuestMessages } from "@/lib/ai/semantic/understand";
import { parseUnderstanding, type MessageUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import { applyChannelAutoReply } from "@/lib/automation";
import { loadHouseRules, saveHouseRules } from "@/lib/house-rules/store";
import { POST as qrPost } from "@/app/api/chat/[token]/route";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);
const mockUnderstand = vi.mocked(understandGuestMessages);
const mockLoad = vi.mocked(loadHouseRules);

const ASK = "Can we smoke on the balcony?";
const STAY_NONE = { requested: false, kind: "none", checkin_time: null, checkout_time: null };
function understood(rule: { topic: string; stance: string } | null): MessageUnderstanding {
  const u = parseUnderstanding(
    {
      language: "en",
      requests: [
        { intent: "house_rules", query_tr: "sigara", query_original: "smoking", rule_topic: rule?.topic ?? "none", rule_stance: rule?.stance ?? "none" },
      ],
      stay_change: STAY_NONE,
    },
    { rules: true },
  );
  if (!u) throw new Error("fixture");
  return u;
}
const understands = (u: MessageUnderstanding) => mockUnderstand.mockResolvedValue({ status: "ok", value: u, ms: 1, cached: false });

function verdict(over: Partial<SuggestReplyResult> = {}): SuggestReplyResult {
  return {
    intent: "general",
    confidence: 0.95,
    reply: "Smoking isn't permitted inside the home.",
    risk: null,
    priority: "standard",
    source: "openai",
    actionSuggestion: null,
    riskLevel: "none",
    detectedLanguage: "en",
    riskType: null,
    usedSources: [],
    missingInfo: [],
    statedCheckoutTime: null,
    ...over,
  };
}

async function seedChannel() {
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
      messages: { create: [{ direction: "inbound", senderName: "Alex", authorType: "guest", body: ASK, createdAt }] },
    },
  });
  await saveHouseRules(org.id, property.id, [{ topic: "smoking", policy: "forbidden", status: "confirmed" }]);
  return { orgId: org.id, propertyId: property.id, conversationId: conversation.id };
}

async function evidenceOf(where: { conversationId?: string; surface?: string }) {
  const ev = await prisma.riskEvent.findFirstOrThrow({ where, orderBy: { occurredAt: "desc" } });
  return { ev, json: JSON.parse(ev.kbEvidenceJson ?? "{}") as { hr?: unknown } };
}

beforeEach(async () => {
  await resetDb();
  mockSuggest.mockReset();
  mockUnderstand.mockReset();
  mockSend.mockClear();
  mockLoad.mockClear();
  vi.stubEnv("AUTO_REPLY_ENABLED", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("kanal oto-yanıtı", () => {
  async function run(shadow: boolean) {
    await resetDb();
    mockSend.mockClear();
    mockLoad.mockClear();
    mockUnderstand.mockReset();
    mockSuggest.mockReset();
    vi.stubEnv("AI_HOUSE_RULES_SHADOW", shadow ? "1" : "");
    const s = await seedChannel();
    mockLoad.mockClear(); // tohumdaki kayıt okuması sayılmasın
    understands(understood({ topic: "smoking", stance: "asks_permission" }));
    mockSuggest.mockResolvedValue(verdict());
    const out = await applyChannelAutoReply(s.conversationId);
    const { ev, json } = await evidenceOf({ conversationId: s.conversationId });
    return { out, reason: `${ev.finalDecision}:${ev.reason}`, sent: mockSend.mock.calls.length, hr: json.hr, understandArg: mockUnderstand.mock.calls[0]?.[0] };
  }

  it("🚨 bayrak açık: kayıtta 'kural olsaydı' → sigara YASAK, nazik kural cümlesi giderdi; KARAR bayrak kapalıyla BİREBİR aynı", async () => {
    const on = await run(true);
    expect(on.hr).toEqual([{ t: "smoking", s: "asks_permission", p: "forbidden", k: "state_rule" }]);
    expect(on.understandArg).toMatchObject({ rules: true });
    const off = await run(false);
    expect(off.hr).toBeUndefined();
    expect(off.understandArg).not.toHaveProperty("rules");
    expect(mockLoad).not.toHaveBeenCalled();
    expect({ out: on.out, reason: on.reason, sent: on.sent }).toEqual({ out: off.out, reason: off.reason, sent: off.sent });
  });

  it("bayrak açık ama konu yok → depo OKUNMAZ, kayıt boş liste (ölçüldü)", async () => {
    vi.stubEnv("AI_HOUSE_RULES_SHADOW", "1");
    const s = await seedChannel();
    mockLoad.mockClear();
    understands(understood(null));
    mockSuggest.mockResolvedValue(verdict());
    await applyChannelAutoReply(s.conversationId);
    expect(mockLoad).not.toHaveBeenCalled();
    expect((await evidenceOf({ conversationId: s.conversationId })).json.hr).toEqual([]);
  });

  it("depo okunamazsa kayıt YAZILMAZ, akış sürer (gölge ölçüm cevabı asla bozmaz)", async () => {
    vi.stubEnv("AI_HOUSE_RULES_SHADOW", "1");
    const s = await seedChannel();
    mockLoad.mockRejectedValueOnce(new Error("db down"));
    understands(understood({ topic: "smoking", stance: "asks_permission" }));
    mockSuggest.mockResolvedValue(verdict());
    await expect(applyChannelAutoReply(s.conversationId)).resolves.toBeDefined();
    expect((await evidenceOf({ conversationId: s.conversationId })).json.hr).toBeUndefined();
  });

  it("anlama katmanı düştüyse kayıt YOK (ölçülmedi ≠ konu yok)", async () => {
    vi.stubEnv("AI_HOUSE_RULES_SHADOW", "1");
    const s = await seedChannel();
    mockUnderstand.mockResolvedValue({ status: "failed", ms: 1 });
    mockSuggest.mockResolvedValue(verdict());
    await applyChannelAutoReply(s.conversationId);
    expect((await evidenceOf({ conversationId: s.conversationId })).json.hr).toBeUndefined();
  });

  it("kiracı yalıtımı: kural BAŞKA kiracının aynı kimlikli mülkünden okunmaz (depo org kapsamlı çağrılır)", async () => {
    vi.stubEnv("AI_HOUSE_RULES_SHADOW", "1");
    const s = await seedChannel();
    mockLoad.mockClear();
    understands(understood({ topic: "smoking", stance: "asks_permission" }));
    mockSuggest.mockResolvedValue(verdict());
    await applyChannelAutoReply(s.conversationId);
    expect(mockLoad).toHaveBeenCalledWith(s.orgId, s.propertyId);
  });
});

describe("QR misafir sohbeti", () => {
  const DAY = 86_400_000;
  let seq = 0;
  async function seedQr() {
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const token = `qrtok_${Math.random().toString(36).slice(2)}${"x".repeat(12)}`;
    const property = await prisma.property.create({
      data: { organizationId: org.id, name: "Lale 7", chatEnabled: true, chatToken: token, checkInTime: "15:00", checkOutTime: "11:00" },
    });
    await prisma.reservation.create({
      data: {
        propertyId: property.id,
        guestName: "Test Misafir",
        arrivalDate: new Date(Date.now() - DAY),
        departureDate: new Date(Date.now() + 2 * DAY),
        status: "confirmed",
        channel: "manual",
        currency: "EUR",
      },
    });
    await saveHouseRules(org.id, property.id, [{ topic: "smoking", policy: "forbidden", status: "confirmed" }]);
    return { orgId: org.id, propertyId: property.id, token };
  }
  const ask = (token: string, message: string) =>
    qrPost(
      new NextRequest(`http://localhost/api/chat/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, requestId: `req-${++seq}-${Math.random().toString(36).slice(2)}` }),
      }),
      { params: Promise.resolve({ token }) },
    );

  beforeEach(() => {
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });

  it("bayrak açık: QR karar kaydına da `hr` yazılır; kapalıyken yazılmaz ve depo okunmaz", async () => {
    vi.stubEnv("AI_HOUSE_RULES_SHADOW", "1");
    const a = await seedQr();
    mockLoad.mockClear();
    understands(understood({ topic: "smoking", stance: "asks_permission" }));
    mockSuggest.mockResolvedValue(verdict());
    await ask(a.token, ASK);
    expect((await evidenceOf({ surface: "guest_chat" })).json.hr).toEqual([{ t: "smoking", s: "asks_permission", p: "forbidden", k: "state_rule" }]);
    expect(mockLoad).toHaveBeenCalledWith(a.orgId, a.propertyId);

    await resetDb();
    vi.stubEnv("AI_HOUSE_RULES_SHADOW", "");
    const b = await seedQr();
    mockLoad.mockClear();
    await ask(b.token, ASK);
    expect((await evidenceOf({ surface: "guest_chat" })).json.hr).toBeUndefined();
    expect(mockLoad).not.toHaveBeenCalled();
  });
});
