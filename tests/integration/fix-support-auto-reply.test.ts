import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// KANITSIZ ARIZA ADIMI — KANAL OTO-YANITI UÇTAN UCA (kurucu 10-15 inceleme notu, aynen: "BOZUKLAR İÇİN BİLGİ TABANINDA YAZMAYAN
// ÖNERİLER VEREMEZ"; anahtar `AI_FIX_SUPPORT_GATE_ENABLED`, VARSAYILAN KAPALI). Kapının bağlamı ÜRETİM yolunda gerçekten kuruluyor mu
// ("yüklem var, argüman yok" sınıfı): modele giden bilgi tabanı (TV kalemi YOK, Wi-Fi kalemi TV ünitesini anıyor — kurucunun vakası) +
// modelin uydurduğu TV adımı → anahtar açıkken GİTMEZ (karar kaydı `reply_fix_unsupported`), kapalıyken bugünkü gibi gider.
// Öğe kipi ve anlama katmanı KAPALI: kemer onlardan bağımsız.
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
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

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply } from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);

const GUEST = "Televizyonu nasıl açıyoruz?";
const FABRICATED = "Kumandadaki kırmızı güç tuşuna basıp ardından SOURCE tuşuyla HDMI 1 girişini seçin.";
const FROM_KB = "Ağ adı Lale-5G, şifre Lale2025.";

function reply(text: string) {
  return {
    intent: "general",
    confidence: 0.92,
    reply: text,
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
}

async function seed(guestMessage: string) {
  const org = await prisma.organization.create({
    data: { name: "Test Org", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0, timezone: "Europe/Istanbul" },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale Daire" } });
  await prisma.knowledgeBaseItem.createMany({
    data: [
      { propertyId: property.id, category: "wifi", title: "Wi-Fi", content: "Ağ adı: Lale-5G, şifre: Lale2025. Modem salondaki TV ünitesinin altındadır.", isActive: true },
      { propertyId: property.id, category: "faq", title: "Çöp", content: "Çöp konteynerleri binanın arka tarafındadır. Geri dönüşüm için mavi konteyneri kullanın.", isActive: true },
    ],
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: "res-1",
      messages: { create: [{ direction: "inbound", senderName: "Alex", body: guestMessage, createdAt: new Date(Date.now() - 60_000) }] },
    },
    select: { id: true },
  });
  return conversation.id;
}

describe("kanıtsız arıza adımı — kanal oto-yanıtı (AI_FIX_SUPPORT_GATE_ENABLED)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 anahtar AÇIK: bilgi tabanında TV kalemi yokken uydurulan TV adımı GİTMEZ; karar kaydı reply_fix_unsupported", async () => {
    vi.stubEnv("AI_FIX_SUPPORT_GATE_ENABLED", "1");
    mockSuggest.mockResolvedValue(reply(FABRICATED));
    const conversationId = await seed(GUEST);

    const out = await applyChannelAutoReply(conversationId);

    expect(out.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" } });
    expect(JSON.parse(ev.kbEvidenceJson ?? "{}").g?.d).toBe("reply_fix_unsupported");
  });

  it("anahtar AÇIK, aşırı uygulama yok: bilgi tabanındaki bilgiyle cevap (adım değil) gider", async () => {
    vi.stubEnv("AI_FIX_SUPPORT_GATE_ENABLED", "1");
    mockSuggest.mockResolvedValue(reply(FROM_KB));
    const conversationId = await seed("Wi-Fi şifresi neydi?");

    const out = await applyChannelAutoReply(conversationId);

    expect(out.sent).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("anahtar KAPALI (bugün): aynı uydurma adım bugünkü gibi gider — kemer yalnız anahtarla koşar", async () => {
    mockSuggest.mockResolvedValue(reply(FABRICATED));
    const conversationId = await seed(GUEST);

    const out = await applyChannelAutoReply(conversationId);

    expect(out.sent).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
