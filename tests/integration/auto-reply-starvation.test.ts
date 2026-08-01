import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// ADAY PENCERESİ AÇLIĞA DÜŞMEZ (denetim, 2026-08-01).
//
// Bulunan arıza: uygunluk filtresi (`autoReplyAttemptedAt < lastMessageAt`)
// yalnızca JS'te uygulanıyordu, ama araya SQL'de `take: 25` + `orderBy
// lastMessageAt asc` (en eski önce) konmuştu. Sonuç KALICI AÇLIKTI:
//
//   · Damgalanmış konuşmalar (`closing_ack` / `low_confidence_or_risky` /
//     `globally_disabled`) `status:"new"` KALIR ve en eski oldukları için
//     sıranın başındadır.
//   · 25 tanesi birikince `candidates` tamamen onlarla dolar, JS filtresi
//     hepsini eler, `eligible` BOŞ kalır.
//   · `freshSince` sabit bir damga (kayan pencere DEĞİL) → küme yalnız BÜYÜR.
//
// Yani org'un TÜM oto-yanıtı sessizce ölürdü ve tek iz `considered: 0` olurdu —
// onu da kimse okumuyor. Düzeltme: uygunluk SQL'e taşındı, tavan artık UYGUN
// satırlara uygulanıyor.
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
  reply: "Wi-Fi ağı NuveApt, şifre 12345678.",
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

async function seedOrg() {
  const org = await prisma.organization.create({
    data: {
      name: "Org",
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0,
      autoReplyEnabledAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Nuve 7" },
  });
  return { orgId: org.id, propertyId: property.id };
}

/** Bir konuşma + tek gelen mesaj. `stamped` verilirse zaten modellenmiş sayılır. */
async function seedConversation(
  propertyId: string,
  opts: { ref: string; ageDays: number; stamped?: boolean; holdUntil?: Date },
) {
  const when = new Date(Date.now() - opts.ageDays * 24 * 60 * 60 * 1000);
  return prisma.conversation.create({
    data: {
      propertyId,
      channel: "airbnb",
      guestIdentifier: `G-${opts.ref}`,
      externalReservationId: opts.ref,
      status: "new",
      lastMessageAt: when,
      // Damga mesajdan SONRA → konuşma "zaten modellendi" sayılır.
      autoReplyAttemptedAt: opts.stamped ? new Date(when.getTime() + 1000) : null,
      autoReplyHoldUntil: opts.holdUntil ?? null,
      messages: {
        create: [
          { direction: "inbound", senderName: "G", body: "Wifi şifresi nedir?", createdAt: when },
        ],
      },
    },
  });
}

describe("oto-yanıt aday penceresi — kalıcı açlık yok", () => {
  beforeEach(async () => {
    await resetDb();
    mockSuggest.mockReset();
    mockSuggest.mockResolvedValue(cleanVerdict);
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("30 DAMGALANMIŞ eski konuşma, YENİ bir mesajı dışarıda bırakamaz", async () => {
    const { orgId, propertyId } = await seedOrg();

    // Tavan 25; damgalı ve EN ESKİ olan 30 konuşma sıranın başında duruyor.
    for (let i = 0; i < 30; i++) {
      await seedConversation(propertyId, { ref: `old-${i}`, ageDays: 60 - i * 0.1, stamped: true });
    }
    // Bugün gelen gerçek misafir mesajı — en YENİ, yani `asc` sırada EN SONDA.
    const fresh = await seedConversation(propertyId, { ref: "fresh", ageDays: 0 });

    const out = await runDueChannelAutoReplies(orgId);

    // Düzeltmeden önce: candidates 30 damgalıyla dolar, eligible boş, sent = 0.
    expect(out.sent).toBe(1);
    expect(mockSuggest).toHaveBeenCalledTimes(1);

    const answered = await prisma.conversation.findUniqueOrThrow({
      where: { id: fresh.id },
      select: { status: true },
    });
    expect(answered.status).toBe("answered");
  });

  it("İNSAN DEVRİ süren konuşmalar aday slotu işgal etmez", async () => {
    const { orgId, propertyId } = await seedOrg();

    // 30 konuşma insan devrinde (AI susuyor) ve hepsi en eski.
    const holdUntil = new Date(Date.now() + 6 * 60 * 60 * 1000);
    for (let i = 0; i < 30; i++) {
      await seedConversation(propertyId, { ref: `hold-${i}`, ageDays: 60 - i * 0.1, holdUntil });
    }
    await seedConversation(propertyId, { ref: "fresh", ageDays: 0 });

    const out = await runDueChannelAutoReplies(orgId);
    expect(out.sent).toBe(1);
  });

  it("devir SÜRESİ DOLUNCA konuşma kendiliğinden geri gelir (kalıcı dışlama yok)", async () => {
    const { orgId, propertyId } = await seedOrg();
    // Devir penceresi GEÇMİŞTE bitmiş.
    await seedConversation(propertyId, {
      ref: "expired-hold",
      ageDays: 1,
      holdUntil: new Date(Date.now() - 60_000),
    });

    const out = await runDueChannelAutoReplies(orgId);
    expect(out.sent).toBe(1);
  });

  it("tavan hâlâ uygulanıyor: 40 UYGUN konuşmadan en fazla 25'i işlenir", async () => {
    const { orgId, propertyId } = await seedOrg();
    for (let i = 0; i < 40; i++) {
      await seedConversation(propertyId, { ref: `n-${i}`, ageDays: 10 - i * 0.1 });
    }

    const out = await runDueChannelAutoReplies(orgId);
    expect(out.considered).toBe(25);
    expect(mockSuggest).toHaveBeenCalledTimes(25);
  });

  it("SIRA adil: en eski cevapsız mesaj önce işlenir", async () => {
    const { orgId, propertyId } = await seedOrg();
    const oldest = await seedConversation(propertyId, { ref: "oldest", ageDays: 5 });
    await seedConversation(propertyId, { ref: "newer", ageDays: 1 });

    await runDueChannelAutoReplies(orgId);

    const first = await prisma.conversation.findUniqueOrThrow({
      where: { id: oldest.id },
      select: { status: true },
    });
    expect(first.status).toBe("answered");
  });
});
