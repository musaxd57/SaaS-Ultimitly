import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// MODEL YOLUNDA CLAIM GERİ ALINMAZ — ARTIK GERÇEKTEN PİNLİ (denetim, 08-01).
//
// `escalation-email-retry.test.ts` içinde bu kuralı anlatan uzun bir başlık
// vardı ama altındaki TEK test `passesAutoReplySafetyGate`'i doğrudan çağırıyordu
// — yani KELİME yolunun güvenliğini ölçüyordu, model yolunu HİÇ çalıştırmıyordu.
// Sonuç: CLAUDE.md'de "TEKRAR ÖNERME" diye işaretlenmiş kalıcı bir karar tüm
// suitte pinsizdi; biri `applyChannelAutoReply`'a geri alma eklese hiçbir test
// kırmızıya dönmezdi.
//
// KURALIN GEREKÇESİ (iki regresyon, denenip geri alınmıştı):
//  1. GÜVENLİK — claim aynı zamanda "bu thread insana ait" KİLİDİDİR. Geri
//     alınırsa sonraki tur modele TEKRAR sorar; model hükmü medium→low oynarsa
//     kapı geçebilir ve riskli sayılmış bir mesaja OTOMATİK cevap gider. Kapının
//     deterministik yedekleri yalnız safety/rule/discrimination'ı kapsar —
//     `review_threat`/`platform_policy`/`access_security` için İKİNCİ SAVUNMA YOK.
//  2. MALİYET — model yolunda yaş penceresi yok ve `escalated_to_human`
//     `autoReplyAttemptedAt` damgalamıyor → e-posta kalıcı bozuksa her escalate
//     edilmiş konuşma 2 dakikada bir yeniden modellenir, sonsuza kadar.
//
// Kabul edilmiş taviz: e-posta gitmezse bildirim ulaşmaz, ama thread KALICI
// "Sorunlu" kalır (host panelde görür) + Sentry'ye düşer.
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
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => {}) };
});

import { emailService } from "@/lib/email";
import { suggestReply } from "@/lib/ai";
import { applyChannelAutoReply } from "@/lib/automation";

const mockMail = vi.mocked(emailService.sendReporting);
const mockSuggest = vi.mocked(suggestReply);

/**
 * Modelin YÜKSEK RİSK dediği bir hüküm — escalation dalını tetikler.
 * `review_threat` bilinçli seçildi: kapının deterministik yedekleri bu sınıfı
 * KAPSAMAZ, yani claim geri alınırsa ikinci savunma yoktur (kuralın gerekçesi).
 */
const modelSaysHighRisk = {
  intent: "complaint",
  confidence: 0.9,
  reply: "Üzgünüz, ekibimiz ilgileniyor.",
  risk: "Kötü yorum tehdidi",
  priority: "urgent" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "high" as const,
  detectedLanguage: "tr",
  riskType: "review_threat",
  usedSources: [],
  missingInfo: [],
  statedCheckoutTime: null,
};

async function seed() {
  const org = await prisma.organization.create({
    data: {
      name: "Org",
      alertEmail: "host@example.com",
      autoReplyHospitable: true,
      autoReplyStartHour: 0,
      autoReplyEndHour: 0,
      autoReplyEnabledAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Lale 7" },
  });
  const when = new Date(Date.now() - 5 * 60_000);
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      externalReservationId: "res-1",
      status: "new",
      lastMessageAt: when,
      messages: {
        create: [
          {
            direction: "inbound",
            senderName: "Alex",
            // Kelime yolunun ŞİKAYET demediği ama modelin yüksek riskli bulduğu
            // bir mesaj — böylece test gerçekten MODEL dalını sürüyor.
            body: "Bu konuda değerlendirmemi paylaşmadan önce sizinle görüşmek istiyorum.",
            createdAt: when,
          },
        ],
      },
    },
  });
  return { orgId: org.id, conversationId: conversation.id };
}

describe("model yolu — e-posta başarısızlığında claim TUTULUR", () => {
  beforeEach(async () => {
    await resetDb();
    mockSuggest.mockReset();
    mockSuggest.mockResolvedValue(modelSaysHighRisk);
    mockMail.mockReset();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("e-posta BAŞARISIZ olsa bile konuşma 'Sorunlu' KALIR (insan kilidi düşmez)", async () => {
    const { conversationId } = await seed();
    mockMail.mockResolvedValue({ ok: false, error: "provider 500" });

    const out = await applyChannelAutoReply(conversationId);
    expect(out.sent).toBe(false);
    expect(out.skippedReason).toBe("escalated_to_human");

    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    // ⬅️ GERİ ALMA EKLENİRSE BURASI "new" OLUR VE TEST KIRMIZIYA DÖNER.
    expect(c.status).toBe("problem");
    expect(c.skippedReason).toBe("escalated_to_human");
  });

  it("claim tutulduğu için İKİNCİ geçiş modeli YENİDEN ÇAĞIRMAZ (sonsuz maliyet yok)", async () => {
    const { conversationId } = await seed();
    mockMail.mockResolvedValue({ ok: false, error: "provider 500" });

    await applyChannelAutoReply(conversationId);
    expect(mockSuggest).toHaveBeenCalledTimes(1);

    // Üretimde bu 2 dakika sonrasıdır. Claim geri alınmış olsaydı model
    // yeniden çağrılır ve bu sonsuza kadar sürerdi (yaş penceresi YOK).
    await applyChannelAutoReply(conversationId);
    expect(mockSuggest).toHaveBeenCalledTimes(1);
  });

  it("e-posta BAŞARILIYKEN de davranış aynı (regresyon pini)", async () => {
    const { conversationId } = await seed();
    mockMail.mockResolvedValue({ ok: true });

    await applyChannelAutoReply(conversationId);

    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(c.status).toBe("problem");
    expect(mockMail).toHaveBeenCalledTimes(1);
  });
});
