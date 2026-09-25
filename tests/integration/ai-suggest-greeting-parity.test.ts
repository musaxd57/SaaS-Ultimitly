import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// SELAM TEKRARI PARİTESİ — gelen kutusu "AI öner" (09-25). Kanal oto-yanıtı ve QR "daha önce cevap verdik mi" bilgisini
// KODDAN veriyordu (`isFirstOperatorReply`); bu yüzey hiç vermiyordu → taslak devam eden konuşmada da yeniden
// selamlıyordu. Kural tek kaynak `countPriorOperatorReplies`: konuşmanın TAMAMI, sistem olayı ve gövdesiz satır sayılmaz.
// Cevap modeli MOCK; DB gerçek.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
  suggestReply: vi.fn(),
}));

import { suggestReply } from "@/lib/ai";
import { POST as aiSuggest } from "@/app/api/conversations/[id]/ai-suggest/route";

const mockSuggest = vi.mocked(suggestReply);

const REPLY = {
  intent: "wifi",
  confidence: 0.9,
  reply: "The Wi-Fi details are on the card next to the router.",
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "en",
  riskType: null,
  usedSources: [],
  sourceAudit: { declared: 0, verified: 0 },
  missingInfo: [],
  statedCheckoutTime: null,
  stayChange: { asked: "none" as const, stance: "none" as const },
};

type Row = { direction: "inbound" | "outbound"; body: string; systemEventType?: string };

async function seed(rows: Row[]) {
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  await prisma.user.create({ data: { organizationId: org.id, name: "h", email: "h@x.com", passwordHash: "x", role: "owner" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
  const t0 = Date.now() - 10 * 60_000;
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      messages: {
        create: rows.map((m, i) => ({
          direction: m.direction,
          senderName: m.direction === "inbound" ? "Alex" : "Host",
          authorType: m.systemEventType ? "system" : m.direction === "inbound" ? "guest" : "host",
          systemEventType: m.systemEventType ?? null,
          body: m.body,
          createdAt: new Date(t0 + i * 60_000),
        })),
      },
    },
    select: { id: true },
  });
  session = { userId: "u1", organizationId: org.id, role: "owner", email: "h@x.com", name: "h", sessionEpoch: 0 };
  return conversation.id;
}

async function firstOperatorReplyFor(rows: Row[]): Promise<boolean | undefined> {
  const id = await seed(rows);
  const res = await aiSuggest(
    new NextRequest(`http://localhost/api/conversations/${id}/ai-suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    { params: Promise.resolve({ id }) },
  );
  expect(res.status).toBe(200);
  expect(mockSuggest).toHaveBeenCalledTimes(1);
  return mockSuggest.mock.calls[0][0].conversationState?.isFirstOperatorReply;
}

describe("POST /api/conversations/[id]/ai-suggest — selam tekrarı paritesi", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    mockSuggest.mockResolvedValue(REPLY);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("ilk temas: misafire henüz hiçbir şey gitmedi → ilk cevap (selam serbest)", async () => {
    expect(await firstOperatorReplyFor([{ direction: "inbound", body: "Hi, what is the wifi?" }])).toBe(true);
  });

  it("🚨 devam eden konuşma: önceki bir cevap var → ilk cevap DEĞİL (taslak yeniden selamlamaz)", async () => {
    expect(
      await firstOperatorReplyFor([
        { direction: "inbound", body: "Hi!" },
        { direction: "outbound", body: "Welcome! Let me know if you need anything." },
        { direction: "inbound", body: "What is the wifi?" },
      ]),
    ).toBe(false);
  });

  it("🚨 sayım KONUŞMA kapsamlı: aynı mülkün başka konuşmasındaki cevap bu konuşmayı 'devam eden' yapmaz", async () => {
    const id = await seed([{ direction: "inbound", body: "Hi, what is the wifi?" }]);
    const target = await prisma.conversation.findUniqueOrThrow({ where: { id }, select: { propertyId: true } });
    await prisma.conversation.create({
      data: {
        propertyId: target.propertyId,
        channel: "airbnb",
        guestIdentifier: "Başka misafir",
        status: "answered",
        messages: {
          create: [
            { direction: "inbound", senderName: "B", authorType: "guest", body: "Hello" },
            { direction: "outbound", senderName: "Host", authorType: "host", body: "Welcome!" },
          ],
        },
      },
    });
    const res = await aiSuggest(
      new NextRequest(`http://localhost/api/conversations/${id}/ai-suggest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    expect(mockSuggest.mock.calls[0][0].conversationState?.isFirstOperatorReply).toBe(true);
  });

  it("sistem olayı ve gövdesiz giden satır cevap sayılmaz (misafir onları görmez)", async () => {
    expect(
      await firstOperatorReplyFor([
        { direction: "inbound", body: "Hi!" },
        { direction: "outbound", body: "AI resumed", systemEventType: "guest_chat_ai_resumed" },
        { direction: "outbound", body: "" },
        { direction: "inbound", body: "What is the wifi?" },
      ]),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Konuşma Anlama Durumu v1 dilim B — gelen kutusu bağlantısı. Bayrak KAPALI: kayıt yüklenmez. AÇIK: ev sahibine
// bırakılmış önceki mesajın karar kaydı taslağı yazan modele PII'siz özet olarak gider.
// ---------------------------------------------------------------------------
describe("POST /api/conversations/[id]/ai-suggest — konuşma kayıtları (CUS v1 dilim B)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    mockSuggest.mockResolvedValue(REPLY);
  });
  afterEach(() => vi.unstubAllEnvs());

  async function seedHeldComplaint(): Promise<string> {
    const id = await seed([
      { direction: "inbound", body: "The shower is broken" },
      { direction: "inbound", body: "Any update?" },
    ]);
    const first = await prisma.message.findFirstOrThrow({ where: { conversationId: id, body: "The shower is broken" } });
    await prisma.riskEvent.create({
      data: { organizationId: session.organizationId, surface: "auto_reply", triggerId: first.id, finalDecision: "human_review", riskType: "complaint" },
    });
    return id;
  }

  async function recordsFor(id: string) {
    const res = await aiSuggest(
      new NextRequest(`http://localhost/api/conversations/${id}/ai-suggest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    return mockSuggest.mock.calls[0][0].conversationState?.records;
  }

  it("bayrak KAPALI: taslağı yazan modele kayıt gitmez", async () => {
    expect(await recordsFor(await seedHeldComplaint())).toBeUndefined();
  });

  it("🚨 bayrak AÇIK: ev sahibine bırakılmış şikâyet 'bekliyor' olarak gider", async () => {
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "1");
    expect(await recordsFor(await seedHeldComplaint())).toEqual({
      outbound: 0,
      hostOutbound: 0,
      unansweredGuest: 2,
      items: [{ topic: "complaint", status: "pending_host" }],
      lifecycleSent: [],
    });
  });
});
