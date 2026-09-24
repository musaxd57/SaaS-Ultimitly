import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// ANLAM KATMANI — KANAL OTO-YANITI UÇTAN UCA (09-24; cevap modeli MOCK, DB gerçek, bekçi çağrısı
// sahte fetch). Pinlenen: şema beyanı kapıya ULAŞIR, bekçi yalnız ADAY için koşar, karar kaydı
// kapıyla AYNI politikadan gerekçe + `sc` kanıtı taşır, gölge kip karar vermez ama ölçer.
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply } from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);

/** Kelime ağının İSTEK saymadığı bir erken giriş isteği (kör bataryadan). */
const ASK = "Could we get into the flat at 11?";

const BASE = {
  intent: "early_checkin",
  confidence: 0.9,
  reply: "Check-in is from 15:00.",
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "en",
  riskType: null,
  usedSources: ["property:checkInTime"],
  sourceAudit: { declared: 1, verified: 1 },
  missingInfo: [],
  statedCheckoutTime: null,
};

async function seed() {
  const org = await prisma.organization.create({
    data: { name: "Test Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: "res-1",
      messages: { create: [{ direction: "inbound", senderName: "Alex", body: ASK, createdAt: new Date(Date.now() - 60_000) }] },
    },
    select: { id: true },
  });
  return conversation.id;
}

async function riskEvent(conversationId: string) {
  const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" } });
  return { ev, sc: (JSON.parse(String(ev.kbEvidenceJson)) as { sc?: Record<string, string> }).sc };
}

function guardFetch(verdict: Record<string, unknown> | null, status = 200) {
  return vi.fn(async (url: string) => {
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    return new Response(
      status === 200
        ? JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(verdict) } }] })
        : "upstream down",
      { status },
    );
  });
}

const GUARD_GRANTS = {
  guest_requests_change: true,
  kind: "early_checkin",
  requested_checkin_time: "11:00",
  requested_checkout_time: null,
  reply_states_calendar: false,
  reply_grants_change: true,
  reply_defers_to_host: false,
  reply_refuses: false,
};

describe("kanal oto-yanıtı — anlam katmanı bağlantısı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    mockSend.mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("KONTROL: beyan yok, kelime ağı sessiz → gider; kanıtta beyan 'absent'", async () => {
    mockSuggest.mockResolvedValue(BASE);
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const { ev, sc } = await riskEvent(id);
    expect(ev.finalDecision).toBe("auto_sent");
    expect(sc).toEqual({ v: "-", ev: "-", lx: "-", d: "absent", g: "off", u: "off" });
  });

  it("🚨 beyan edilen İZİN gönderimi durdurur; gerekçe kapıyla aynı politikadan", async () => {
    mockSuggest.mockResolvedValue({ ...BASE, reply: "Sure, see you at 11.", stayChange: { asked: "early_checkin", stance: "grants" } });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    const { ev, sc } = await riskEvent(id);
    expect(ev.finalDecision).toBe("human_review");
    expect(ev.reason).toBe("availability_claim");
    expect(sc).toMatchObject({ v: "availability_claim", d: "early_checkin/grants", g: "off" });
  });

  it("beyan edilen İSTEK gölge kipte karar vermez ama `enforce` kipinin kararı kanıta yazılır", async () => {
    mockSuggest.mockResolvedValue({ ...BASE, stayChange: { asked: "early_checkin", stance: "none" } });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const { sc } = await riskEvent(id);
    expect(sc).toMatchObject({ v: "-", ev: "availability_unconfirmed", d: "early_checkin/none" });
  });

  it("`AI_STAY_POLICY=enforce`: aynı durum taslağa düşer (gerekçe `availability_unconfirmed`)", async () => {
    vi.stubEnv("AI_STAY_POLICY", "enforce");
    mockSuggest.mockResolvedValue({ ...BASE, stayChange: { asked: "early_checkin", stance: "none" } });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await riskEvent(id)).ev.reason).toBe("availability_unconfirmed");
  });

  it("🚨 bekçi açıkken: beyansız izni ikinci model yakalar; tek çağrı, kanıtta hüküm kodları", async () => {
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    const f = guardFetch(GUARD_GRANTS);
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue({ ...BASE, reply: "Sure, see you at 11." });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(f).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
    const { ev, sc } = await riskEvent(id);
    expect(ev.reason).toBe("availability_claim");
    expect(sc).toMatchObject({ v: "availability_claim", g: "ok", gv: "qat" });
  });

  it("bekçi düştü + modelin konaklama sinyali YOK → eski davranış (gider), kanıtta 'failed'", async () => {
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    vi.stubGlobal("fetch", guardFetch(null, 500));
    mockSuggest.mockResolvedValue({ ...BASE, stayChange: { asked: "none", stance: "none" } });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect((await riskEvent(id)).sc).toMatchObject({ g: "failed", v: "-" });
  });

  it("bekçi düştü + model konaklama isteği beyan etti → gölge kipte BİLE tutulur (hakem yok, temkin)", async () => {
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    vi.stubGlobal("fetch", guardFetch(null, 500));
    mockSuggest.mockResolvedValue({ ...BASE, stayChange: { asked: "early_checkin", stance: "none" } });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await riskEvent(id)).ev.reason).toBe("availability_unconfirmed");
  });

  it("bekçi YALNIZ aday için koşar: kapı başka sebeple kapandıysa model çağrılmaz", async () => {
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    const f = guardFetch(GUARD_GRANTS);
    vi.stubGlobal("fetch", f);
    mockSuggest.mockResolvedValue({ ...BASE, confidence: 0.5 });
    const id = await seed();
    await applyChannelAutoReply(id);
    expect(f).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect((await riskEvent(id)).sc).toMatchObject({ g: "off" });
  });
});
