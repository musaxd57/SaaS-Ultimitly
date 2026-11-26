import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";
import type { SuggestReplyResult } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// K-1029-A v2 — Opus F10 (10-30): cevabın TAMAMI ev sahibine başvurma yüzünden tutulduğunda ("Merhaba Ayşe, herhangi bir sorunda ev
// sahibinize yazın.") TASLAK o cümle ÇIKARILMIŞ metindir. Önce: `reply` (özgün metin) "AI öner" taslağına ve yanıtına yazılıyordu — ev sahibi
// "Gönder"e basınca misafir kendi ev sahibinden "ev sahibinize yazın" alıyordu (tasarım A3 / S9). Ayarlar test rotası da silme kaydını (kökler
// — selamdaki misafir adı dahil) istemciye döndürüyordu. Cevap modeli MOCK; DB gerçek.
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
import { POST as aiTest } from "@/app/api/ai/test/route";
import { hostVoiceDraft } from "@/lib/ai/host-voice";

const mockSuggest = vi.mocked(suggestReply);

const BANNED = "Merhaba Ayşe, Wi-Fi şifresi Lale1234. Herhangi bir sorunda ev sahibinize yazın; ev sahibiniz mesajınızı görebilir.";
const DRAFT = "Merhaba Ayşe, Wi-Fi şifresi Lale1234.";

function held(over: Partial<SuggestReplyResult> = {}): SuggestReplyResult {
  return {
    intent: "wifi",
    confidence: 0.9,
    reply: BANNED,
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
    stayChange: { asked: "none", stance: "none" },
    hostContactOnly: true,
    hostContactRemovals: [{ kind: "write", form: "conditional", appendix: false, stems: ["ayse"], topics: [], generic: false }],
    hostContactDraft: DRAFT,
    ...over,
  };
}

async function seed() {
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  const user = await prisma.user.create({ data: { organizationId: org.id, name: "h", email: "h@x.com", passwordHash: "x", role: "owner" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Ayşe",
      status: "new",
      messages: { create: [{ direction: "inbound", senderName: "Ayşe", authorType: "guest", body: "Wi-Fi şifresi ne?" }] },
    },
    select: { id: true },
  });
  session = { userId: user.id, organizationId: org.id, role: "owner", email: "h@x.com", name: "h", sessionEpoch: 0 };
  return conversation.id;
}

async function suggest(id: string) {
  const res = await aiSuggest(
    new NextRequest(`http://localhost/api/conversations/${id}/ai-suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    { params: Promise.resolve({ id }) },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

describe("Opus F10 — tutulan cevabın taslağı yasaklı cümleyi taşımaz", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 'AI öner': kaydedilen taslak ve yanıt SİLİNMİŞ metindir; silme kaydı ve taslak alanı istemciye dönmez", async () => {
    const id = await seed();
    mockSuggest.mockResolvedValueOnce(held());
    const body = await suggest(id);
    const row = await prisma.message.findFirstOrThrow({ where: { conversationId: id, direction: "inbound" } });
    expect(row.aiSuggestedReply).toBe(hostVoiceDraft(DRAFT));
    expect(row.aiSuggestedReply).not.toMatch(/ev sahibinize yazın/);
    expect(body.reply).toBe(hostVoiceDraft(DRAFT));
    expect(body).not.toHaveProperty("hostContactDraft");
    expect(body).not.toHaveProperty("hostContactRemovals");
    expect(body.hostContactNotice).toEqual({ removed: 1, maybeUnanswered: true });
  });

  it("KONTROL: hiçbir şey tutulmadıysa (taslak alanı yok) taslak modelin cevabıdır — bugünkü gibi", async () => {
    const id = await seed();
    mockSuggest.mockResolvedValueOnce(held({ reply: DRAFT, hostContactOnly: undefined, hostContactRemovals: undefined, hostContactDraft: undefined }));
    const body = await suggest(id);
    expect(body.reply).toBe(hostVoiceDraft(DRAFT));
    expect(body).not.toHaveProperty("hostContactNotice");
  });

  it("🚨 Ayarlar test rotası: silme kaydı (selamdaki misafir adını taşıyan kökler) ve taslak alanı istemciye dönmez", async () => {
    await seed();
    mockSuggest.mockResolvedValueOnce(held());
    const res = await aiTest(
      new NextRequest("http://localhost/api/ai/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Wi-Fi şifresi ne?" }),
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("hostContactRemovals");
    expect(body).not.toHaveProperty("hostContactDraft");
    expect(body.hostContactOnly).toBe(true);
    expect(body.wouldAutoSend).toBe(false);
    // Önizleme de silinmiş taslağı gösterir (mutasyon W5): ev sahibi "ev sahibinize yazın"ı önizlemede görüp aynen göndermesin.
    expect(String(body.reply)).toContain(hostVoiceDraft(DRAFT));
    expect(String(body.reply)).not.toMatch(/ev sahibinize yazın/);
  });
});
