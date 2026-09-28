import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// ADSIZ YAPAY ZEKÂ — TAM AKIŞ KANARYASI (Codex şartı 09-28: "saldırgan ad, tam ad veya türevi hiçbir gerçek model isteğine girmez").
// Kanal oto-yanıtı canlıdaki katmanlarla koşar: anlama katmanı, bekçi, anlamsal arama (gömme), yeniden sıralayıcı, cevap modeli.
// HER model isteği sahte `fetch` ile yakalanır (ağ yok, ücret yok); kanarya ad (tam ad + hitap adı) hiçbirinde geçmemeli — misafirin
// kendi mesajında ve geçmişteki kendi selamımızda (ikinci tur) geçse bile. KONTROL koşusu (anahtar kapalı) adın bugün modele gittiğini
// gösterir: test anlamlı.
// ---------------------------------------------------------------------------

vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply } from "@/lib/automation";
import { warmPropertyKbVectors } from "@/lib/ai/embeddings/kb-warm";

const mockSend = vi.mocked(sendOnChannel);

const GIVEN = "Zqxwvu";
const FULL = "Zqxwvu Kanaryaoglu";
const CANARY_PARTS = ["zqxwvu", "kanaryaoglu"];

const REPLY_MODEL = {
  intent: "wifi",
  stayChangeAsked: "none",
  confidence: 0.95,
  reply: "Merhaba! Wi-Fi ağı Lale-5G, şifre Lale2025.",
  risk: null,
  priority: "standard",
  actionSuggestion: null,
  riskLevel: "none",
  detectedLanguage: "tr",
  riskType: null,
  usedSources: ["kb:wifi"],
  missingInfo: [],
  statedCheckoutTime: null,
  replyStance: "none",
};

/** Her model isteğini yakalar; gömme ucu sahte vektör, cevap modeli sabit JSON, diğer katmanlar boş JSON (katman düşer, akış sürer). */
function captureAllModelCalls() {
  const calls: { url: string; body: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      const u = String(url);
      const body = String(init?.body ?? "");
      calls.push({ url: u, body });
      if (u.includes("/embeddings")) {
        const parsed = JSON.parse(body) as { input: string | string[]; model?: string };
        const inputs = Array.isArray(parsed.input) ? parsed.input : [parsed.input];
        return new Response(
          JSON.stringify({
            model: parsed.model,
            data: inputs.map((_, i) => ({ index: i, embedding: Array.from({ length: 1536 }, (__, j) => (j === i % 1536 ? 1 : 0.001)) })),
          }),
          { status: 200 },
        );
      }
      const content = body.includes("Sen Lixus AI") ? JSON.stringify(REPLY_MODEL) : "{}";
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), { status: 200 });
    }),
  );
  return calls;
}

async function seed() {
  const org = await prisma.organization.create({
    data: { name: "Kanarya Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
  await prisma.knowledgeBaseItem.create({
    data: {
      propertyId: property.id,
      category: "wifi",
      title: "Wi-Fi",
      content: "Merhaba {isim}, Wi-Fi ağı Lale-5G, şifre Lale2025.",
      isActive: true,
      source: "host_manual",
      reviewState: "approved",
    },
  });
  // Getirmenin devreye girdiği boyut (≤30 kalemde seçim yapılmaz → gömme / sıralayıcı koşmaz).
  await prisma.knowledgeBaseItem.createMany({
    data: Array.from({ length: 34 }, (_, i) => ({
      propertyId: property.id,
      category: "general",
      title: `Qzx ${i}`,
      content: `Qzxw vbnm plkj ${i}.`,
      isActive: true,
      source: "host_manual",
      reviewState: "approved",
    })),
  });
  const day = 86_400_000;
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: FULL,
      guestGivenName: GIVEN,
      guestNameSource: "channel",
      arrivalDate: new Date(Date.now() - day),
      departureDate: new Date(Date.now() + 3 * day),
      channel: "airbnb",
      status: "confirmed",
      sourceReference: "res-canary",
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: reservation.id,
      channel: "airbnb",
      guestIdentifier: FULL,
      status: "new",
      externalReservationId: "res-canary",
      messages: {
        create: [
          { direction: "inbound", senderName: FULL, body: `Merhaba, ben ${FULL}, bugün geliyoruz.`, createdAt: new Date(Date.now() - 3 * 3_600_000) },
          {
            direction: "outbound",
            authorType: "ai",
            senderName: "GuestOps AI",
            body: `Merhaba ${GIVEN},\n\nGirişiniz 15:00'ten itibaren.`,
            createdAt: new Date(Date.now() - 2 * 3_600_000),
          },
          { direction: "inbound", senderName: FULL, body: `Ben ${FULL}. Wi-Fi şifresi nedir?`, createdAt: new Date(Date.now() - 60_000) },
        ],
      },
    },
    select: { id: true },
  });
  return { conversationId: conversation.id, propertyId: property.id };
}

const leaks = (text: string) => CANARY_PARTS.filter((p) => text.toLocaleLowerCase("tr").includes(p));

describe("tam akış kanaryası — adsız yapay zekâ", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "");
    vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
    vi.stubEnv("KB_RERANK_ENABLED", "1");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("KONTROL — anahtar kapalıyken ad bugün model isteklerine gidiyor (test anlamlı)", async () => {
    const calls = captureAllModelCalls();
    const { conversationId, propertyId } = await seed();
    await warmPropertyKbVectors(propertyId);
    await applyChannelAutoReply(conversationId);
    expect(calls.some((c) => leaks(c.body).length > 0)).toBe(true);
  });

  it("🚨 anahtar AÇIK: HİÇBİR model isteğinde ad yok (cevap, anlama, bekçi, gömme, sıralayıcı; ikinci tur dahil)", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    const calls = captureAllModelCalls();
    const { conversationId, propertyId } = await seed();
    await warmPropertyKbVectors(propertyId);
    await applyChannelAutoReply(conversationId);
    // Katmanlar gerçekten koştu: cevap modeli + gömme sorgusu isteği görüldü.
    expect(calls.some((c) => c.body.includes("Sen Lixus AI"))).toBe(true);
    expect(calls.filter((c) => c.url.includes("/embeddings")).length).toBeGreaterThan(0);
    const leaked = calls.filter((c) => leaks(c.body).length > 0).map((c) => c.url);
    expect(leaked).toEqual([]);
  });

  it("🚨 misafire giden: ikinci cevapta selam YOK (modelin 'Merhaba!' selamı silindi)", async () => {
    vi.stubEnv("AI_CODE_GREETING_ENABLED", "1");
    captureAllModelCalls();
    const { conversationId, propertyId } = await seed();
    await warmPropertyKbVectors(propertyId);
    const out = await applyChannelAutoReply(conversationId);
    if (out.sent) {
      expect(mockSend.mock.calls[0][1]).not.toMatch(/^Merhaba/);
    } else {
      const draft = await prisma.message.findFirst({
        where: { conversationId, direction: "inbound" },
        orderBy: { createdAt: "desc" },
        select: { aiSuggestedReply: true },
      });
      expect(draft?.aiSuggestedReply ?? "").not.toMatch(/^Merhaba/);
    }
  });
});
