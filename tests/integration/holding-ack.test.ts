import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/email", () => ({
  emailService: {
    send: vi.fn(),
    // sendDueAlerts / escalation artık SONUCU OKUYOR (sendReporting): e-posta
    // gitmezse claim geri alınır. Mock varsayılanı "başarılı" — mevcut testlerin
    // davranışı birebir korunur; başarısızlık senaryosu bunu tek testte ezer.
    sendReporting: vi.fn(async () => ({ ok: true })),
  },
}));

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { emailService } from "@/lib/email";
import { sendDueAlerts, applyChannelAutoReply } from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);
// Eskalasyon e-postası artık `sendReporting` ile gidiyor: sonucu OKUNUYOR ve
// başarısızsa claim geri alınıyor (sessiz kayıp kapatıldı). Casus o çağrıda.
const mockEmail = vi.mocked(emailService.sendReporting);

/** Org + property + one fresh "new" conversation whose guest spoke last. */
async function seed(opts: { holdingAck?: boolean; guestMessage: string }) {
  const org = await prisma.organization.create({
    data: {
      name: "Holding Org",
      alertEmail: "host@example.com",
      autoHoldingReplyEnabled: opts.holdingAck ?? false,
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0, // start === end → always inside the window
      timezone: "Europe/Istanbul",
    },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Deniz Daire" },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      guestIdentifier: "Guest X",
      channel: "airbnb",
      status: "new",
      externalReservationId: "res-h1",
      lastMessageAt: new Date(),
      messages: {
        create: { direction: "inbound", senderName: "Guest X", body: opts.guestMessage },
      },
    },
  });
  return { org, property, conversation };
}

async function outboundBodies(conversationId: string): Promise<string[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId, direction: "outbound" },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.body);
}

// ---------------------------------------------------------------------------
// BEKLETME MESAJI EMEKLİYE AYRILDI — K10 (kurucu kararı 09-30, "Hiçbir şey gitmesin"). Eski tier-2 metni ("Mesajınız
// kaydedildi ve ev sahibiniz için öncelikli olarak işaretlendi") tam da misafire gitmemesi kararlaştırılan devir / bildirim
// cümlesiydi. Ev sahibi eski ayarı açmış olsa da (`autoHoldingReplyEnabled` sütunu duruyor) şikâyette misafire otomatik
// mesaj GİTMEZ; konuşma "Sorunlu" olur ve ev sahibine e-posta gider (bugünkü yükseltme).
// ---------------------------------------------------------------------------
describe("K10 — bekletme mesajı emekliye ayrıldı: kelime yolu (sendDueAlerts)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  for (const holdingAck of [true, false]) {
    it(`hafif şikâyet (eski ayar ${holdingAck ? "AÇIK" : "kapalı"}) → misafire HİÇBİR otomatik mesaj yok; konuşma Sorunlu, ev sahibine e-posta`, async () => {
      const { org, conversation } = await seed({ holdingAck, guestMessage: "Klima çalışmıyor, içerisi çok sıcak!" });
      const r = await sendDueAlerts(org.id);
      expect(r.alerted).toBe(1);
      expect(mockEmail).toHaveBeenCalledTimes(1);
      expect(mockSend).not.toHaveBeenCalled();
      expect(await outboundBodies(conversation.id)).toHaveLength(0);
      const conv = await prisma.conversation.findUnique({ where: { id: conversation.id } });
      expect(conv?.status).toBe("problem");
      expect(conv?.skippedReason).toBe("complaint");
      // Idempotent: ikinci geçiş sahiplenecek bir şey bulmaz.
      vi.clearAllMocks();
      expect((await sendDueAlerts(org.id)).alerted).toBe(0);
      expect(mockSend).not.toHaveBeenCalled();
    });
  }
});

