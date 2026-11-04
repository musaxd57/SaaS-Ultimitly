import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// ADAY SORGUSUNUN UYGUNLUK SÜZGECİ SQL'DE KALIR (ölçek turu 11-04, DB-1).
//
// Sıra + 25 tavanı JS'e taşındı (`due-order.ts`); artık tavan JS süzgecinden SONRA uygulandığı için SQL'deki
// `autoReplyAttemptedAt < lastMessageAt` koşulu kalksa bile SEÇİM aynı kalırdı — ama sorgu her geçişte işletmenin
// `freshSince`ten beri bütün damgalı "Yeni" konuşmalarını çekerdi (`freshSince` sabit damga → küme yalnız büyür). Bu dosya
// koşulun SQL'de olduğunu DAVRANIŞLA pinler: dönen satır sayısı. Casus ayrı dosyada (Prisma temsilcisine kurulan casus sızar).
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/ai", () => ({
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

import { suggestReply } from "@/lib/ai";
import { runDueChannelAutoReplies } from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);

const cleanVerdict = {
  intent: "wifi",
  confidence: 0.95,
  reply: "Wi-Fi ağı LaleApt, şifre 12345678.",
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
};

async function seed(stampedCount: number) {
  const org = await prisma.organization.create({
    data: {
      name: "Org",
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0,
      autoReplyEnabledAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 7" } });
  for (let i = 0; i < stampedCount; i++) {
    const when = new Date(Date.now() - (60 - i * 0.1) * 24 * 60 * 60 * 1000);
    await prisma.conversation.create({
      data: {
        propertyId: property.id,
        channel: "airbnb",
        guestIdentifier: `G-old-${i}`,
        externalReservationId: `old-${i}`,
        status: "new",
        lastMessageAt: when,
        autoReplyAttemptedAt: new Date(when.getTime() + 1000), // zaten modellendi
        messages: { create: [{ direction: "inbound", senderName: "G", body: "Wifi?", createdAt: when }] },
      },
    });
  }
  const freshAt = new Date(Date.now() - 60_000);
  const fresh = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "G-fresh",
      externalReservationId: "fresh",
      status: "new",
      lastMessageAt: freshAt,
      messages: { create: [{ direction: "inbound", senderName: "G", body: "Wifi şifresi nedir?", createdAt: freshAt }] },
    },
  });
  return { orgId: org.id, propertyId: property.id, freshId: fresh.id };
}

describe("oto-yanıt aday sorgusu — uygunluk SQL'de, sıra + tavan JS'te", () => {
  beforeEach(async () => {
    await resetDb();
    mockSuggest.mockReset();
    mockSuggest.mockResolvedValue(cleanVerdict);
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("damgalı 40 konuşma veritabanından HİÇ dönmez — aday sorgusu yalnız uygun satırı getirir", async () => {
    const { orgId, propertyId, freshId } = await seed(40);
    const spy = vi.spyOn(prisma.conversation, "findMany");

    const out = await runDueChannelAutoReplies(orgId);
    expect(out.sent).toBe(1);

    // Aday sorgusu: `autoReplyAttemptedAt` seçen findMany çağrısı (aynı geçişteki başka findMany'ler bu alanı seçmez).
    const candidateCalls = spy.mock.calls
      .map((call, i) => ({ arg: call[0] as { select?: Record<string, unknown>; where?: { property?: unknown } }, i }))
      .filter(({ arg }) => arg?.select?.autoReplyAttemptedAt === true && arg?.where?.property !== undefined);
    expect(candidateCalls).toHaveLength(1);
    const rows = (await spy.mock.results[candidateCalls[0].i].value) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual([freshId]);
    // SQL'de sıralama / tavan YOK (planlayıcı tuzağı) — ikisi JS'te.
    expect(candidateCalls[0].arg).not.toHaveProperty("orderBy");
    expect(candidateCalls[0].arg).not.toHaveProperty("take");
    expect(await prisma.conversation.count({ where: { propertyId, status: "answered" } })).toBe(1);
  });
});
