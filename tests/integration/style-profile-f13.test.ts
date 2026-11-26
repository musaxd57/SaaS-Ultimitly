import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// F13 (09-26) — üslup profili OLGU KAYNAĞI DEĞİLDİR: veritabanı tarafı. Eski (işaretsiz) profil — org genelindeki host
// cevaplarından damıtılmış "sık sorulan sorular" olguları taşıyabilir — hiçbir isteme girmez ve 24 saat beklemeden
// yeniden damıtılır; yeni profil kodun sürüm işaretiyle kaydedilir; güncel profil 24 saat kuralına uyar. Yüzey örneği:
// Ayarlar → AI testi (dört yüzeyin tek girişi aynı fonksiyon; yapısal pin `style-profile-channel-scrub.test.ts`).
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
  suggestReply: vi.fn(),
  summarizeHostStyle: vi.fn(),
}));

import { suggestReply, summarizeHostStyle } from "@/lib/ai";
import { POST as AI_TEST } from "@/app/api/ai/test/route";
import { refreshStyleProfile } from "@/lib/automation";
import { STYLE_PROFILE_MARKER, markStyleProfile } from "@/lib/ai/style-profile";

const mockSuggest = vi.mocked(suggestReply);
const mockSummarize = vi.mocked(summarizeHostStyle);

const LEGACY = "1) TARZ: kısa ve samimi.\n2) SIK SORULAN SORULAR:\n- Otopark: bina önünde ücretsiz.";

async function orgWithHostReplies(profile: string | null, profileAt: Date | null) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await prisma.organization.update({ where: { id: orgId }, data: { aiStyleProfile: profile, aiStyleProfileAt: profileAt } });
  const conversation = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "Misafir" } });
  for (let i = 0; i < 5; i++) {
    await prisma.message.create({
      data: { conversationId: conversation.id, direction: "outbound", senderName: "Ev sahibi", authorType: "host", body: `Rica ederim, iyi tatiller ${i}!` },
    });
  }
  return orgId;
}

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "sk-test-style-profile-0000000000");
  mockSummarize.mockResolvedValue("- Kısa ve samimi yazar");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("refreshStyleProfile — sürüm işareti ve eski profilin yenilenmesi", () => {
  it("🚨 eski (işaretsiz) profil 24 saat BEKLEMEDEN yenilenir ve yenisi sürüm işaretiyle kaydedilir", async () => {
    const orgId = await orgWithHostReplies(LEGACY, new Date());
    expect(await refreshStyleProfile(orgId)).toEqual({ refreshed: true });
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.aiStyleProfile).toBe(`${STYLE_PROFILE_MARKER}\n- Kısa ve samimi yazar`);
  });

  it("güncel profil 24 saat kuralına UYAR (yeniden damıtılmaz)", async () => {
    const current = markStyleProfile("- Kısa yazar");
    const orgId = await orgWithHostReplies(current, new Date());
    expect(await refreshStyleProfile(orgId)).toEqual({ refreshed: false });
    expect(mockSummarize).not.toHaveBeenCalled();
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).aiStyleProfile).toBe(current);
  });

  it("24 saati dolmuş güncel profil yenilenir (işaretli)", async () => {
    const orgId = await orgWithHostReplies(markStyleProfile("- Eski üslup"), new Date(Date.now() - 25 * 60 * 60 * 1000));
    expect(await refreshStyleProfile(orgId)).toEqual({ refreshed: true });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).aiStyleProfile).toBe(
      `${STYLE_PROFILE_MARKER}\n- Kısa ve samimi yazar`,
    );
  });
});

describe("Ayarlar → AI testi: modele yalnız güncel profilin gövdesi gider", () => {
  const REPLY = {
    intent: "parking",
    confidence: 0.9,
    reply: "Otopark için ev sahibiniz size bilgi verebilir.",
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
  const req = () =>
    new NextRequest("http://localhost/api/ai/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Otopark var mı?" }),
    });

  async function seed(profile: string) {
    const { orgId } = await makeOrgWithProperty();
    await prisma.organization.update({ where: { id: orgId }, data: { aiStyleProfile: profile } });
    const user = await prisma.user.create({
      data: { organizationId: orgId, name: "O", email: `f13-${Math.random()}@x.com`, passwordHash: "x", role: "owner" },
    });
    session = { userId: user.id, organizationId: orgId, role: "owner", email: user.email, name: "O", sessionEpoch: 0 };
  }

  it("🚨 eski profil (org genelinden 'otopark ücretsiz' olgusu) modele HİÇ gitmez", async () => {
    await seed(LEGACY);
    mockSuggest.mockResolvedValue(REPLY);
    await AI_TEST(req(), { params: Promise.resolve({}) });
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    expect(mockSuggest.mock.calls[0][0].styleProfile).toBeNull();
  });

  it("güncel profil: işaretsiz gövde gider", async () => {
    await seed(markStyleProfile("- Kısa yazar\n- Sevgiler ile kapatır"));
    mockSuggest.mockResolvedValue(REPLY);
    await AI_TEST(req(), { params: Promise.resolve({}) });
    expect(mockSuggest.mock.calls[0][0].styleProfile).toBe("- Kısa yazar\n- Sevgiler ile kapatır");
  });
});
