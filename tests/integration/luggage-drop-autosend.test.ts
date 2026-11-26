import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// BAVUL BIRAKMA — UÇTAN UCA (kurucu 10-12: "Ekle"). GERÇEK ayrıştırıcı + GERÇEK kapı + GERÇEK oto-yanıt yolu; yalnız OpenAI HTTP'si,
// kanal göndericisi, sağlayıcı jetonu ve e-posta sahte. Model "istek yok / izin yok" BEYAN etse bile (anlamsal katmanlar kapalı) misafirin
// "Bavullarımızı 9'da bırakabilir miyiz?" sorusuna "Elbette, 9'da bırakabilirsiniz" cevabı GİTMEZ (giriş 15:00). Kontrol: aynı tohumla
// giriş saatinden SONRAKİ saat ve bavulsuz soru otomatik gider (aşırı uygulama değil).
// ---------------------------------------------------------------------------
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) } }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })) }));

import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply } from "@/lib/automation";

const mockSend = vi.mocked(sendOnChannel);

function modelSays(reply: string, intent = "general") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).startsWith("https://api.openai.com/")) throw new Error(`beklenmeyen dış çağrı: ${String(input)}`);
      const content = {
        intent,
        confidence: 0.95,
        reply,
        risk: null,
        priority: "standard",
        actionSuggestion: null,
        riskLevel: "none",
        detectedLanguage: "tr",
        riskType: null,
        usedSources: ["kb:general"],
        missingInfo: [],
        statedCheckoutTime: null,
        stayChangeAsked: "none",
        replyStance: "none",
      };
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }), { status: 200 });
    }),
  );
}

async function seed(guestMessage: string) {
  const org = await prisma.organization.create({
    data: { name: "Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
  });
  await prisma.user.create({ data: { organizationId: org.id, name: "Owner", email: `o-${org.id}@x.com`, passwordHash: "x", role: "owner" } });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Deniz Daire", checkInTime: "15:00", checkOutTime: "11:00" },
  });
  await prisma.knowledgeBaseItem.create({
    data: { propertyId: property.id, category: "general", title: "Otopark", content: "Bina altında ücretsiz otopark var.", isActive: true },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: "res-lug",
      messages: { create: [{ direction: "inbound", senderName: "Alex", body: guestMessage, createdAt: new Date(Date.now() - 60_000) }] },
    },
    select: { id: true },
  });
  return conversation.id;
}

describe("🚨 bavul bırakma — model 'istek yok' dese bile giriş öncesi izin misafire gitmez", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    mockSend.mockResolvedValue({ ok: true });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("\"Bavullarımızı 9'da bırakabilir miyiz?\" (giriş 15:00) → \"Elbette, 9'da bırakabilirsiniz\" GÖNDERİLMEZ", async () => {
    modelSays("Elbette, bavullarınızı 9'da bırakabilirsiniz.");
    const id = await seed("Bavullarımızı 9'da bırakabilir miyiz?");
    const out = await applyChannelAutoReply(id);
    expect(out.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId: id, surface: "auto_reply" } });
    expect(ev.finalDecision).toBe("human_review");
  });

  it("\"Can we leave our bags before check-in?\" → \"Sure, you can leave them anytime\" GÖNDERİLMEZ", async () => {
    modelSays("Sure, you can leave your bags anytime in the morning.");
    const id = await seed("Can we leave our bags before check-in?");
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("KONTROL: giriş saatinden SONRAKİ saat ve bavulsuz soru aynı yoldan otomatik gider", async () => {
    modelSays("Elbette, bavullarınızı 16:00'da bırakabilirsiniz.");
    const late = await seed("Bavullarımızı 16:00'da bırakabilir miyiz?");
    expect((await applyChannelAutoReply(late)).sent).toBe(true);

    modelSays("Bina altında ücretsiz otopark var.", "parking");
    const parking = await seed("Otopark var mı?");
    expect((await applyChannelAutoReply(parking)).sent).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
