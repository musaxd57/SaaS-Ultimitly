import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// 51 — KANAL OTO-YANITI BAĞLANTISI (kurucu onayı 10-02 akşam: "51'e de bağlam ilkesini uygula. Açık tehlike kanıtını modelin 'tehlike
// yok' kararı geçersiz kılamasın. Tehlikesiz bağlamda alarm kaldırılabilsin; ancak 'normaldir, güvenlidir' diye kaynaksız güvence
// verilmesin. Model arızasında mevcut olası tehlike güvenli tarafta kalsın."). Cevap modeli MOCK, anlama katmanı sahte fetch, DB gerçek.
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
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);

const BASE = {
  intent: "general",
  confidence: 0.92,
  reply: "Çaydanlığı ocaktan alıp soğumasını bekleyin.",
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "tr",
  riskType: null,
  usedSources: [],
  sourceAudit: { declared: 0, verified: 0 },
  missingInfo: [],
  statedCheckoutTime: null,
};

async function seed(body: string) {
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
      messages: { create: [{ direction: "inbound", senderName: "Alex", body, createdAt: new Date(Date.now() - 60_000) }] },
    },
    select: { id: true },
  });
  return conversation.id;
}

function understandingFetch(intent: string) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const name = JSON.parse(String(init?.body)).response_format?.json_schema?.name as string;
    if (name !== "guest_message_understanding") throw new Error(`beklenmeyen şema: ${name}`);
    const verdict = {
      language: "tr",
      requests: [{ intent, query_tr: "duman", query_original: "duman" }],
      stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
    };
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(verdict) } }] }), {
      status: 200,
    });
  });
}

async function gateDetail(conversationId: string) {
  const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" } });
  return (JSON.parse(String(ev.kbEvidenceJson)) as { g?: { d?: string } }).g?.d;
}

const KETTLE = "Çaydanlıktan duman çıkıyor, normal mi?";

describe("kanal oto-yanıtı — bağlamla tehlike (51)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
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

  it("OLASI tehlike + anlama katmanı KAPALI → güvenli taraf: gönderilmez, acil rozeti kalır (bugünkü davranış)", async () => {
    mockSuggest.mockResolvedValue(BASE);
    const id = await seed(KETTLE);
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await gateDetail(id)).toBe("lexical_risk");
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id } })).toMatchObject({ lastRiskType: "safety_emergency" });
  });

  it("OLASI tehlike + anlama katmanı 'acil değil' → acil rozeti kalkar ama şikâyet akışı (gönderilmez, rozet şikâyet)", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", understandingFetch("appliance_help"));
    mockSuggest.mockResolvedValue(BASE);
    const id = await seed(KETTLE);
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id } })).toMatchObject({ lastRiskType: "complaint" });
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId: id, surface: "auto_reply" } });
    expect(ev.riskType).toBe("complaint");
  });

  it("🚨 alarm kalksa da KAYNAKSIZ güvence gitmez (hazard_reassurance); rozet acil durum DEĞİL", async () => {
    mockSuggest.mockResolvedValue({ ...BASE, reply: "Bina tamamen güvenlidir, endişelenmeyin; çıkış merdiveni koridorun sonunda." });
    const id = await seed("Yangın çıkarsa hangi kapıdan çıkmalıyız?");
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await gateDetail(id)).toBe("hazard_reassurance");
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id } })).lastRiskType).not.toBe("safety_emergency");
    // Karar kaydının risk etiketi de bağlam kararını izler (kalkan acil etiketi kayda "acil durum" diye yazılmaz).
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId: id, surface: "auto_reply" } });
    expect(ev.riskType).not.toBe("safety_emergency");
  });

  it("model hassas dediğinde (insan talebi) yükseltme rozeti de bağlam kararını izler: anılan tehlike 'acil durum' rozeti DOĞURMAZ", async () => {
    mockSuggest.mockResolvedValue({
      ...BASE,
      intent: "human_request",
      riskLevel: "medium" as never,
      reply: "Mesajınızı ev sahibinize iletiyorum.",
    });
    const id = await seed("Yangın çıkarsa hangi kapıdan çıkmalıyız?");
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id } });
    // Yükseltme yolu koştu (insan talebi ev sahibine taşındı) ve rozet anılan tehlikeyi "acil durum" yazmadı.
    expect(conv).toMatchObject({ status: "problem", skippedReason: "escalated_to_human", lastRiskType: null });
  });

  it("🚨 AÇIK tehlike: anlama katmanı 'acil değil' dese de alarm KALKMAZ", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", understandingFetch("appliance_help"));
    mockSuggest.mockResolvedValue({ ...BASE, reply: "Prizi kullanmayın." });
    const id = await seed("Prizden duman çıkıyor, yanık kokuyor!");
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
    // Kelime ağı bu mesajı hem şikâyet niyeti hem acil etiketiyle görür; ilk kapatan kontrol niyet olabilir.
    expect(["lexical_intent", "lexical_risk"]).toContain(await gateDetail(id));
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id } })).toMatchObject({ lastRiskType: "safety_emergency" });
  });

  it("ANILAN tehlike ('yangın çıkarsa…') anlama katmanı kapalıyken de alarm üretmez, cevap gider", async () => {
    mockSuggest.mockResolvedValue({ ...BASE, reply: "Bina girişinin yanındaki merdivenden çıkabilirsiniz." });
    const id = await seed("Yangın çıkarsa hangi kapıdan çıkmalıyız?");
    await applyChannelAutoReply(id);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("başka acil sınıfı (sağlık) varsa bağlam alarmı kaldıramaz", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", understandingFetch("appliance_help"));
    mockSuggest.mockResolvedValue(BASE);
    const id = await seed("Çaydanlıktan duman çıkıyor ve babam bayıldı!");
    await applyChannelAutoReply(id);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
