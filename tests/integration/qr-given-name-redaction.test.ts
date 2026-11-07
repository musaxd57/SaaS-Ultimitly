import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// QR — kanalın AYRI hitap adı da silme anahtarıdır (09-28 inceleme ajanı, migration 57 turu). QR rotası anlama katmanına /
// bekçiye / getirmeye yalnız rezervasyonun tam adını veriyordu: tam ad "Robert Smith", hitap adı "Bob" iken misafirin "It's
// Bob" yazdığı ad o katmanlara açık gidiyordu. Adsız yapay zekâ anahtarı açıkken cevap isteminin de silme anahtarı yoktu
// (QR `reservation: null` geçer) — artık görünen ad `guestIdentifier` olarak verilir (anahtar kapalıyken istemde kullanılmaz).
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});
const mockSuggest = vi.fn();
vi.mock("@/lib/ai", () => ({ suggestReply: (...a: unknown[]) => mockSuggest(...a) }));
const capturedRedactNames: unknown[] = [];
vi.mock("@/lib/ai/kb-retrieve", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai/kb-retrieve")>();
  return {
    ...actual,
    retrieveKbForPrompt: (input: { redactNames?: unknown }) => {
      capturedRedactNames.push(input.redactNames);
      return actual.retrieveKbForPrompt(input as never);
    },
  };
});

import { NextRequest } from "next/server";
import { POST } from "@/app/api/chat/[token]/route";

const DAY = 86_400_000;

async function seed() {
  const { propertyId } = await makeOrgWithProperty();
  const token = `qrtok_${Math.random().toString(36).slice(2)}${"x".repeat(12)}`;
  await prisma.property.update({
    where: { id: propertyId },
    data: { chatEnabled: true, chatToken: token, checkInTime: "15:00", checkOutTime: "11:00" },
  });
  await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Robert Smith",
      guestGivenName: "Bob",
      arrivalDate: new Date(Date.now() - DAY),
      departureDate: new Date(Date.now() + 2 * DAY),
      status: "confirmed",
      channel: "manual",
    },
  });
  return token;
}

describe("QR — hitap adı silme anahtarı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    capturedRedactNames.length = 0;
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("🚨 getirme / anlama katmanı hitap adını da siler; cevap isteminin silme anahtarı (görünen ad) verilir", async () => {
    const token = await seed();
    mockSuggest.mockResolvedValue({
      reply: "Havlular dolapta.",
      intent: "general",
      riskLevel: "none",
      riskType: null,
      confidence: 0.9,
      source: "openai",
      priority: "standard",
      actionSuggestion: null,
      detectedLanguage: "en",
      usedSources: [],
      missingInfo: [],
      sourceAudit: { declared: 0, verified: 0 },
    });
    const res = await POST(
      new NextRequest(`http://localhost/api/chat/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Hi, it's Bob. Where are the towels?", requestId: `qr-name-${Date.now()}` }),
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(res.status).toBe(200);
    expect(capturedRedactNames[0]).toEqual(["Robert Smith", "Bob"]);
    expect((mockSuggest.mock.calls[0][0] as { guestIdentifier?: string }).guestIdentifier).toBe("Robert Smith");
    // Misafire dönen yanıt adı taşımaz (bağlam iç kullanım).
    expect(JSON.stringify(await res.json())).not.toContain("Robert");
  });
});
