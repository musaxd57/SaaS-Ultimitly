import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// ADSIZ YAPAY ZEKÂ — "AI öner" rotasının bağlantısı (K10-o "D"): anahtar açıkken modele giden bilgi tabanında `{isim}` → "misafirimiz";
// hitap adı (selam için) ve görünen ad (istemden silmek için) girdiye geçer. Kapalıyken bilgi tabanında bugünkü ad biçimi.
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

const GIVEN = "Zqxwvu";
const FULL = "Zqxwvu Kanaryaoglu";

async function seed(): Promise<string> {
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  await prisma.user.create({ data: { organizationId: org.id, name: "h", email: "h@x.com", passwordHash: "x", role: "owner" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
  await prisma.knowledgeBaseItem.create({
    data: { propertyId: property.id, category: "wifi", title: "Wi-Fi", content: "Merhaba {isim}, şifre Lale2025.", isActive: true },
  });
  const day = 86_400_000;
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: FULL,
      guestGivenName: GIVEN,
      arrivalDate: new Date(Date.now() - day),
      departureDate: new Date(Date.now() + 2 * day),
      status: "confirmed",
      channel: "airbnb",
      sourceReference: "res-route",
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: reservation.id,
      channel: "airbnb",
      guestIdentifier: FULL,
      status: "new",
      messages: { create: [{ direction: "inbound", senderName: FULL, authorType: "guest", body: "Wi-Fi şifresi nedir?" }] },
    },
    select: { id: true },
  });
  session = { userId: "u1", organizationId: org.id, role: "owner", email: "h@x.com", name: "h", sessionEpoch: 0 };
  return conversation.id;
}

async function suggestInput() {
  const id = await seed();
  const res = await aiSuggest(
    new NextRequest(`http://localhost/api/conversations/${id}/ai-suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    { params: Promise.resolve({ id }) },
  );
  expect(res.status).toBe(200);
  return mockSuggest.mock.calls[0][0];
}

describe("POST /api/conversations/[id]/ai-suggest — adsız yapay zekâ bağlantısı", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    mockSuggest.mockResolvedValue({
      intent: "wifi",
      confidence: 0.9,
      reply: "Şifre Lale2025.",
      risk: null,
      priority: "standard",
      source: "openai",
      actionSuggestion: null,
      riskLevel: "none",
      detectedLanguage: "tr",
      riskType: null,
      usedSources: [],
      sourceAudit: { declared: 0, verified: 0 },
      missingInfo: [],
      statedCheckoutTime: null,
    } as never);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("KONTROL — anahtar kapalı: bilgi tabanında ad (bugünkü kural)", async () => {
    const input = await suggestInput();
    expect(input.knowledgeBase.map((k) => k.content).join(" ")).toContain(`Merhaba ${GIVEN},`);
  });

  it("🚨 anahtar açık: bilgi tabanında ad YOK ('misafirimiz'); hitap adı + görünen ad girdide (modele değil kodun selamına / silmeye)", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    const input = await suggestInput();
    const kb = input.knowledgeBase.map((k) => k.content).join(" ");
    expect(kb).toContain("Merhaba misafirimiz,");
    expect(kb).not.toContain(GIVEN);
    expect(input.reservation?.guestGivenName).toBe(GIVEN);
    expect(input.guestIdentifier).toBe(FULL);
  });
});
