import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// 56 — QR ROTASI BAĞLANTISI (kurucu onayı 10-02 akşam): kodca belirsiz kısa soruda ("Y a-t-il un fer à repasser ?") rota modelin
// bildirdiği misafir dilini kapıya verir; Türkçe gövdeli cevap misafire GİTMEZ, Fransızca cevap gider. Cevap modeli MOCK, DB gerçek.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});
const mockSuggest = vi.fn();
vi.mock("@/lib/ai", () => ({ suggestReply: (...a: unknown[]) => mockSuggest(...a) }));

import { NextRequest } from "next/server";
import { POST as CHAT } from "@/app/api/chat/[token]/route";

const FR = "Y a-t-il un fer à repasser ?";
const DRAFT = {
  intent: "amenities",
  riskLevel: "none",
  riskType: null,
  confidence: 0.93,
  source: "openai",
  priority: "standard",
  risk: null,
  actionSuggestion: null,
  detectedLanguage: "fr",
  usedSources: [],
  sourceAudit: { declared: 0, verified: 0 },
  missingInfo: [],
  statedCheckoutTime: null,
};

async function seed() {
  const { propertyId } = await makeOrgWithProperty();
  const token = `qrtok_${Math.random().toString(36).slice(2)}${"x".repeat(12)}`;
  await prisma.property.update({ where: { id: propertyId }, data: { chatEnabled: true, chatToken: token } });
  await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Test Misafir",
      arrivalDate: new Date(Date.now() - 86_400_000),
      departureDate: new Date(Date.now() + 2 * 86_400_000),
      status: "confirmed",
      channel: "manual",
    },
  });
  return token;
}

let seq = 0;
async function ask(token: string, message: string) {
  const res = await CHAT(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, requestId: `lw${++seq}-${Math.random().toString(36).slice(2)}` }),
    }),
    { params: Promise.resolve({ token }) },
  );
  return (await res.json()) as { reply?: string | null; escalated?: boolean };
}

describe("QR dil kapısı — rota bağlantısı (56)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("QR_INFORMATIONAL_BAND_ENABLED", "");
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 ölçülen vaka: Fransızca kısa soru + Türkçe gövdeli cevap → misafire gitmez, gerekçe reply_language_mismatch", async () => {
    mockSuggest.mockResolvedValue({ ...DRAFT, reply: "Evet, dairede ütü ve ütü masası bulunuyor, koridordaki dolaptadır." });
    const out = await ask(await seed(), FR);
    expect(out.escalated).toBe(true);
    expect(out.reply ?? null).toBeNull();
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { surface: "guest_chat" }, orderBy: { occurredAt: "desc" } });
    expect(ev.reason).toBe("reply_language_mismatch");
  });

  it("KONTROL: aynı soruya Fransızca cevap → gider", async () => {
    const reply = "Oui, le fer et la table à repasser se trouvent dans le placard du couloir.";
    mockSuggest.mockResolvedValue({ ...DRAFT, reply });
    const out = await ask(await seed(), FR);
    expect(out.escalated).toBe(false);
    expect(out.reply).toBe(reply);
  });
});
