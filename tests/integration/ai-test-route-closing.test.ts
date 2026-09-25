import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Ayarlar "AI cevabını gör" — KAPANIŞA SESSİZLİK önizleme paritesi (kurucu kuralı 09-25). Gerçek kanal, sözcük listesinin
// tanımadığı "Anladım" kapanışında da (anlama katmanı + cevap modeli "yalnız teşekkür" derse) HİÇBİR ŞEY göndermez; önizleme
// aynı yüklemden (`semanticClosingHolds`) aynı hükmü vermeli. Cevap modeli MOCK, anlama katmanı sahte fetch.
// ---------------------------------------------------------------------------

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));

import { suggestReply } from "@/lib/ai";
import { POST } from "@/app/api/ai/test/route";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";

const mockSuggest = vi.mocked(suggestReply);

const CLOSING_DRAFT = {
  intent: "general",
  confidence: 0.3,
  reply: "Rica ederiz, iyi günler!",
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "tr",
  riskType: null,
  usedSources: [],
  missingInfo: [],
  statedCheckoutTime: null,
  stayChange: { asked: "none" as const, stance: "none" as const },
};

const NLU_THANKS = {
  language: "tr",
  requests: [{ intent: "greeting_thanks", query_tr: null, query_original: null }],
  stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
};

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/ai/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({}) };

async function seed(courtesy = false) {
  const { orgId } = await makeOrgWithProperty();
  if (courtesy) await prisma.organization.update({ where: { id: orgId }, data: { autoClosingReplyEnabled: true } });
  const user = await prisma.user.create({
    data: { organizationId: orgId, name: "O", email: `o${Date.now()}@x.com`, passwordHash: "x", role: "owner" },
  });
  session = { userId: user.id, organizationId: orgId, role: "owner", email: user.email, name: "O", sessionEpoch: 0 };
}

function understandingFetch(answer: Record<string, unknown>) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const name = JSON.parse(String(init?.body)).response_format?.json_schema?.name as string;
    if (name !== "guest_message_understanding") throw new Error(`beklenmeyen şema: ${name}`);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(answer) } }] }), {
      status: 200,
    });
  });
}

describe("POST /api/ai/test — anlamca kapanış önizlemesi", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    session = null;
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("🚨 'Anladım' + iki model 'yalnız teşekkür' → kapanış (anlam yolu); nezaket AÇIK olsa da önizleme metni YOK", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", understandingFetch(NLU_THANKS));
    mockSuggest.mockResolvedValue(CLOSING_DRAFT);
    await seed(true);
    const json = await (await POST(req({ message: "Anladım" }), ctx)).json();
    expect(json.wouldAutoSend).toBe(false);
    expect(json.closingAck).toBe(true);
    expect(json.closingSemantic).toBe(true);
    expect(json.closingReplyPreview).toBeNull();
  });

  it("KONTROL: anlama katmanı kapalı → kapanış DEĞİL (gerçek kanalla aynı: taslak ev sahibine)", async () => {
    mockSuggest.mockResolvedValue(CLOSING_DRAFT);
    await seed();
    await prisma.organization.update({ where: { id: session!.organizationId }, data: { timezone: "America/New_York" } });
    const json = await (await POST(req({ message: "Anladım" }), ctx)).json();
    expect(json.closingAck).toBe(false);
    expect(json.closingSemantic).toBe(false);
    // Zaman bağlamı (09-25): önizleme de org diliminde ("bugün / yarın") — kanal paritesi.
    expect(mockSuggest.mock.calls[0][0].timeZone).toBe("America/New_York");
  });

  it("KONTROL: cevap modeli başka niyet dedi → kapanış DEĞİL", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubGlobal("fetch", understandingFetch(NLU_THANKS));
    mockSuggest.mockResolvedValue({ ...CLOSING_DRAFT, intent: "checkin" });
    await seed();
    const json = await (await POST(req({ message: "Anladım" }), ctx)).json();
    expect(json.closingSemantic).toBe(false);
  });
});
