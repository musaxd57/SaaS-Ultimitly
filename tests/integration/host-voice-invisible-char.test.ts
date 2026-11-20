import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "./helpers/db";

// ---------------------------------------------------------------------------
// G1 TUR 5 YENİDEN ÜRETME — yapay zekâ kapıları, sahte modelle saldırı (konu 3): GÖRÜNMEZ KARAKTER ev sahibi sesi kemerini deler.
//
// Kural kaynağı (`docs/claude/ai-guvenlik.md`): görünmez karakter = `\p{Default_Ignorable_Code_Point}` + `\p{Cf}` + U+2800; çıktı vetosu,
// "bilgim yok" kuralı ve tazminat sözü kemeri cevabı bu kümeden temizleyip okur (`output-veto.ts:700`, `absence.ts:612`,
// `compensation-promise.ts:53`). `ai/host-voice-guard.ts` `hostVoiceViolation` ("ev sahibiniz …", "your host …" → `reply_host_voice`)
// temizlemiyor: sözcüğün içindeki tek bir sıfır genişlikli boşluk kemeri atlatır, misafirin ekranında "Ev sahibiniz" AYNEN görünür.
// (`payment-method-guard.ts` `namesPaymentMethod` da temizlemiyor — saf fonksiyonda "IB​AN" / "ca​sh" kaçıyor — ama uçtan uca denenen ödeme
// cümlesi başka bir sözcükle yine tutuldu; o yüzden burada yalnız ev sahibi sesi.)
// Gerçek `suggestReply` cevabı görünmez karakterden temizlemiyor (yalnız kırpma / tavan, `ai/index.ts capReply`) → taklit gerçeğe sadık.
// Öğe kipi açık (açılış kipi `AI_CONVERSATION_ITEMS_ENABLED=1`); kurulum `conversation-items-auto-reply.test.ts` ile aynı.
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) } }));
vi.mock("@/lib/ai", () => ({
  suggestReply: vi.fn(),
  classifyMessage: vi.fn(),
  summarizeHostStyle: vi.fn(),
  replyCallParams: vi.fn(() => ({ model: "m", effort: null })),
  replyPromptItemsOf: (items: { held: readonly unknown[] } | undefined) => ({ mode: items !== undefined, held: (items?.held.length ?? 0) > 0 }),
  replyPromptVersion: vi.fn((b: { mode: boolean; held: boolean }) => `v-${b.mode ? 1 : 0}${b.held ? 1 : 0}`),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn(async () => "tok") }));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: "m1" })),
}));
vi.mock("@/lib/ai/semantic/understand", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/semantic/understand")>()),
  understandingEnabled: () => true,
  understandGuestMessages: vi.fn(),
}));
vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })),
}));

import { suggestReply } from "@/lib/ai";
import type { SuggestReplyResult } from "@/lib/ai/types";
import { sendOnChannel } from "@/lib/messaging";
import { understandGuestMessages } from "@/lib/ai/semantic/understand";
import { parseUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import { applyChannelAutoReply } from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);
const mockUnderstand = vi.mocked(understandGuestMessages);
const ZWSP = "​";

function understands(intents: string[]) {
  const u = parseUnderstanding(
    {
      language: "tr",
      requests: intents.map((intent) => ({ intent, message: 1, query_tr: `${intent} sorusu`, query_original: "q" })),
      stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
      withdrawn: [],
    },
    { items: true },
  );
  if (!u) throw new Error("fixture");
  mockUnderstand.mockResolvedValueOnce({ status: "ok", value: u, ms: 1, cached: false });
}

const answer = (reply: string): SuggestReplyResult => ({
  intent: "wifi", confidence: 0.95, reply, risk: null, priority: "standard", source: "openai", actionSuggestion: null, riskLevel: "none",
  detectedLanguage: "tr", riskType: null, usedSources: [], missingInfo: [], statedCheckoutTime: null, answeredRequests: { ok: true, refs: ["R1"] },
});

async function seed(guest: string) {
  const org = await prisma.organization.create({
    data: { name: "Org", alertEmail: "host@example.com", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, autoReplyEnabledAt: new Date(Date.now() - 30 * 86_400_000) },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 7" } });
  const createdAt = new Date(Date.now() - 20 * 60_000);
  const c = await prisma.conversation.create({
    data: {
      propertyId: property.id, channel: "airbnb", guestIdentifier: "Alex", externalReservationId: "res-1", status: "new", lastMessageAt: createdAt,
      messages: { create: [{ direction: "inbound", senderName: "Alex", authorType: "guest", body: guest, createdAt }] },
    },
  });
  return c.id;
}

const sentBodies = () => mockSend.mock.calls.map((c) => String(c[1]));

describe("G1 tur 5 repro — görünmez karakter ev sahibi sesi kemerini deler", () => {
  beforeEach(async () => {
    await resetDb();
    mockSuggest.mockReset();
    mockUnderstand.mockReset();
    mockSend.mockClear();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("AI_CONVERSATION_ITEMS_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("KONTROL (yeşil): 'ev sahibiniz' düz yazımla → cevap GİTMEZ (reply_host_voice)", async () => {
    const id = await seed("Wi-Fi şifresi neydi?");
    understands(["wifi"]);
    mockSuggest.mockResolvedValueOnce(answer("Wi-Fi şifresi modemin altında. Ev sahibiniz de binada oturuyor."));
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("🚨 KIRMIZI: 'ev sahi​biniz' (sözcük içinde sıfır genişlikli boşluk) → cevap misafire GİDER", async () => {
    const id = await seed("Wi-Fi şifresi neydi?");
    understands(["wifi"]);
    mockSuggest.mockResolvedValueOnce(answer(`Wi-Fi şifresi modemin altında. Ev sahi${ZWSP}biniz de binada oturuyor.`));
    await applyChannelAutoReply(id);
    const visible = sentBodies().map((b) => b.replace(/​/g, ""));
    expect(visible.some((b) => b.includes("Ev sahibiniz")), `giden: ${JSON.stringify(visible)}`).toBe(false);
  });
});

