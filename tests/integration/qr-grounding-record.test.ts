import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// A2 — QR yanıt kararı GETİRİLEN ↔ KULLANILAN kaynağı da kaydeder (09-08).
//
// Neden: `RiskEvent` artık devir GEREKÇESİNİ yazıyor (09-08 turu) ama gerekçe
// tek başına "neden temellendiremedi"yi söylemiyor. Canlıda `low_confidence`
// gören biri, mülkte hiç kalem olmadığını mı yoksa kalemler modele gidip
// kullanılmadığını mı bilmiyor — ikisinin ÇÖZÜMÜ ZITTIR (birinde host'a bilgi
// ekletirsin, diğerinde eklettiğin bilgi hiçbir işe yaramaz).
//
// 🚨 Modelin `usedSources` BEYANI tek başına kanıt değildir; bu yüzden satıra
// kodun bildiği `kbRetrieved` ile modelin beyan ettiği `srcDeclared` ve
// doğrulanmış `srcVerified` YAN YANA yazılır.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

const mockSuggest = vi.fn();
vi.mock("@/lib/ai", () => ({ suggestReply: (...a: unknown[]) => mockSuggest(...a) }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/chat/[token]/route";

const DAY = 86_400_000;

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const token = `qrtok_${Math.random().toString(36).slice(2)}${"x".repeat(12)}`;
  await prisma.property.update({
    where: { id: propertyId },
    data: { chatEnabled: true, chatToken: token, checkInTime: "15:00", checkOutTime: "11:00" },
  });
  await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Test Misafir",
      arrivalDate: new Date(Date.now() - DAY),
      departureDate: new Date(Date.now() + 2 * DAY),
      status: "confirmed",
      channel: "manual",
      currency: "EUR",
    },
  });
  return { orgId, propertyId, token };
}

let seq = 0;
function ask(token: string, message: string) {
  return POST(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, requestId: `req-${++seq}-${Math.random().toString(36).slice(2)}` }),
    }),
    { params: Promise.resolve({ token }) },
  );
}

const okReply = (over: Record<string, unknown> = {}) => ({
  reply: "Otopark bina altındadır.",
  intent: "parking",
  riskLevel: "none",
  riskType: null,
  confidence: 0.9,
  source: "openai",
  priority: "standard",
  risk: null,
  actionSuggestion: null,
  detectedLanguage: "tr",
  usedSources: ["kb:parking"],
  // `@/lib/ai` bu dosyada MOCK'LU: burada ölçülen şey rotanın sayaçları KARARA
  // sadık yazması. Beyan ↔ doğrulama HESABININ kendisi ayrı dosyada gerçek
  // parser'la ölçülüyor (`ai-source-audit.test.ts`) — mock'lu bir dosyada onu
  // "doğruladım" demek yanlış olurdu.
  sourceAudit: { declared: 1, verified: 1 },
  missingInfo: [],
  statedCheckoutTime: null,
  ...over,
});

async function addKb(propertyId: string, over: Record<string, unknown> = {}) {
  return prisma.knowledgeBaseItem.create({
    data: {
      propertyId,
      category: "parking",
      title: "Otopark",
      content: "Bina altı otopark ücretsizdir.",
      isActive: true,
      source: "host_manual",
      reviewState: "approved",
      ...over,
    },
  });
}

describe("A2 — QR RiskEvent'i temellendirme sayaçlarını taşır", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("KB boşken: retrieved 0, onay bekleyen 0 — 'bilgi yokluğu' okunabilir", async () => {
    const { token } = await seed();
    mockSuggest.mockResolvedValue(okReply({ confidence: 0.4, usedSources: [] }));
    await ask(token, "Otopark var mi?");
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { surface: "guest_chat" } });
    expect(ev.kbRetrieved).toBe(0);
    expect(ev.kbPendingApproval).toBe(0);
    expect(ev.kbDropped).toBe(0);
    expect(ev.kbVersionAt).toBeNull();
  });

  it("ONAY BEKLEYEN kalem varken retrieved 0 ama pendingApproval 1 — ayrı sınıf", async () => {
    const { propertyId, token } = await seed();
    await addKb(propertyId, { source: "extracted_draft", reviewState: "draft" });
    mockSuggest.mockResolvedValue(okReply({ confidence: 0.4, usedSources: [] }));
    await ask(token, "Otopark var mi?");
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { surface: "guest_chat" } });
    expect(ev.kbRetrieved).toBe(0);
    expect(ev.kbPendingApproval).toBe(1);
  });

  it("kalem VARDI ve model kullandı: retrieved 1, declared 1, verified 1, sürüm yazılı", async () => {
    const { propertyId, token } = await seed();
    const kb = await addKb(propertyId);
    mockSuggest.mockResolvedValue(okReply());
    await ask(token, "Otopark var mi?");
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { surface: "guest_chat" } });
    expect(ev.kbRetrieved).toBe(1);
    expect(ev.srcDeclared).toBe(1);
    expect(ev.srcVerified).toBe(1);
    const row = await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: kb.id } });
    expect(ev.kbVersionAt?.getTime()).toBe(row.updatedAt.getTime());
  });

  it("UYDURMA ATIF: model olmayan kategoriye atıf yaparsa declared>verified olarak görünür", async () => {
    const { propertyId, token } = await seed();
    await addKb(propertyId); // yalnız "parking" var
    // Model "kb:wifi" diyor — böyle bir kalem YOK. `verifyUsedSources` bunu
    // zaten sessizce eliyordu; artık ELENDİĞİ GÖRÜLÜYOR.
    mockSuggest.mockResolvedValue(
      okReply({ usedSources: [], sourceAudit: { declared: 1, verified: 0 } }),
    );
    await ask(token, "Wifi sifresi ne?");
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { surface: "guest_chat" } });
    expect(ev.srcDeclared).toBe(1);
    expect(ev.srcVerified).toBe(0);
    expect(ev.kbRetrieved).toBe(1);
  });

  it("sayaçlar misafirin cevabını BOZMAZ (yan etki sözleşmesi korunur)", async () => {
    const { propertyId, token } = await seed();
    await addKb(propertyId);
    mockSuggest.mockResolvedValue(okReply());
    const res = await ask(token, "Otopark var mi?");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply: string };
    expect(body.reply).toContain("Otopark");
  });
});