describe("K10 — bekletme mesajı emekliye ayrıldı: model yolu (applyChannelAutoReply)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  const modelComplaint = (riskLevel: "medium" | "high") => ({
    intent: "complaint",
    confidence: 0.9,
    reply: "Taslak cevap",
    risk: "şikayet",
    priority: "urgent" as const,
    source: "openai" as const,
    actionSuggestion: null,
    riskLevel,
    detectedLanguage: "en",
    riskType: "complaint" as string | null,
    usedSources: [] as string[],
    missingInfo: [] as string[],
    statedCheckoutTime: null,
  });

  for (const riskLevel of ["medium", "high"] as const) {
    it(`modelin gördüğü şikâyet (${riskLevel}, eski ayar AÇIK) → yükseltme + e-posta, misafire HİÇBİR otomatik mesaj yok`, async () => {
      // Şikâyet sözcüğü YOK: kelime ağı kaçırır, model yakalar.
      const { conversation } = await seed({
        holdingAck: true,
        guestMessage: "The vibe here is not what we hoped for at all, quite let down.",
      });
      mockSuggest.mockResolvedValue(modelComplaint(riskLevel));
      const r = await applyChannelAutoReply(conversation.id);
      expect(r.sent).toBe(false);
      expect(r.skippedReason).toBe("escalated_to_human");
      expect(mockSend).not.toHaveBeenCalled();
      expect(await outboundBodies(conversation.id)).toHaveLength(0);
      const conv = await prisma.conversation.findUnique({ where: { id: conversation.id } });
      expect(conv?.status).toBe("problem");
      expect(conv?.lastRiskLevel).toBe(riskLevel);
      expect(mockEmail).toHaveBeenCalledTimes(1);
    });
  }
});

describe("human_request gate refinement (regression for the over-broad veto)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  const HUMAN_MSG = "Gerçek bir kişiyle görüşmek istiyorum lütfen";

  const humanAck = (reply: string) => ({
    intent: "human_request",
    confidence: 0.9,
    reply,
    risk: "insan talebi",
    priority: "standard" as const,
    source: "openai" as const,
    actionSuggestion: null,
    riskLevel: "low" as const,
    detectedLanguage: "tr",
    riskType: null,
    usedSources: [],
    missingInfo: [],
    statedCheckoutTime: null,
  });

  it("🚨 K10: istemin devir cümlesi ('Mesajınız kaydedildi; ev sahibiniz görebilir') GİTMEZ — ev sahibine acil yükseltme", async () => {
    const { conversation } = await seed({ guestMessage: HUMAN_MSG });
    mockSuggest.mockResolvedValue(humanAck("Tabii ki. Mesajınız kaydedildi; ev sahibiniz görebilir."));
    const r = await applyChannelAutoReply(conversation.id);
    expect(r.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    const conv = await prisma.conversation.findUnique({ where: { id: conversation.id } });
    expect(conv?.status).toBe("problem");
    expect(mockEmail).toHaveBeenCalledTimes(1);
  });

  it("model ALSO says human_request → devir cümlesiz onay gider ve AI duraklar (tasarlanmış akış)", async () => {
    const { conversation } = await seed({ guestMessage: HUMAN_MSG });
    mockSuggest.mockResolvedValue({
      intent: "human_request",
      confidence: 0.9,
      // Devir cümlesi YOK (K10, 09-30: "Mesajınız kaydedildi; ev sahibiniz görebilir" çıktı vetosunda tutulur ↑).
      reply: "Tabii ki, anlıyorum.",
      risk: "insan talebi",
      priority: "standard" as const,
      source: "openai" as const,
      actionSuggestion: null,
      riskLevel: "low" as const,
      detectedLanguage: "tr",
      riskType: null,
      usedSources: [],
      missingInfo: [],
      statedCheckoutTime: null,
    });
    const r = await applyChannelAutoReply(conversation.id);
    expect(r.sent).toBe(true);
    const conv = await prisma.conversation.findUnique({ where: { id: conversation.id } });
    expect(conv?.autoReplyHoldUntil).toBeTruthy(); // AI paused for the handoff window
    // Faz-A: a successful auto-send clears the held-back reason and records the verdict.
    expect(conv?.skippedReason).toBeNull();
    expect(conv?.lastRiskLevel).toBe("low");
  });

  it("model says something ELSE for a human-request message → held for a human (no send)", async () => {
    const { conversation } = await seed({ guestMessage: HUMAN_MSG });
    mockSuggest.mockResolvedValue({
      intent: "general",
      confidence: 0.9,
      reply: "Normal bir cevap",
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
    });
    const r = await applyChannelAutoReply(conversation.id);
    expect(r.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
