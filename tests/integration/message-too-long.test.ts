import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// K10-t (kurucu kararı 09-28): tek bir kanal mesajı 8.000 karakteri aşarsa yapay zekâ OTOMATİK CEVAP ÜRETMEZ; metin kırpılıp
// modele verilmez; mesaj tam saklanır; ev sahibine görünür "elle yanıtla" uyarısı (e-posta YOK); acil sözcükler hafif kontrolle
// YİNE aranır (acil e-postası çalışır); "AI öner" modele gitmez, açıklama döner. Kontrol pahalı işlemlerden ÖNCE.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
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
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => {}) };
});

import { suggestReply } from "@/lib/ai";
import { emailService } from "@/lib/email";
import { runDueChannelAutoReplies, sendDueAlerts } from "@/lib/automation";
import { POST as aiSuggest } from "@/app/api/conversations/[id]/ai-suggest/route";

const mockSuggest = vi.mocked(suggestReply);
const mockMail = vi.mocked(emailService.sendReporting);

const fallbackVerdict = {
  intent: "general",
  confidence: 0.2,
  reply: "Mesajınız ev sahibine iletildi.",
  risk: null,
  priority: "standard" as const,
  source: "fallback" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "tr",
  riskType: null,
  usedSources: [],
  missingInfo: [],
  statedCheckoutTime: null,
};

const LONG = (tail: string) => "Merhaba, uzun bir mesaj. ".repeat(330) + tail; // > 8.000 karakter

async function seed(body: string, when = new Date(Date.now() - 60_000)) {
  const org = await prisma.organization.create({
    data: {
      name: "Org",
      alertEmail: "host@example.com",
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0,
      autoReplyEnabledAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    },
  });
  await prisma.user.create({ data: { organizationId: org.id, name: "h", email: "h@x.com", passwordHash: "x", role: "owner" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 7" } });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "G",
      externalReservationId: "res-long-1",
      status: "new",
      lastMessageAt: when,
      messages: { create: [{ direction: "inbound", authorType: "guest", senderName: "G", body, createdAt: when }] },
    },
    select: { id: true },
  });
  session = { userId: "u1", organizationId: org.id, role: "owner", email: "h@x.com", name: "h", sessionEpoch: 0 };
  return { orgId: org.id, conversationId: conversation.id, when };
}

describe("K10-t — 8.000 karakteri aşan kanal mesajı", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    mockSuggest.mockReset();
    mockSuggest.mockResolvedValue(fallbackVerdict as never);
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 oto-yanıt: model ÇAĞRILMAZ, sebep message_too_long, damgalanır, metin TAM saklı", async () => {
    const body = LONG("Otopark var mı?");
    expect(body.length).toBeGreaterThan(8000);
    const { orgId, conversationId, when } = await seed(body);
    await runDueChannelAutoReplies(orgId);
    await runDueChannelAutoReplies(orgId);
    expect(mockSuggest).not.toHaveBeenCalled();
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { messages: true } });
    expect(row.skippedReason).toBe("message_too_long");
    expect(row.autoReplyAttemptedAt?.getTime()).toBe(when.getTime());
    expect(row.status).toBe("new"); // gizlenmez, cevaplanmış sayılmaz
    expect(row.messages[0].body).toBe(body); // kırpılmadı
  });

  it("KONTROL — tam 8.000 karakter: model çağrılır (bugünkü akış)", async () => {
    const body = "a".repeat(7990) + " otopark?";
    expect([...body]).toHaveLength(7999);
    const { orgId } = await seed(body);
    await runDueChannelAutoReplies(orgId);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
  });

  it("🚨 uyarı yolu: uzun mesajda ACİL sözcük → Sorunlu + ev sahibine e-posta (bugünkü acil yol)", async () => {
    const { orgId, conversationId } = await seed(LONG("Dairede gaz kokusu var!"));
    await sendDueAlerts(orgId);
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(row.status).toBe("problem");
    expect(row.lastRiskType).toBe("safety_emergency");
    expect(mockMail).toHaveBeenCalled();
  });

  it("uyarı yolu: uzun mesajda acil OLMAYAN şikâyet uyarı üretmez (tam sınıflandırma koşmaz); KONTROL kısa mesaj uyarır", async () => {
    const complaint = "Daire çok kirli, param iade edilsin. Bu kabul edilemez!";
    const long = await seed(LONG(complaint));
    await sendDueAlerts(long.orgId);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: long.conversationId } })).status).toBe("new");
    expect(mockMail).not.toHaveBeenCalled();

    await resetDb();
    const short = await seed(complaint);
    await sendDueAlerts(short.orgId);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: short.conversationId } })).status).toBe("problem");
  });

  it("🚨 AI öner: 422 + açıklama; model çağrısı ve kota düşümü YOK", async () => {
    const { orgId, conversationId } = await seed(LONG("Otopark var mı?"));
    const res = await aiSuggest(
      new NextRequest(`http://localhost/api/conversations/${conversationId}/ai-suggest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: conversationId }) },
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/8\.000 karakterden uzun/);
    expect(mockSuggest).not.toHaveBeenCalled();
    const budget = await prisma.rateLimitCounter.findUnique({ where: { key: `ai-daily:${orgId}` } });
    expect(budget?.count ?? 0).toBe(0);
  });

  it("🚨 AI öner: uzun mesajdan SONRA ev sahibi yazmış olsa da (cevap verilen mesaj yine o) 422 — model çağrılmaz (09-28 inceleme)", async () => {
    // Eski kural yalnız "cevapsız" mesajlara bakıyordu; rota ise son GELEN mesaja cevap önerir — araya giden bir mesaj girince
    // uzun metin modele TAM gidiyordu (anlama katmanına kırpılarak) ve kota düşüyordu.
    const { orgId, conversationId, when } = await seed(LONG("Otopark var mı?"));
    await prisma.message.create({
      data: { conversationId, direction: "outbound", authorType: "host", senderName: "Ev sahibi", body: "Bakıyorum.", createdAt: new Date(when.getTime() + 1000) },
    });
    const res = await aiSuggest(
      new NextRequest(`http://localhost/api/conversations/${conversationId}/ai-suggest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: conversationId }) },
    );
    expect(res.status).toBe(422);
    expect(mockSuggest).not.toHaveBeenCalled();
    const budget = await prisma.rateLimitCounter.findUnique({ where: { key: `ai-daily:${orgId}` } });
    expect(budget?.count ?? 0).toBe(0);
  });
});
